# Soft-fork guardrails

This fork survives only as a soft fork: it adds features on top of upstream
(`pingdotgg/t3code`) and keeps pulling upstream stable releases. Upstream lands roughly 2,000
commits every two weeks, so every rule below keeps fork code in fork-owned namespaces, files, and
seams. Fork code that spreads into shared hot files turns each upstream sync into a manual merge.
Each rule names the reason it exists; if a reason stops holding, change the rule here.

## 1. SQLite migrations and downgrade safety

- Never insert fork migrations into `effect_sql_migrations`, and never renumber files in
  `apps/server/src/persistence/Migrations/`. Upstream owns that ledger and those numbers. The
  fork's ledger-repair code in [`ForkMigrations.ts`](../../apps/server/src/persistence/ForkMigrations.ts)
  moves legacy fork rows out of it; do not add new ones.
- Put fork DDL only in [`ForkMigrations.ts`](../../apps/server/src/persistence/ForkMigrations.ts).
  Each migration is tracked in `fork_migrations`, must be idempotent, and must stay schema-aware:
  `hasPendingForkMigrations` checks both `fork_migrations` and the live schema via
  `missingForkSchemaMigrations` (`PRAGMA table_info` / `sqlite_master`), so new fork migrations must
  update `missingForkSchemaMigrations` as well.
- Fork migrations run only when the caller includes them. The gate in
  [`Migrations.ts`](../../apps/server/src/persistence/Migrations.ts) is
  `toMigrationInclusive === undefined || toMigrationInclusive >= latestMigrationId`. Partial
  upstream migration tests depend on this; do not run fork DDL below that threshold.
- Keep [`ForkEject.ts`](../../apps/server/src/persistence/ForkEject.ts) (`t3 fork-eject`) in step
  with every fork-only row, event, or index. Eject must remove what the fork added and nothing
  upstream owns. Its test is [`ForkEject.test.ts`](../../apps/server/src/persistence/ForkEject.test.ts).

## 2. Caches, budgets, and upstream APIs

- Never bump an upstream cache version or delete an upstream cache file. The fork's usage scan cache
  lives in [`usageScanCache.ts`](../../apps/server/src/usage/usageScanCache.ts): upstream's cache
  version stays untouched, and fork state goes to `usage-scan-cache-aix-v1.json`, which the reader
  validates (`forkVersion` and the `ws`/`tws` bounds) before use.
- Never edit [`agentContextBudget.json`](../../apps/server/src/provider/agentContextBudget.json).
  It must match upstream byte for byte. Fork tool-list growth goes into the named allowance in
  [`AgentContextBudget.test.ts`](../../apps/server/src/provider/AgentContextBudget.test.ts), which
  adds it to the upstream value.
- Never delete upstream `@public` exports, upstream unit tests, or non-AIX Personal-mode behavior.
  Example: `collectLimitNotices` in [`usageLimitsCopy.ts`](../../packages/shared/src/usageLimitsCopy.ts)
  is the non-AIX limit-notice path.
- Keep `apps/desktop/src/**` at zero code diff against upstream whenever server-side defaults are
  enough. The AIX opt-out `T3CODE_AIX=0` (or `false`) is read in
  [`ProviderInstanceSync.ts`](../../apps/server/src/aix/ProviderInstanceSync.ts), so the desktop
  shell needs no change for it.

## 3. Hot-file isolation and concurrency

- Keep inline diffs small in high-churn upstream files: `Orchestrator.ts`, `CodexAdapterV2.ts`,
  `ClaudeAdapterV2.ts`, `OrchestratorMcpService.ts`, and `ProjectionStore.ts`. Put fork logic in
  fork-owned modules and call them from the hot file. Existing examples:
  [`ModelLanePolicy.ts`](../../apps/server/src/orchestration-v2/ModelLanePolicy.ts),
  [`CodexAixClientProxy.ts`](../../apps/server/src/orchestration-v2/Adapters/CodexAixClientProxy.ts),
  and the decorator driver [`OpenCodeAixDriver.ts`](../../apps/server/src/provider/Drivers/OpenCodeAixDriver.ts).
- Enforce single-use lane grants (`allowed_task`) inside a serialized orchestrator command. Take
  the parent thread's dispatch lock before the child's (see `dispatchWithReceipt` alongside
  `withSubagentParentLock` in
  [`Orchestrator.ts`](../../apps/server/src/orchestration-v2/Orchestrator.ts)), and commit the
  consumption in the same transaction as the events it authorizes. Never check a grant outside the
  orchestrator and act on it later; two turns can both see an unconsumed grant.
- `ModelLaneNotAllowedError` is a user-changeable refusal. The orchestrator returns it without
  writing a rejected command receipt (see the refusal branch in
  [`Orchestrator.ts`](../../apps/server/src/orchestration-v2/Orchestrator.ts)), so a retry with the
  same `clientRequestId` succeeds after the user approves. Any attachments the command claimed must
  be released on refusal; see [`ThreadMessageIntake.ts`](../../apps/server/src/orchestration-v2/ThreadMessageIntake.ts).
  A permanent receipt for a refusal the user can undo blocks that retry.

## 4. Metadata over magic strings, and centralized security

- Classify AIX providers from explicit `aixProfile` metadata via
  [`modelLanes.ts`](../../packages/shared/src/modelLanes.ts). Do not write `startsWith("aix-")` or
  SQL `LIKE 'aix-%'`: a manually added instance named `aix-*` is Work only if its metadata says
  so. Instance IDs are built with a prefix in
  [`ProviderInstanceSync.ts`](../../apps/server/src/aix/ProviderInstanceSync.ts), but that prefix is
  not a classification. Several web and mobile call sites still use the prefix heuristic; treat them
  as migration debt, not as a pattern to copy.
- Filter SQLite usage queries by the explicit configured AIX instance IDs, and skip the query when
  there are none. [`UsageService.ts`](../../apps/server/src/usage/UsageService.ts) does this; an empty
  `IN ()` list or an unfiltered scan is a regression.
- HTTPS and loopback endpoint validation lives only in
  [`AixDiscovery.ts`](../../apps/server/src/provider/AixDiscovery.ts). It returns two distinct
  reasons, `"insecure-endpoint"` (plain HTTP to a non-loopback host) and `"invalid-endpoint"`
  (unparseable URLs, non-`http:`/`https:` schemes, empty hostnames, or URLs containing userinfo). Do
  not merge them, and do not re-implement the check in a driver.
- Collation uses a fixed locale. [`ModelCatalog.ts`](../../apps/server/src/aix/ModelCatalog.ts) sorts
  with `"en"`, so order does not depend on the user's language. Do not hardcode another locale.

## 5. Workflows, CI gates, and upstream syncs

- Never edit upstream `.github/workflows/*.yml` files or add an inline `if:` guard to them. Fork
  workflows live in their own files with fork-specific names: `Fork CI`
  (`fork-ci.yml`), `Fork Release` (`fork-release.yml`), `Fork Release Desktop`
  (`fork-release-desktop.yml`), `Nitestack Android APK` (`mobile-android-fork.yml`), and
  `Upstream Stable Sync` (`upstream-stable-sync.yml`). The fork-owned list is in
  [`configure-fork-github.sh`](../../scripts/configure-fork-github.sh).
- After an upstream sync adds new upstream workflow files, run
  `bash scripts/configure-fork-github.sh` (add `--dry-run` to preview) to disable them in the GitHub
  repository settings. Disabling lives in GitHub, not in the tree, which is why upstream files stay
  untouched.
- The five `Fork CI` checks are required on `main`: `Fork Quality`, `Fork Server`, `Fork Web`,
  `Fork Desktop Build`, and `Fork Mobile Type and Unit`. Their names are fixed in
  [`fork-ci-checks.cjs`](../../.github/scripts/fork-ci-checks.cjs), which the sync uses to verify
  exact-head CI before queueing releases. Renaming a job without updating that list makes the sync
  refuse to queue releases.
- `Fork Quality` runs `vp fmt --check`, `vp lint --report-unused-disable-directives`,
  `vp run i18n:check`, `vp run knip:check`, `node --test scripts/fork-invariants.test.mjs`,
  typechecks for contracts, shared, client-runtime, and web, and the shared and client-runtime
  tests. See [`fork-ci.yml`](../../.github/workflows/fork-ci.yml).
- Keep `flake.nix` with exactly one `hash = "sha256-..."` assignment under `pnpmDeps`.
  [`update-flake-pnpm-hash.mjs`](../../scripts/update-flake-pnpm-hash.mjs) rewrites that line on
  lockfile changes, and `validateSyncBranch` in
  [`upstream-stable-sync.mjs`](../../scripts/upstream-stable-sync.mjs) expects that shape. A second
  hash line, or a hash on another line, breaks both.

### Reviewing an upstream sync

A green sync PR proves only what `Fork CI` builds: Linux, plus server, web, and mobile tests. It
does not build the macOS app, the Windows installer, the signed Android APK, or the Nix package.
Those break first in the post-merge build-only `Fork Release`, after the merge is already on `main`.
The v0.1.12 sync is an example: upstream's Apple Speech helper (`native/apple-speech`) needed Xcode
26, and upstream had moved its macOS release runner to macOS 26. CI stayed green, and the fork's
`macos-15` release build could not compile the helper.

So review the sync commit by commit, not by diffstat:

- Read every upstream commit in the range (`git log --no-merges --stat <previous tag>..<new tag>`).
  For each one, decide whether the fork must follow: a mirror workflow, a fork seam, a fork doc, or
  nothing. Write down the ones that need a follow-up in the PR before merging, and fix them in the
  sync branch.
- Treat infrastructure as code. Commits that touch `.github/workflows/**`, `scripts/build-*` and
  release scripts, `apps/desktop/scripts/**`, `native/**`, mobile build config, toolchain pins, or
  `package.json` `engines` often have no visible feature but change what the fork's own pipelines
  need.
- Diff upstream's `release.yml`, `release-desktop.yml`, `ci.yml`, and mobile build workflows against
  their fork mirrors (`fork-release.yml`, `fork-release-desktop.yml`, `fork-ci.yml`,
  `mobile-android-fork.yml`, `flake.nix`). Compare runner images, Xcode, Node, Rust, and Java
  versions, new build steps, new secrets, and new artifacts. A fork mirror that falls behind upstream
  fails silently until the release.
- New native modules and new platform requirements (minimum macOS, Xcode, or Android SDK) need an
  explicit decision for every fork build target, not only the one the reviewer tested.

## 6. UI, i18n, and the local toolchain

- Wrap every user-facing fork string in the project's i18n helpers (`<T>`, `gt()`, `m(msg())`).
  Translate each new key into all nine non-English locales in
  [`apps/web/src/i18n/translations/`](../../apps/web/src/i18n/translations/) and
  [`apps/mobile/src/i18n/translations/`](../../apps/mobile/src/i18n/translations/): `de`, `es`, `fr`,
  `ja`, `ko`, `pt-BR`, `ru`, `sv`, and `zh`. Do not commit English text as a translation. Check that
  placeholders and their order match the English string. Then run `vp run i18n:generate` and
  `vp run i18n:check`; see [AGENTS.md](../../AGENTS.md#hit-every-surface).
- Use the repo-pinned `./node_modules/.bin/vp`. A global `vp` can be a different version and produce
  formatting or lint output that CI rejects.

## 7. Self-updating fork documentation

- Update fork-owned documentation **in the same pull request** whenever a change adds, changes, or
  removes a user-visible or operational fork feature (aix profiles, Work/Personal scopes, Work keys
  and lane approvals, budgets or thread cost, `t3 fork-eject`, `flake.nix` options, or fork
  CI/release workflows). Follow the code-to-doc map and screenshot refresh guide in the
  [`fork-docs` skill](../../.agents/skills/fork-docs/SKILL.md).
- Keep upstream-owned documentation clean: update only fork-owned docs and the dedicated fork
  sections in `docs/README.md`, `docs/user/install.md`, `docs/user/usage.md`, and
  `docs/user/providers-opencode.md`.
- `scripts/fork-invariants.test.mjs` fails CI if any local link or screenshot in fork docs breaks,
  if a `flake.nix` output or `.override` toggle is undocumented, or if stale workflow names reappear.
  On pull requests, `scripts/check-fork-docs.mjs` also posts a step-summary reminder whenever mapped
  fork code changes without a matching doc edit.

## 8. Branding

The fork ships as **aix Code** with the aix mark, at T3 Code's request that forks not use its name
or logo. Only the outward identity changes. Bundle and package IDs (`com.t3tools.t3code`), URL
schemes, the `t3` CLI, the `T3CODE_*` variables, `~/.t3`, and Electron userData directories stay
upstream's, so data, updates, T3 Connect, and `t3 fork-eject` keep working. Do not rename them.

- The name lives in a few one-line seams that `fork-invariants.test.mjs` checks: web
  `branding.ts`, `vite.config.ts`, `index.html`, `manifest.webmanifest`, desktop
  `DesktopEnvironment.ts` and `package.json` `productName`, `build-desktop-artifact.ts` (product,
  artifact, author, and macOS usage strings), the `android-fork` variant in `app.config.ts`,
  `flake.nix`, and `PRODUCT_NAME` in `fork-release.cjs`. Leave in-app sentences that mention
  T3 Code alone: rewriting hundreds of upstream strings and catalogs would conflict on every sync.
- The mark is `text.svg` in each `assets/*/app-icon.icon` project plus the `T3Wordmark`
  components. Icon Composer only runs on macOS, so regenerate the tracked exports with
  `vp run icons:export:fork` and then `vp run icons:export:android`. When a sync
  conflicts on an icon, keep the fork's `text.svg`, take upstream's other layers, and rerun both.
- Fork bug reports go to `get-aix/t3code`: boot-error and triage links, the startup recovery
  releases link, and the download URL point there. The macOS signing identity stays
  `T3 Code Fork`, because changing the certificate breaks in-app updates on installed Macs.

## Automated enforcement

These checks run without a human remembering the rule. Extend the existing test when a rule gains a
new case.

| Guardrail                                                                                                                                | Enforced by                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Translations complete                                                                                                                    | `vp run i18n:check` in `Fork Quality`                                                                                                               |
| Unused exports and dependencies                                                                                                          | `vp run knip:check` in `Fork Quality`                                                                                                               |
| Lint and unused disable directives                                                                                                       | `vp lint --report-unused-disable-directives` in `Fork Quality`                                                                                      |
| Workflow isolation, migration ledger, cache namespace, `aix-`/SQL heuristics, endpoint guard, `T3CODE_AIX`, flake hash, `@public` export | [`fork-invariants.test.mjs`](../../scripts/fork-invariants.test.mjs) in `Fork Quality`                                                              |
| Fork doc links, screenshot paths, `flake.nix` option coverage, and PR doc-sync reminders                                                 | [`fork-invariants.test.mjs`](../../scripts/fork-invariants.test.mjs) & [`check-fork-docs.mjs`](../../scripts/check-fork-docs.mjs) in `Fork Quality` |
| Required checks match sync expectations                                                                                                  | [`fork-ci-checks.test.cjs`](../../.github/scripts/fork-ci-checks.test.cjs)                                                                          |
| Sync branch shape and merge gating                                                                                                       | [`upstream-stable-sync.test.mjs`](../../scripts/upstream-stable-sync.test.mjs)                                                                      |
| Single flake hash on lockfile updates                                                                                                    | [`update-flake-pnpm-hash.test.mjs`](../../scripts/update-flake-pnpm-hash.test.mjs)                                                                  |
| Context budget matches upstream plus allowance                                                                                           | [`AgentContextBudget.test.ts`](../../apps/server/src/provider/AgentContextBudget.test.ts)                                                           |
| aix Code name and mark in the branding seams                                                                                             | [`fork-invariants.test.mjs`](../../scripts/fork-invariants.test.mjs)                                                                                |
| Fork-only schema is ejectable                                                                                                            | [`ForkEject.test.ts`](../../apps/server/src/persistence/ForkEject.test.ts)                                                                          |

These cannot be fully checked statically, so review must still catch them: English text copied into
non-English catalogs or swapped placeholders, large inline blocks added to upstream hot files
instead of fork modules, and upstream `agentContextBudget.json` edits that shift baseline numbers.

## Changing a guardrail

Change this page, the [skill](../../.agents/skills/soft-fork-guardrails/SKILL.md), and the code or
test that enforces the rule in the same pull request. Keep the reason next to the rule, and rewrite a
rule when its reason changes rather than adding a note beneath it.
