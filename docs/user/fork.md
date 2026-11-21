# The get-aix/t3code fork

**get-aix/t3code** is a soft fork of [T3 Code](https://github.com/pingdotgg/t3code) (created by
pingdotgg, MIT licensed). It keeps everything you love about T3 Code and adds first-class support
for company AI gateways through [aix](https://github.com/get-aix/aix):

- **[aix profiles](./aix-profiles.md):** every API-key profile in aix becomes ready-to-use Claude
  Code, Codex, and OpenCode providers with full model catalogs, pricing, and details.
- **[Personal and Work](./work-personal.md):** keep work projects on your team's gateway and
  personal projects on your own subscriptions—with project **Work keys** and cross-key approval
  cards when an agent asks to cross boundaries.
- **[Gateway budgets & thread costs](./aix-budgets.md):** track key and project dollar budgets on
  the Usage page, check `/usage-limits` from any thread, and see live per-thread and per-subagent
  dollar costs in the Thread details panel.
- **Fork builds:** self-updating desktop apps for Windows (with WSL support) and Apple Silicon
  macOS, a feature-rich Nix flake, and a sideloadable Android APK.

Because the fork uses the same app name (`T3 Code`), `t3` / `t3code-desktop` commands, and data
directory (`~/.t3`) as upstream T3 Code, install it **instead of** upstream T3 Code, not alongside
it.

## Install

Download from the fork's [latest release](https://github.com/get-aix/t3code/releases/latest):

| Platform              | File or command                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| Windows x64           | `irm https://github.com/get-aix/t3code/releases/latest/download/install-windows.ps1 \| iex`      |
| macOS (Apple Silicon) | `curl -fsSL https://github.com/get-aix/t3code/releases/latest/download/install-macos.sh \| bash` |
| Nix / NixOS           | `nix profile add 'github:get-aix/t3code/release'`                                                |
| Android               | `T3-Code-<version>.apk`                                                                          |

Platform notes:

- **Windows:** run the command in a normal PowerShell window (not as administrator). It verifies the
  SHA-256 checksum and installs **T3 Code** for your user without admin rights or SmartScreen
  warnings. Quit T3 Code first. Set `$env:T3CODE_VERSION = "<version>"` for a specific release. You
  can also run `T3-Code-<version>-x64.exe` directly, though Windows SmartScreen will prompt **More
  info → Run anyway** because it is unsigned.
- **macOS:** use the install script—the app is self-signed rather than notarized, so Gatekeeper
  blocks a browser-downloaded zip. The script verifies the SHA-256 checksum and installs **T3 Code**
  into `/Applications` (or `~/Applications`). Quit T3 Code first. Set `T3CODE_VERSION=<version>` for
  a specific release.
- **Nix / NixOS:** builds from source for Linux and macOS (`x86_64` and `aarch64`), with optional
  `t3code-browser`, `t3code-android`, and `t3code-full` outputs and `.override` toggles. See
  [T3 Code fork (Nix)](./install.md#t3-code-fork-nix).
- **Android:** see [The Android app](#the-android-app).

After installing, set up your providers in [Install T3 Code](./install.md#providers) and
[aix profiles](./aix-profiles.md#set-up-aix).

### Switch from upstream T3 Code (and go back anytime)

Your threads, projects, and settings carry straight over because the fork shares the same data
directory:

1. Quit T3 Code.
2. Back up your T3 data directory (`~/.t3` by default) before upgrading.
3. Uninstall upstream T3 Code (or remove its Nix package).
4. Install the fork and start it.

Existing projects start in **Personal**. Move work projects to **Work** as described in
[Personal and Work](./work-personal.md#move-a-project).

Want to switch back to upstream T3 Code? The fork is designed to stay cleanly reversible:

- Fork database migrations live in a separate `fork_migrations` ledger rather than upstream's
  migration table.
- Fork usage scan caching uses its own file (`usage-scan-cache-aix-v1.json`) without modifying
  upstream cache files.
- Before opening your database in upstream T3 Code, strip all fork-only database state with:

```sh
t3 fork-eject --dry-run
t3 fork-eject
```

Then quit T3 Code, uninstall the fork, and install upstream T3 Code. Your personal provider sign-ins,
projects, and threads keep working.

If you just want to pause aix temporarily without switching builds, set `T3CODE_AIX=0` on the server
or toggle individual aix providers off in **Settings → Providers** (your manual disable choices
persist across syncs).

## Updates

Desktop apps on Windows and macOS update themselves automatically from fork releases through the
built-in updater. Nix installs update through Nix (`nix profile upgrade` or `nix flake update t3code`
followed by a rebuild). On Android, install the newer APK from the Releases page.

Avoid installing upstream T3 Code or its Nix package over the fork—it will replace the fork binary
and stop fork updates.

### Version numbers

Fork releases keep upstream's version numbers: `v0.1.11` is upstream T3 Code `0.1.11` with the
fork's changes layered on top.

Fork-only fixes shipped between upstream releases use `X.Y.(Z+1)-aix.N` (for example,
`0.1.12-aix.1` is the first fork fix after `0.1.11`). Installed apps update smoothly to the `-aix.N`
build and then forward to upstream `0.1.12` once it lands.

The fork tracks upstream **stable releases only**—never upstream prereleases or unreleased `main`.

## The Android app

The fork's Android APK includes the Personal/Work switch, scope-aware model picker, Work key
selection, lane approval cards, and model details, with the launcher label **T3 Code**.

It uses the official package ID (`com.t3tools.t3code`) so T3 Connect sign-in works, which means it
replaces the Play Store app:

1. Uninstall T3 Code from the Play Store.
2. Download `T3-Code-<version>.apk` from the fork's Releases page and open it (allow installing from
   your browser if Android prompts).
3. Update only from fork releases—Google Play cannot update this APK.

There is no fork iOS app. The official App Store app still connects to a fork server and runs aix
providers like any other provider, just without the Personal/Work switch or model details.

## Mixing fork and upstream clients

A fork server works with any T3 Code client: the fork's desktop and web apps, `app.t3.codes`, and
the official mobile apps. aix providers appear in all of them, while fork-specific UI (Personal/Work
scopes, Work keys, lane approval cards, model details, and thread cost breakdown) appears in fork
clients.

One client can also connect to both an upstream T3 server and a fork server at the same time. See
[Remote access](./remote-access.md).

## What this fork changes

Compared with upstream T3 Code:

- **aix profiles:** API-key profiles from aix become Claude Code, Codex, and OpenCode providers,
  with catalogs, prices, and budgets read directly from aix (`T3CODE_AIX=0` opts out). See
  [aix profiles](./aix-profiles.md).
- **Model details & Free badges:** family, context window, max output, per-million-token pricing,
  and reasoning levels in the model picker, with daily + on-demand catalog refresh and stale
  warnings.
- **Personal and Work scopes:** every project has a scope followed by the sidebar, search, model
  picker, Settings → Providers, Project settings, Usage, and the command palette on web, desktop,
  and Android. See [Personal and Work](./work-personal.md).
- **Work keys & cross-key approvals:** Work projects set a default Work key; sending on another key
  prompts for confirmation, agents asking for another key show interactive approval cards, and you
  can pre-approve keys right on a draft or thread.
- **Gateway budgets & AIX thread cost breakdown:** the Usage page and `/usage-limits` banner show
  aix key and project dollar budgets, and the Thread details panel shows live per-thread and
  per-subagent dollar costs for aix threads. See [Gateway budgets](./aix-budgets.md).
- **Usage by scope:** Codex and Claude usage from Work projects is tracked under Work.
- **Reversible soft-fork storage:** separate `fork_migrations` ledger, separate usage scan cache,
  and `t3 fork-eject` to return cleanly to upstream.
- **Fork builds & stable-only sync:** Windows x64 (with WSL), Apple Silicon macOS, Nix flake
  (`t3code-browser`, `t3code-android`, `t3code-full`), and Android APK, synced only from upstream
  stable releases.

Everything else—threads, worktrees, checkpoints, remote access, T3 Connect, and all other
providers—works just as described in the [T3 Code guides](../README.md#using-t3-code).

## Run from source

Install [vp](../operations/development.md#first-checkout), then:

```sh
git clone https://github.com/get-aix/t3code.git
cd t3code
vp i
vp run dev
```

Open the URL printed at startup (`main` contains unreleased fork changes). Give each independent T3
server its own `T3CODE_HOME` if you run an upstream server on the same machine. On NixOS, you can
use the [devenv shell](../operations/devenv.md).

To update a clean checkout:

```sh
git pull --ff-only origin main
vp i
```

Restart with the same `T3CODE_HOME`. Back up that directory before upgrading—checking out an older
commit does not reverse database migrations. To return to an earlier revision, stop the server, run
`git switch --detach <commit>`, run `vp i`, and restart.

## Help

- [aix profiles: troubleshooting](./aix-profiles.md#troubleshooting)
- [Remote access](./remote-access.md) and [T3 Connect troubleshooting](./t3-connect-troubleshooting.md)
- General T3 Code usage: [T3 Code guides](../README.md#using-t3-code)
