import type {
  ClaudeSettings,
  ProviderInstanceEnvironment,
  ResolvedProviderInstanceEnvironment,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as AixDiscovery from "../AixDiscovery.ts";
import { readClaudeSettingsEnv } from "./ClaudeSkills.ts";

const quotePath = Schema.encodeSync(Schema.fromJsonString(Schema.String));
const AIX_PROFILE_ENVIRONMENT_VARIABLE = "T3_AIX_PROFILE";

class ClaudeAixProfileError extends Schema.TaggedError<ClaudeAixProfileError>()(
  "ClaudeAixProfileError",
  { reason: Schema.Literals(["invalid-reference", "settings-auth-conflict", "insecure-endpoint"]) },
) {
  override get message(): string {
    if (this.reason === "insecure-endpoint") {
      return "Claude aix gateway authentication requires HTTPS outside loopback.";
    }
    return this.reason === "invalid-reference"
      ? "The configured aix profile reference is invalid."
      : "Remove conflicting Claude settings credentials before using an aix profile.";
  }
}

export const resolveClaudeProviderInstanceEnvironment = Effect.fn(
  "resolveClaudeProviderInstanceEnvironment",
)(function* (environment: ResolvedProviderInstanceEnvironment | undefined) {
  const profileReferences =
    environment?.filter((variable) => variable.name === AIX_PROFILE_ENVIRONMENT_VARIABLE) ?? [];
  if (profileReferences.length === 0) return environment ?? [];
  const [profileReference] = profileReferences;
  if (
    profileReferences.length !== 1 ||
    profileReference === undefined ||
    profileReference.sensitive ||
    typeof profileReference.value !== "string" ||
    profileReference.value.trim().length === 0
  ) {
    return yield* new ClaudeAixProfileError({ reason: "invalid-reference" });
  }

  const resolved = yield* AixDiscovery.resolveEnvironment(profileReference.value.trim()).pipe(
    Effect.mapError((cause) =>
      cause.reason === "insecure-endpoint"
        ? new ClaudeAixProfileError({ reason: "insecure-endpoint" })
        : cause,
    ),
  );
  const directAnthropic = resolved.endpointKind === "anthropic";

  return [
    ...(environment ?? []).filter(
      (variable) =>
        variable.name !== AIX_PROFILE_ENVIRONMENT_VARIABLE &&
        variable.name !== "ANTHROPIC_BASE_URL" &&
        variable.name !== "ANTHROPIC_API_KEY" &&
        variable.name !== "ANTHROPIC_AUTH_TOKEN",
    ),
    { name: "ANTHROPIC_BASE_URL", value: resolved.endpoint, sensitive: false },
    {
      name: directAnthropic ? "ANTHROPIC_API_KEY" : "ANTHROPIC_AUTH_TOKEN",
      value: resolved.apiKey,
      sensitive: true,
    },
    {
      name: directAnthropic ? "ANTHROPIC_AUTH_TOKEN" : "ANTHROPIC_API_KEY",
      value: "",
      sensitive: false,
    },
  ];
});

export interface ClaudeAixEnvironmentSignature {
  readonly matches: (environment: NodeJS.ProcessEnv) => boolean;
}

const makeClaudeAixEnvironmentSignature = (
  environment: NodeJS.ProcessEnv,
): ClaudeAixEnvironmentSignature => {
  const baseUrl = environment.ANTHROPIC_BASE_URL ?? "";
  const apiKey = environment.ANTHROPIC_API_KEY ?? "";
  const authToken = environment.ANTHROPIC_AUTH_TOKEN ?? "";
  return {
    matches: (next) =>
      (next.ANTHROPIC_BASE_URL ?? "") === baseUrl &&
      (next.ANTHROPIC_API_KEY ?? "") === apiKey &&
      (next.ANTHROPIC_AUTH_TOKEN ?? "") === authToken,
  };
};

export interface ClaudeAixResolvedTurnEnvironment {
  readonly environment: NodeJS.ProcessEnv;
  readonly signature: ClaudeAixEnvironmentSignature | undefined;
}

export interface ClaudeAixTurnEnvironmentResolver<E> {
  readonly shouldRestartForRotation: (input: {
    readonly currentSignature: ClaudeAixEnvironmentSignature | undefined;
    readonly hasLiveWork: Effect.Effect<boolean>;
    readonly onDeferred?: Effect.Effect<void>;
  }) => Effect.Effect<boolean, E>;
  readonly validateForSpawn: (input: {
    readonly settings: Pick<ClaudeSettings, "homePath">;
    readonly cwd: string | undefined;
    readonly launchSettingsEnvironment: Readonly<Record<string, string>> | undefined;
    readonly mapConflictError: (cause: unknown) => E;
  }) => Effect.Effect<ClaudeAixResolvedTurnEnvironment, E, FileSystem.FileSystem | Path.Path>;
}

/**
 * Coordinates per-turn aix credential refresh for Claude processes so turns reuse the live CLI
 * unless gateway credentials actually rotated and no background work or pending wake would be lost.
 */
export const makeClaudeAixTurnEnvironmentResolver = <E>(input: {
  readonly baseEnvironment: NodeJS.ProcessEnv;
  readonly restartProcessForNewTurn: boolean | undefined;
  readonly resolveProcessEnvironment: (() => Effect.Effect<NodeJS.ProcessEnv, E>) | undefined;
}): ClaudeAixTurnEnvironmentResolver<E> => {
  let cached: ClaudeAixResolvedTurnEnvironment | undefined;
  const resolveOnce = Effect.fnUntraced(function* () {
    if (cached !== undefined) return cached;
    if (input.resolveProcessEnvironment === undefined) {
      cached = { environment: input.baseEnvironment, signature: undefined };
      return cached;
    }
    const resolved = yield* input.resolveProcessEnvironment();
    const environment: NodeJS.ProcessEnv =
      input.baseEnvironment.CLAUDE_CONFIG_DIR === undefined
        ? resolved
        : { ...resolved, CLAUDE_CONFIG_DIR: input.baseEnvironment.CLAUDE_CONFIG_DIR };
    cached = {
      environment,
      signature: makeClaudeAixEnvironmentSignature(environment),
    };
    return cached;
  });

  return {
    shouldRestartForRotation: Effect.fnUntraced(function* ({
      currentSignature,
      hasLiveWork,
      onDeferred,
    }) {
      if (input.restartProcessForNewTurn !== true) return false;
      if (input.resolveProcessEnvironment === undefined) return true;
      const resolved = yield* resolveOnce();
      if (currentSignature?.matches(resolved.environment) === true) return false;
      if (yield* hasLiveWork) {
        if (onDeferred !== undefined) yield* onDeferred;
        return false;
      }
      return true;
    }),
    validateForSpawn: Effect.fnUntraced(function* ({
      settings,
      cwd,
      launchSettingsEnvironment,
      mapConflictError,
    }) {
      const resolved = yield* resolveOnce();
      if (input.resolveProcessEnvironment !== undefined) {
        yield* validateClaudeAixSettingsAuth(
          settings,
          cwd,
          resolved.environment,
          launchSettingsEnvironment,
        ).pipe(Effect.mapError(mapConflictError));
      }
      return resolved;
    }),
  };
};

export const claudeAixSettingsEnvironment = (
  environment: NodeJS.ProcessEnv,
  settingsEnvironment: Readonly<Record<string, string>> = {},
) => {
  const retained = Object.fromEntries(
    Object.entries(settingsEnvironment).filter(
      ([name]) => name !== "ANTHROPIC_API_KEY" && name !== "ANTHROPIC_AUTH_TOKEN",
    ),
  );
  return {
    ...retained,
    ANTHROPIC_BASE_URL: environment.ANTHROPIC_BASE_URL ?? "",
    ...(environment.ANTHROPIC_AUTH_TOKEN
      ? { ANTHROPIC_API_KEY: "" }
      : { ANTHROPIC_AUTH_TOKEN: "" }),
  };
};

export const validateClaudeAixSettingsAuth = Effect.fn("validateClaudeAixSettingsAuth")(function* (
  config: Pick<ClaudeSettings, "homePath">,
  cwd: string | undefined,
  environment: NodeJS.ProcessEnv,
  launchSettingsEnvironment: Readonly<Record<string, string>> = {},
) {
  const settings = yield* readClaudeSettingsEnv(config, cwd, environment, {
    forAixProfile: true,
  });
  const activeCredential = environment.ANTHROPIC_AUTH_TOKEN
    ? "ANTHROPIC_AUTH_TOKEN"
    : "ANTHROPIC_API_KEY";
  if (
    settings[activeCredential] !== undefined ||
    launchSettingsEnvironment[activeCredential] !== undefined
  ) {
    return yield* new ClaudeAixProfileError({ reason: "settings-auth-conflict" });
  }
});

export const resolveClaudeHomePath = Effect.fn("resolveClaudeHomePath")(function* (
  config: Pick<ClaudeSettings, "homePath">,
  environment?: NodeJS.ProcessEnv,
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const homePath = config.homePath.trim();
  if (homePath.length > 0) {
    return path.resolve(expandHomePath(homePath, home));
  }
  // Inherited env vars are not shell-expanded, so a literal `~` stays literal.
  const inherited = environment?.CLAUDE_CONFIG_DIR?.trim() ?? "";
  if (inherited.length > 0) {
    return path.resolve(inherited);
  }
  return path.resolve(path.join(home, ".claude"));
});

export const makeClaudeEnvironment = Effect.fn("makeClaudeEnvironment")(function* (
  config: Pick<ClaudeSettings, "homePath">,
  baseEnv?: NodeJS.ProcessEnv,
): Effect.fn.Return<NodeJS.ProcessEnv, never, Path.Path> {
  const resolvedBaseEnv = baseEnv ?? process.env;
  const homePath = config.homePath.trim();
  if (homePath.length === 0) return resolvedBaseEnv;
  const resolvedHomePath = yield* resolveClaudeHomePath(config);
  return {
    ...resolvedBaseEnv,
    // Changing HOME hides macOS Keychain credentials; use CLAUDE_CONFIG_DIR to keep login access.
    CLAUDE_CONFIG_DIR: resolvedHomePath,
  };
});

// A Claude Code session that launched T3 exports these. A claude spawned with them acts as part of
// that session: its session id, messaging socket and token, and effort.
const CLAUDE_HOST_SESSION_VARIABLES = [
  "CLAUDECODE",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_HOST_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_DESKTOP_APP_VERSION",
  "CLAUDE_EFFORT",
  "CLAUDE_PID",
  "CLAUDE_AGENT_SDK_VERSION",
];

/**
 * Base env for the Claude processes T3 Code runs, before `makeClaudeEnvironment`.
 * Claude Code reads its entrypoint from the process env, not its settings `env`, so T3 Code applies that override itself.
 */
export const mergeClaudeProcessEnvironment = Effect.fn("mergeClaudeProcessEnvironment")(function* (
  config: Pick<ClaudeSettings, "homePath">,
  instanceEnvironment: ProviderInstanceEnvironment | undefined,
  hostEnvironment: NodeJS.ProcessEnv,
) {
  const baseEnvironment: NodeJS.ProcessEnv = {
    ...hostEnvironment,
    CLAUDE_CODE_ENTRYPOINT: "t3-code",
  };
  for (const name of CLAUDE_HOST_SESSION_VARIABLES) delete baseEnvironment[name];
  // The desktop runs the server as Node through Electron. Commands Claude runs inherit its env, so
  // an Electron app they start (T3 Code itself, VS Code) would run as Node and exit.
  delete baseEnvironment.ELECTRON_RUN_AS_NODE;
  const environment = yield* mergeProviderInstanceEnvironment(instanceEnvironment, baseEnvironment);
  const settingsEntrypoint = (yield* readClaudeSettingsEnv(config, undefined, environment))
    .CLAUDE_CODE_ENTRYPOINT;
  return settingsEntrypoint
    ? { ...environment, CLAUDE_CODE_ENTRYPOINT: settingsEntrypoint }
    : environment;
});

/** managed-mcp.json excludes other MCP config and forbids --strict-mcp-config; omit the flag when present. */
export const hasClaudeManagedMcpConfig = Effect.fn("hasClaudeManagedMcpConfig")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const platform = yield* HostProcess.Platform;
  const managedMcpConfigPath =
    platform === "darwin"
      ? "/Library/Application Support/ClaudeCode/managed-mcp.json"
      : platform === "win32"
        ? "C:\\Program Files\\ClaudeCode\\managed-mcp.json"
        : "/etc/claude-code/managed-mcp.json";
  return yield* fileSystem.exists(managedMcpConfigPath).pipe(Effect.orElseSucceed(() => false));
});

// A worktree's .git file points at <main>/.git/worktrees/<name>, whose commondir leads back to
// <main>/.git. A bare repository has no main checkout, so its worktree keeps its own file.
// Untraced because claudeLocalSettingsDirectory already owns the span.
const mainCheckoutRoot = Effect.fnUntraced(function* (checkout: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* fileSystem.readFileString(path.join(checkout, ".git")).pipe(
    Effect.flatMap((pointer) => {
      const gitDir = /^gitdir:\s*(.+)$/m.exec(pointer)?.[1]?.trim();
      if (gitDir === undefined) return Effect.succeed(checkout);
      const worktreeGitDir = path.resolve(checkout, gitDir);
      return fileSystem.readFileString(path.join(worktreeGitDir, "commondir")).pipe(
        Effect.map((commonDir) => {
          const common = path.resolve(worktreeGitDir, commonDir.trim());
          return path.basename(common) === ".git" ? path.dirname(common) : checkout;
        }),
      );
    }),
    Effect.orElseSucceed(() => checkout),
  );
});

// Claude Code keeps .claude/settings.local.json at the repository root, or in cwd outside a
// repository, on Windows, or when the root is home. Its owner check is skipped, so callers must
// stay safe when Claude Code ignores the root file.
export const claudeLocalSettingsDirectory = Effect.fn("claudeLocalSettingsDirectory")(function* (
  cwd: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if ((yield* HostProcess.Platform) === "win32") return cwd;
  for (let directory = cwd; ; directory = path.dirname(directory)) {
    const isCheckout = yield* fileSystem
      .exists(path.join(directory, ".git"))
      .pipe(Effect.orElseSucceed(() => false));
    if (isCheckout) {
      const root = yield* mainCheckoutRoot(directory);
      return root === (yield* HostProcess.HomeDirectory) ? cwd : root;
    }
    if (path.dirname(directory) === directory) return cwd;
  }
});

export const makeClaudeContinuationGroupKey = Effect.fn("makeClaudeContinuationGroupKey")(
  function* (
    config: Pick<ClaudeSettings, "homePath">,
    environment?: NodeJS.ProcessEnv,
  ): Effect.fn.Return<string, never, Path.Path | FileSystem.FileSystem> {
    const fileSystem = yield* FileSystem.FileSystem;
    const resolvedHomePath = yield* resolveClaudeHomePath(config, environment);
    // Two instances that reach one Claude home through a symlink share sessions, so they can resume.
    // Only the key uses the real path: the spawn keeps the literal path, which names the Keychain login.
    const canonicalHomePath = yield* fileSystem
      .realPath(resolvedHomePath)
      .pipe(Effect.orElseSucceed(() => resolvedHomePath));
    return `claude:home:${canonicalHomePath}`;
  },
);

export const makeClaudeCapabilitiesCacheKey = Effect.fn("makeClaudeCapabilitiesCacheKey")(
  function* (
    config: Pick<ClaudeSettings, "binaryPath" | "homePath">,
    cwd?: string,
    environment?: NodeJS.ProcessEnv,
  ): Effect.fn.Return<string, never, Path.Path> {
    const resolvedHomePath = yield* resolveClaudeHomePath(config, environment);
    return `${config.binaryPath}\0${resolvedHomePath}\0${cwd ?? ""}`;
  },
);

/** Separate spawn env from login commands to preserve literal paths, including relative inherited values. */
export const claudeSignedOutMessage = (input: {
  readonly configDir: string | undefined;
  readonly cwd: string;
}): string => {
  const configuration =
    input.configDir !== undefined
      ? ` from ${quotePath(input.cwd)}, with CLAUDE_CONFIG_DIR set to ${quotePath(input.configDir)}`
      : "";
  return `Claude could not authenticate. For subscription login, run \`claude auth login\` on this environment's machine${configuration}, then start a new thread. For API-key authentication, check this instance's configured credentials.`;
};
