import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeURL from "node:url";

const root = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => NodeFS.readFileSync(NodePath.join(root, relativePath), "utf8");
const listFiles = (relativePath) => {
  const directory = NodePath.join(root, relativePath);
  return NodeFS.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = NodePath.join(relativePath, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  });
};

const forkOwnedWorkflows = [
  "fork-ci.yml",
  "fork-release.yml",
  "fork-release-desktop.yml",
  "mobile-android-fork.yml",
  "upstream-stable-sync.yml",
];
const forkWorkflowReferences = [
  "get-aix/t3code",
  "fork-release.cjs",
  "fork-ci-checks.cjs",
  "Fork Quality",
  "Fork Server",
  "Fork Web",
  "Fork Desktop Build",
  "Fork Mobile Type and Unit",
];

NodeTest.test("fork-only workflow references stay out of upstream workflows", () => {
  const workflows = listFiles(".github/workflows").filter((file) => /\.ya?ml$/.test(file));
  const owned = new Set(forkOwnedWorkflows.map((workflow) => `.github/workflows/${workflow}`));
  NodeAssert.deepEqual(
    forkOwnedWorkflows.filter((workflow) => workflows.includes(`.github/workflows/${workflow}`)),
    forkOwnedWorkflows,
    "all fork-owned workflow files must exist",
  );

  for (const workflow of workflows) {
    if (owned.has(workflow)) continue;
    const contents = read(workflow);
    for (const reference of forkWorkflowReferences) {
      NodeAssert.ok(
        !contents.includes(reference),
        `${workflow} must not contain fork-only reference ${JSON.stringify(reference)}`,
      );
    }
  }

  NodeAssert.match(read(".github/workflows/fork-ci.yml"), /^name: Fork CI$/m);
  NodeAssert.match(read(".github/workflows/fork-release.yml"), /^name: Fork Release$/m);
  NodeAssert.match(
    read(".github/workflows/fork-release-desktop.yml"),
    /^name: Fork Release Desktop$/m,
  );
  NodeAssert.match(read(".github/workflows/upstream-stable-sync.yml"), /workflows:\s*\[Fork CI\]/);

  const configureFork = read("scripts/configure-fork-github.sh");
  const ownedBlock = configureFork.match(/fork_owned=\(([\s\S]*?)\)/)?.[1];
  NodeAssert.ok(ownedBlock, "configure-fork-github.sh must define its fork_owned array");
  const configuredWorkflows = ownedBlock
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  NodeAssert.deepEqual(configuredWorkflows, forkOwnedWorkflows);
});

NodeTest.test("fork SQLite migrations stay out of the upstream migration ledger", () => {
  const migrationNames = [
    "ProjectionProjectScope",
    "ProjectionProjectHomeAixProfile",
    "WaitingLaneRequestIndex",
  ];
  const upstreamMigrations = read("apps/server/src/persistence/Migrations.ts");
  for (const name of migrationNames) {
    NodeAssert.ok(!upstreamMigrations.includes(name), `upstream migration ledger contains ${name}`);
  }

  const migrationFiles = listFiles("apps/server/src/persistence/Migrations");
  for (const name of migrationNames) {
    NodeAssert.ok(
      !migrationFiles.some((file) => NodePath.basename(file).includes(name)),
      `upstream migrations directory contains a file for ${name}`,
    );
  }

  NodeAssert.match(
    read("apps/server/src/persistence/ForkMigrations.ts"),
    /export const FORK_MIGRATION_NAMES\s*=/,
  );
  NodeAssert.match(
    read("apps/server/src/persistence/ForkEject.ts"),
    /FORK_MIGRATION_NAMES[\s\S]*?from "\.\/ForkMigrations\.ts"/,
  );
});

NodeTest.test("usage cache and agent context budget retain fork-local differences", () => {
  const usageCache = read("apps/server/src/usage/usageScanCache.ts");
  const cacheFileName = usageCache.match(/SCAN_CACHE_FILE_NAME\s*=\s*"([^"]+)"/)?.[1];
  NodeAssert.match(cacheFileName ?? "", /^usage-scan-cache-aix-v\d+\.json$/);

  const cacheVersion = usageCache.match(/USAGE_SCAN_CACHE_VERSION\s*=\s*(\d+)/)?.[1];
  NodeAssert.ok(cacheVersion, "USAGE_SCAN_CACHE_VERSION must be an explicit numeric version");
  const forkCacheVersion = usageCache.match(/FORK_SCAN_CACHE_VERSION\s*=\s*(\d+)/)?.[1];
  NodeAssert.ok(
    forkCacheVersion,
    "FORK_SCAN_CACHE_VERSION must be an explicit numeric fork cache version",
  );

  const legacyNames = usageCache.match(/LEGACY_SCAN_CACHE_FILE_NAMES\s*=\s*\[([\s\S]*?)\]/)?.[1];
  NodeAssert.ok(legacyNames, "legacy cache filenames must be declared in an array");
  const upstreamVersion = Number(cacheVersion);
  for (const [, legacyVersionText] of legacyNames.matchAll(/usage-scan-cache-v(\d+)\.json/g)) {
    const legacyVersion = Number(legacyVersionText);
    NodeAssert.ok(
      legacyVersion < upstreamVersion,
      `LEGACY_SCAN_CACHE_FILE_NAMES must not delete upstream v${legacyVersion} cache (current upstream version is v${upstreamVersion})`,
    );
  }

  const budgetTest = read("apps/server/src/provider/AgentContextBudget.test.ts");
  NodeAssert.match(budgetTest, /const FORK_MCP_TOOL_LIST_ALLOWANCE_BYTES\s*=\s*\d+/);
  NodeAssert.ok(
    !read("apps/server/src/provider/agentContextBudget.json").includes(
      "FORK_MCP_TOOL_LIST_ALLOWANCE_BYTES",
    ),
    "fork budget allowance belongs in the test, not the upstream baseline JSON",
  );
});

// Pre-existing client-side prefix heuristics tracked as migration debt; do not add new entries.
const knownClientPrefixDebt = new Set([
  "apps/web/src/components/ChatView.logic.ts",
  "apps/web/src/modelSelection.ts",
  "apps/web/src/composerDraftStore.ts",
  "apps/mobile/src/state/use-composer-drafts.ts",
]);

NodeTest.test("AIX legacy prefix and SQL heuristics are not scattered through source", () => {
  const sourceFiles = [
    ...listFiles("apps/server/src"),
    ...listFiles("packages/shared/src"),
    ...listFiles("packages/client-runtime/src"),
    ...listFiles("apps/web/src"),
    ...listFiles("apps/mobile/src"),
  ].filter(
    (file) =>
      /\.(?:ts|tsx|mts)$/.test(file) &&
      !/\.(?:test|spec|browser\.test)\.(?:ts|tsx|mts)$/.test(file),
  );
  const legacyPrefixCall = /\.startsWith\s*\(\s*(["'])aix-\1\s*\)/;

  for (const file of sourceFiles) {
    const contents = read(file);
    NodeAssert.ok(
      !/\bLIKE\s+(['"])aix-%\1/i.test(contents),
      `${file} contains a fork-specific SQL LIKE`,
    );
    if (knownClientPrefixDebt.has(file)) continue;
    NodeAssert.ok(
      !legacyPrefixCall.test(contents),
      `${file} contains a scattered aix- prefix check`,
    );
  }
});

NodeTest.test("endpoint security stays centralized and AIX sync has an opt-out", () => {
  const discovery = read("apps/server/src/provider/AixDiscovery.ts");
  NodeAssert.ok(discovery.includes('"insecure-endpoint"'));
  NodeAssert.match(discovery, /(?:const|function)\s+isSecureEndpoint\b/);

  // Upstream-owned ClaudeHome.ts is checked only for duplicated isSecureEndpoint to avoid upstream sync false positives.
  NodeAssert.ok(
    !/\bisSecureEndpoint\b/.test(read("apps/server/src/provider/Drivers/ClaudeHome.ts")),
    "apps/server/src/provider/Drivers/ClaudeHome.ts duplicates isSecureEndpoint",
  );

  for (const relativePath of [
    "apps/server/src/provider/CodexAixLaunch.ts",
    "apps/server/src/provider/OpenCodeAixLaunch.ts",
  ]) {
    const contents = read(relativePath);
    NodeAssert.ok(
      !/\bisSecureEndpoint\b/.test(contents),
      `${relativePath} duplicates isSecureEndpoint`,
    );
    NodeAssert.ok(
      !contents.includes("127.0.0.1"),
      `${relativePath} duplicates loopback host checks`,
    );
    NodeAssert.ok(!contents.includes("[::1]"), `${relativePath} duplicates loopback host checks`);
  }

  const providerSync = read("apps/server/src/aix/ProviderInstanceSync.ts");
  NodeAssert.match(providerSync, /AIX_ENABLED_ENVIRONMENT_VARIABLE\s*=\s*"T3CODE_AIX"/);
  NodeAssert.match(providerSync, /isAixEnabled/);
  NodeAssert.match(providerSync, /environment\[AIX_ENABLED_ENVIRONMENT_VARIABLE\]/);
});

NodeTest.test("flake has one pnpm hash assignment and the restored public usage export", () => {
  const hashAssignments = read("flake.nix").match(/^\s*hash = "sha256-[^"]+";\s*$/gm) ?? [];
  NodeAssert.equal(
    hashAssignments.length,
    1,
    "flake.nix must have exactly one sha256 hash assignment",
  );

  NodeAssert.match(
    read("packages/shared/src/usageLimitsCopy.ts"),
    /\/\*\*\s*@public\s*\*\/\s*export function collectLimitNotices\(/,
  );
});
