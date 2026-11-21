import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";

export const FORK_DOC_RULES = [
  {
    id: "aix-profiles",
    label: "aix discovery, catalogs, or provider sync",
    matches: (file) =>
      file.startsWith("apps/server/src/aix/") ||
      file === "apps/server/src/provider/AixDiscovery.ts" ||
      /^apps\/server\/src\/provider\/.*Aix.*\.ts$/.test(file),
    docs: ["docs/user/aix-profiles.md", "docs/user/fork.md", "README.md"],
  },
  {
    id: "work-personal-lanes",
    label: "Work/Personal scopes, Work keys, or model lane approvals",
    matches: (file) =>
      file === "apps/server/src/orchestration-v2/ModelLanePolicy.ts" ||
      file === "packages/shared/src/modelLanes.ts" ||
      file === "apps/web/src/components/chat/ComposerLaneRows.tsx" ||
      file === "apps/web/src/components/chat/ModelLaneRequestCard.tsx",
    docs: ["docs/user/work-personal.md", "docs/user/fork.md", "README.md"],
  },
  {
    id: "budgets-and-cost",
    label: "gateway budgets or AIX thread cost breakdown",
    matches: (file) =>
      file === "apps/server/src/aix/ProfileBudget.ts" ||
      file === "apps/server/src/orchestration-v2/threadCost.ts" ||
      file === "apps/web/src/components/chat/ThreadDetailsCost.tsx",
    docs: ["docs/user/aix-budgets.md", "docs/user/usage.md", "docs/user/fork.md", "README.md"],
  },
  {
    id: "fork-migrations-eject",
    label: "fork SQLite migrations or fork-eject CLI",
    matches: (file) =>
      file === "apps/server/src/persistence/ForkMigrations.ts" ||
      file === "apps/server/src/persistence/ForkEject.ts",
    docs: ["docs/user/fork.md", "docs/fork/soft-fork-guardrails.md", "README.md"],
  },
  {
    id: "nix-flake",
    label: "Nix flake or devenv shell",
    matches: (file) => file === "flake.nix" || file === "devenv.nix",
    docs: ["docs/user/install.md", "docs/operations/devenv.md"],
  },
  {
    id: "fork-release-and-ci",
    label: "fork CI, release workflows, or install scripts",
    matches: (file) =>
      /^\.github\/workflows\/(fork-.*|mobile-android-fork|upstream-stable-sync)\.yml$/.test(file) ||
      /^\.github\/scripts\/(fork-.*|install-.*)/.test(file) ||
      file === "scripts/configure-fork-github.sh" ||
      file === "scripts/upstream-stable-sync.mjs",
    docs: [
      "docs/operations/fork-release.md",
      "docs/operations/android-fork-apk.md",
      "docs/fork/README.md",
      "docs/user/fork.md",
      "docs/user/install.md",
      "README.md",
    ],
  },
];

const isTestFile = (file) => /\.(?:test|spec|browser\.test)\.[cm]?[jt]sx?$/.test(file);

/**
 * Given a list of changed repo-relative file paths, returns any fork doc rules
 * whose code changed without any of the rule's mapped docs being updated.
 */
export function findMissingForkDocUpdates(changedFiles) {
  const changedSet = new Set(changedFiles);
  const missing = [];

  for (const rule of FORK_DOC_RULES) {
    const matchedFiles = changedFiles.filter((file) => !isTestFile(file) && rule.matches(file));
    if (matchedFiles.length === 0) continue;
    const anyDocUpdated = rule.docs.some((doc) => changedSet.has(doc));
    if (!anyDocUpdated) {
      missing.push({
        id: rule.id,
        label: rule.label,
        matchedFiles,
        suggestedDocs: rule.docs,
      });
    }
  }

  return missing;
}

function getChangedFiles(baseRef) {
  const args = baseRef
    ? ["diff", "--name-only", `${baseRef}...HEAD`]
    : ["diff", "--name-only", "HEAD"];
  const output = NodeChildProcess.execFileSync("git", args, { encoding: "utf8" });
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function main() {
  const baseRef = process.argv[2] || process.env.FORK_DOCS_BASE_REF || "";
  let changedFiles;
  try {
    changedFiles = getChangedFiles(baseRef);
  } catch (error) {
    console.warn(`check-fork-docs: could not inspect git diff (${error.message})`);
    return;
  }

  const missing = findMissingForkDocUpdates(changedFiles);
  if (missing.length === 0) {
    console.log("check-fork-docs: fork docs look up to date for this diff.");
    return;
  }

  const summaryLines = [
    "### Fork documentation reminder",
    "",
    "This change updates fork code without updating the corresponding fork docs. If user-visible or operational behavior changed, update the docs listed below (see `.agents/skills/fork-docs/SKILL.md`):",
    "",
  ];

  for (const item of missing) {
    const msg = `Fork area "${item.label}" changed (${item.matchedFiles.join(", ")}), consider updating: ${item.suggestedDocs.join(", ")}`;
    if (process.env.GITHUB_ACTIONS === "true") {
      console.log(`::warning title=Fork docs may need an update::${msg}`);
    } else {
      console.log(`WARNING: ${msg}`);
    }
    summaryLines.push(
      `- **${item.label}** (\`${item.matchedFiles.join("`, `")}\`): review ${item.suggestedDocs.map((d) => `\`${d}\``).join(", ")}`,
    );
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    NodeFS.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summaryLines.join("\n")}\n`);
  }
}

if (NodeURL.fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
