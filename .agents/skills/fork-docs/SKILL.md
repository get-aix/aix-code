---
name: fork-docs
description: Fork documentation maintenance and screenshot refresh rules for get-aix/aix-code. You MUST activate this skill whenever adding, changing, or removing any fork feature, CLI command, environment variable, Nix flake option, release target, or fork UI flow so README.md and fork docs stay updated in the same PR.
---

# Fork documentation maintenance

Keep fork-owned documentation in sync with the code **in the same PR** as every user-visible or
operational fork change. Do not wait for a separate docs pass, and do not edit upstream-owned docs
unless the change belongs in an existing fork section.

## Code-to-doc map

When you change files on the left, review and update the docs on the right:

| Code area                                                                                                                                                                                                | Docs to review and update                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/aix/**`, `apps/server/src/provider/AixDiscovery.ts`, `apps/server/src/provider/*Aix*.ts`                                                                                                | `docs/user/aix-profiles.md`, `docs/user/fork.md`, `README.md`                                                                                             |
| `apps/server/src/orchestration-v2/ModelLanePolicy.ts`, `packages/shared/src/modelLanes.ts`, `apps/web/src/components/chat/ComposerLaneRows.tsx`, `apps/web/src/components/chat/ModelLaneRequestCard.tsx` | `docs/user/work-personal.md`, `docs/user/fork.md`, `README.md`                                                                                            |
| `apps/server/src/orchestration-v2/threadCost.ts`, `apps/web/src/components/chat/ThreadDetailsCost.tsx`, `apps/server/src/aix/ProfileBudget.ts`, `apps/server/src/usage/**`                               | `docs/user/aix-budgets.md`, `docs/user/usage.md` (fork paragraph), `docs/user/fork.md`, `README.md`                                                       |
| `apps/server/src/persistence/ForkMigrations.ts`, `apps/server/src/persistence/ForkEject.ts`, `apps/server/src/bin.ts` (fork subcommands)                                                                 | `docs/user/fork.md`, `docs/fork/soft-fork-guardrails.md`, `README.md`                                                                                     |
| `flake.nix`, `devenv.nix`                                                                                                                                                                                | `docs/user/install.md` (`### aix Code (Nix)`), `docs/operations/devenv.md`                                                                                |
| `.github/workflows/fork-*.yml`, `.github/workflows/mobile-android-fork.yml`, `.github/workflows/upstream-stable-sync.yml`, `.github/scripts/fork-*.cjs`, `.github/scripts/install-*`                     | `docs/operations/fork-release.md`, `docs/operations/android-fork-apk.md`, `docs/fork/README.md`, `docs/user/fork.md`, `docs/user/install.md`, `README.md` |
| Fork UI changes (sidebar scope switch, model picker, Work key, lane cards, thread cost, Usage limits, Settings → Providers)                                                                              | Update the affected user guide and refresh the matching screenshots in `.github/readme/fork/`                                                             |

## Writing style

- Write for humans, not for an architecture spec. Lead with what the feature does for the user and
  when they would use it.
- Name UI controls exactly as they appear in the app (e.g., **Project settings → Work key**,
  **Allow another key…**, **Thread cost → Details**).
- Keep upstream-owned files clean: only touch fork-owned docs (`README.md`, `docs/user/fork.md`,
  `docs/user/aix-profiles.md`, `docs/user/work-personal.md`, `docs/user/aix-budgets.md`,
  `docs/fork/**`, `docs/operations/fork-release.md`, `docs/operations/android-fork-apk.md`,
  `docs/operations/devenv.md`) and the dedicated fork sections in `docs/README.md`,
  `docs/user/install.md`, `docs/user/usage.md`, and `docs/user/providers-opencode.md`.
- Never include real hostnames, usernames, home paths, API keys, or private repos in text or
  screenshots. Use demo names such as `Acme`, `Research Lab`, `acme-web`, `billing-api`, and
  `garden-blog`.

## Refreshing screenshots

When a fork UI change makes a screenshot in `.github/readme/fork/` outdated:

1. Start an isolated dev server (`T3CODE_DEV_SEED=0`, `--home-dir <scratch>/t3-home`, unique
   `T3CODE_PORT_OFFSET`) with a mock `aix` script on `PATH` that serves fake `Acme` and
   `Research Lab` profiles, catalogs, and budgets. Never run against `~/.t3/userdata`.
2. Open T3 Browser (`preview_open`), set dark mode (`preview_set_appearance`) and `1440x900`
   (`preview_resize`), and navigate to the startup pairing URL.
3. Capture updated PNGs with `preview_snapshot(save: true)` and copy/crop them into
   `.github/readme/fork/`.
4. Keep every image referenced in markdown present on disk, and remove unused images.

## Before finishing

Run both automated doc checks from the repository root:

```sh
node --test scripts/fork-invariants.test.mjs scripts/check-fork-docs.test.mjs
node scripts/check-fork-docs.mjs
```
