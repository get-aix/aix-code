---
name: soft-fork-guardrails
description: Soft-fork maintainability rules for the get-aix/t3code fork. You MUST activate this skill whenever editing fork features, adding or changing SQLite migrations, caches, usage budgets, workflows, or user-facing UI copy, or syncing from upstream pingdotgg/t3code in this fork. Keeps fork code out of upstream-owned files so upstream stable syncs merge cleanly.
---

# Soft-fork guardrails

Upstream moves thousands of commits every two weeks. Fork code survives a sync only when it stays in
fork-owned files and seams. The full rules and their reasons are in
[docs/fork/soft-fork-guardrails.md](../../../docs/fork/soft-fork-guardrails.md). Read it before
making a change that matches one of the triggers in the description.

## Before editing

- Find the owner of the code you are about to change. If it is an upstream hot file (`Orchestrator.ts`,
  `CodexAdapterV2.ts`, `ClaudeAdapterV2.ts`, `OrchestratorMcpService.ts`, `ProjectionStore.ts`),
  plan a fork-owned module and keep the inline change to a call site.
- Check whether the file is upstream-owned: `agentContextBudget.json`, upstream migrations under
  `apps/server/src/persistence/Migrations/`, upstream `.github/workflows/*.yml`, and
  `apps/desktop/src/**` all stay identical to upstream unless a rule says otherwise.
- Do not run the repo-pinned tools through a global binary. Use `./node_modules/.bin/vp`.

## During implementation

- **Migrations:** fork DDL goes only in `apps/server/src/persistence/ForkMigrations.ts`. Make it
  idempotent, track it in `fork_migrations`, and never write it to `effect_sql_migrations`. Keep
  `ForkEject.ts` in step with every fork-only row, event, or index.
- **Caches and budgets:** never bump an upstream cache version or delete an upstream cache file. Fork
  cache state goes to its own file with a validated `forkVersion`. Fork tool-byte growth goes in
  the allowance in `AgentContextBudget.test.ts`, not in the JSON.
- **Provider classification:** use the explicit `aixProfile` metadata through
  `packages/shared/src/modelLanes.ts`. Do not add `startsWith("aix-")` or SQL `LIKE 'aix-%'`.
- **Endpoints:** HTTPS and loopback checks live only in `AixDiscovery.ts`. Do not re-implement them
  in a driver.
- **Lane grants:** enforce `allowed_task` consumption inside a serialized orchestrator command.
  Refusals that the user can undo (`ModelLaneNotAllowedError`) must not write a permanent rejected
  receipt, and must release claimed attachments.
- **Workflows:** add fork workflows as new files with fork names. Never add an `if:` guard to an
  upstream workflow.
- **UI copy:** wrap every user-facing string in the i18n helpers (`<T>`, `gt()`, `m(msg())`). Add
  the key to all nine non-English locales in `apps/web/src/i18n/translations/` and
  `apps/mobile/src/i18n/translations/`, with placeholders in the same order as English. Never commit
  English text into a non-English catalog.
- **Collation:** keep the fixed `"en"` locale in `ModelCatalog.ts`.
- **Fork docs:** whenever a change alters user-visible or operational fork behavior (aix profiles,
  Work/Personal scopes, Work keys and lane approvals, budgets or thread cost, `fork-eject`,
  `flake.nix`, or fork CI/release workflows), activate `fork-docs` and update the mapped fork docs
  in the same PR.

## Reviewing an upstream sync

A green sync PR only proves the Linux build and the test suites. Follow
[Reviewing an upstream sync](../../../docs/fork/soft-fork-guardrails.md#reviewing-an-upstream-sync):

- Read every upstream commit in the range (`git log --no-merges --stat <previous tag>..<new tag>`),
  not only the diffstat or the commit titles, and decide for each whether the fork must follow.
- Give infrastructure commits (workflows, build and release scripts, `native/`, mobile build config,
  toolchain pins) the same attention as feature code.
- Diff upstream `release.yml`, `release-desktop.yml`, `ci.yml`, and mobile build workflows against
  `fork-release.yml`, `fork-release-desktop.yml`, `fork-ci.yml`, `mobile-android-fork.yml`, and
  `flake.nix`: runner images, Xcode/Node/Rust/Java versions, steps, secrets, artifacts.
- List the commits that need a fork follow-up in the sync PR and fix them before merging.

## Before pushing or syncing

- Run `vp run check:changed` as [AGENTS.md](../../../AGENTS.md#verifying) describes. Use
  `./node_modules/.bin/vp` for format checks.
- Confirm the automated checks that cover your change still pass:
  `node --test scripts/fork-invariants.test.mjs scripts/check-fork-docs.test.mjs .github/scripts/fork-ci-checks.test.cjs scripts/upstream-stable-sync.test.mjs scripts/update-flake-pnpm-hash.test.mjs`,
  plus `node scripts/check-fork-docs.mjs`, `apps/server/src/provider/AgentContextBudget.test.ts`,
  and `apps/server/src/persistence/ForkEject.test.ts`.
- If upstream added workflow files in a sync, run `bash scripts/configure-fork-github.sh --dry-run`,
  then the same command without `--dry-run`, to disable them in the repository settings.
- Keep `flake.nix` with exactly one `hash = "sha256-..."` line so `update-flake-pnpm-hash.mjs` and
  `validateSyncBranch` keep working on lockfile updates.
- Keep `Fork Quality` and the other four `Fork CI` jobs green. They are required on `main`.

If a rule here blocks the task, say so and get a maintainer's sign-off before you break it.
