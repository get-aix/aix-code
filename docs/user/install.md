# Install T3 Code

T3 Code runs coding agents on your computer (or server) and lets you control them from the desktop app, web app, or mobile app. Install T3 Code on the machine where your agents will run first.

## Requirements

You need at least one installed, authenticated coding agent (provider) before starting a thread. You can launch T3 Code first and set up providers from the [Welcome page](./welcome-page.md) or **Settings → Providers**.

## Command line

Install the `t3` command to `~/.local/bin`:

```bash
# macOS / Linux
curl -fsSL https://t3.codes/install.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://t3.codes/install.ps1 | iex
```

Set `T3CODE_CHANNEL=nightly` for nightly builds or `T3CODE_VERSION=<ver>` to pin a version. To try once without installing, run `npx t3@latest` (requires Node.js; always runs the latest stable release).

| Task                          | Command                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- |
| Start server and open web app | `t3` (or `t3 ./my-project`)                                             |
| Start server without browser  | `t3 serve`                                                              |
| Set up remote access          | `t3 up` ([Remote access](./remote-access.md))                           |
| Run in the background         | `t3 service install` ([Background service](./background-service.md))    |
| Update                        | `t3 update`                                                             |
| Reclaim database space        | `t3 doctor` ([Details](./background-service.md#reclaim-database-space)) |
| Uninstall                     | `t3 uninstall`                                                          |

If `t3` reports a server is already running, connect with `t3 pair` or pass a separate `--base-dir`. Run `t3 --help` for all commands.

### Intel Macs

There is no standalone `t3` binary for Intel Macs—use the desktop app, or build a server from source with `vp` ([development runbook](../operations/00_development.md#first-checkout)):

```bash
git clone https://github.com/pingdotgg/t3code
cd t3code && vp i && vp run build:desktop
node apps/server/dist/bin.mjs
```

## Desktop app

Download from [GitHub Releases](https://github.com/pingdotgg/t3code/releases) or install via a package manager:

| Platform                | Command                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| macOS                   | `brew install --cask t3-code`                                    |
| Windows                 | `winget install T3Tools.T3Code` or `scoop install extras/t3code` |
| Debian / Ubuntu         | `sudo apt install ./T3-Code-*.deb`                               |
| Arch Linux              | `yay -S t3code-bin` (or `yay -S t3code-nightly-bin`)             |
| Nix (flakes, Nix 2.30+) | `nix profile add github:NixOS/nixpkgs/nixos-unstable#t3code`     |

- **Linux AppImage**: `chmod +x ./T3-Code-*.AppImage && ./T3-Code-*.AppImage` (x86_64 and ARM64). `.deb` self-updates with a password prompt; update AUR packages via your AUR helper (`yay -Syu`).
- **NixOS / Home Manager**: Add `pkgs.t3code` to `environment.systemPackages` or `home.packages` (`t3code-desktop` launches the app; `t3` is included). Update via Nix rather than the in-app updater.

### aix Code (Nix)

This build is named aix Code but keeps upstream's `t3` and `t3code-desktop` commands and default
state directory, so install it instead of upstream T3 Code, not next to it. The fork's Android app likewise replaces the Play Store app. A stable release
tag points to the fork integration commit on `main`, with fork changes and upstream through the
matching stable tag; metadata records that upstream tag's peeled commit as the stable base. The
flake reads the application version from the source and pins nixpkgs in `flake.lock`.

To follow the latest published release, use the moving `release` branch, which appears after the
first published release:

```bash
nix profile add 'github:get-aix/aix-code/release'
```

For NixOS or Home Manager, set the flake input to `github:get-aix/aix-code/release` and run
`nix flake update t3code` before rebuilding to pick up a newer release. To pin a reproducible
version, use a release tag:

```nix
inputs.t3code.url = "github:get-aix/aix-code/<release-tag>";
```

The `main` branch includes unreleased fork changes. A full commit SHA can also select a reviewed
unreleased build. The profile equivalent for a pinned release is:

```bash
nix profile add 'github:get-aix/aix-code/<release-tag>'
```

Use a tag from the fork's [Releases page](https://github.com/get-aix/aix-code/releases). Older
version tags in the repository are upstream's own and do not contain this build.

For NixOS, add `inputs.t3code.packages.${pkgs.stdenv.hostPlatform.system}.default` (or apply
`inputs.t3code.overlays.default` and use `pkgs.t3code`) to `environment.systemPackages`. In Home
Manager, point the T3 Code module at the same package:

```nix
programs.t3code.package = inputs.t3code.packages.${pkgs.stdenv.hostPlatform.system}.default;
```

The default package includes `git`, `gh`, `codex`, `claude` (Claude Code, unfree), `agy`
(Antigravity CLI, unfree), the resource monitor sidecar, and `cloudflared` for T3 Connect. Additional flake outputs add opt-in runtime
environments: `t3code-browser` (Linux shared libraries for T3's headless browser via `nix-ld`),
`t3code-android` (unfree Android SDK and device tools), and `t3code-full` (both). You can also customize any output with `.override`:

```nix
inputs.t3code.packages.${pkgs.stdenv.hostPlatform.system}.t3code.override {
  enableClaude = true;
  enableOpencode = true;
  enableGitLab = true;
  withBrowser = true;
  extraRuntimePackages = [ ];
}
```

Supported `.override` toggles cover upstream nixpkgs provider and source-control CLIs
(`enableClaude`, `enableCodex`, `enableOpencode`, `enableCursor`, `enableCursorCli`, `enableGit`,
`enableGitHub`, `enableGitLab`, `enableJujutsu`, `enableBitbucket`, `enableAzureDevOps`,
`enableResourceMonitor`) plus `enableCloudflared`, `enableXdgUtils`, `enablePi`, `enableKiro`,
`enableAntigravity`, `enableForgejo`, `enableTailscale`, `enableSsh`, `enable1Password`, `withBrowser`, `withAndroid`,
`androidPlatformVersions`, `androidSystemImageTypes`, `androidAbiVersions`,
`extraRuntimePackages`, and `extraWrapArgs`.

For the moving input, `nix flake update t3code` records the latest release branch commit in the lock
file. For a pinned input, change the tag and update the lock file deliberately.

### aix Code (desktop and Android)

Published fork releases include `aix-Code-<version>-x64.exe` for Windows (with WSL support),
`aix-Code-<version>-arm64.zip` for Apple Silicon macOS, and `aix-Code-<version>.apk` for Android.
The desktop apps update themselves from later fork releases.

On an Apple Silicon Mac, install with the script; it is the only supported way, because the app is
not notarized and Gatekeeper blocks a zip downloaded in a browser:

```sh
curl -fsSL https://github.com/get-aix/aix-code/releases/latest/download/install-macos.sh | bash
```

The script checks the download's SHA-256, installs **aix Code** in `/Applications` (or
`~/Applications`), replacing an existing **T3 Code (Beta)** app, and opens it. Quit the app first. Set `T3CODE_VERSION=<version>` to install a
specific release. Later updates arrive in the app.

On Windows, run this in a normal PowerShell window, not as administrator:

```powershell
irm https://github.com/get-aix/aix-code/releases/latest/download/install-windows.ps1 | iex
```

It checks the download's SHA-256 and installs **aix Code** for your user, without the admin or
SmartScreen prompts the unsigned `.exe` gets when downloaded in a browser. Quit the app first. Set
`$env:T3CODE_VERSION = "<version>"` to install a specific release.

Before a public fork release is authorized, collaborators can get installable test builds from the
fork's GitHub Actions. Open **Actions → Fork Release**, run it from `main` with channel `stable`,
and leave **publish** unchecked. If the selected source has no upstream sync marker, enter the full
40-character upstream commit in `upstream_base`. Download the combined artifact named
`t3-code-installers-<version>-<12-character-commit>` from that run. It contains the Windows x64
installer, macOS arm64 zip, Android APK, Linux x64 CLI runtime (for Windows WSL), SHA-256 files,
update feeds, and metadata. Check the matching checksum before installing. `windows-metadata.json`
reports whether the Windows installer has an Authenticode signature; current fork builds are
expected to be unsigned. Its metadata and `BUILD-INFO.md` identify the fork integration commit that
was built and the upstream stable tag plus peeled base SHA. The release tag points to the fork
integration commit, whose tree includes fork changes and upstream through that stable tag. Fork
`main` takes only stable upstream tags and never merges upstream `main`; its first release can use
only a stable tag containing every upstream commit already present in `main`. After an authorized
public release exists, use its matching assets from the fork's GitHub Releases page instead. See the
[fork release guide](../operations/fork-release.md) for the build and release process.

Launch the desktop app with `t3code-desktop` or run the server with `t3 serve`. The fork uses the
same default T3 state directory and desktop profile as upstream; install it in place of upstream
T3 Code rather than running both against the same data.

Nix only installs the pinned application build. It does not configure aix,
resolve profiles, or place endpoints or API keys in the store. See
[aix profiles](./aix-profiles.md#turn-on-aix).

### The `t3` command

The desktop app bundles `t3` and sets it up on first launch (manage anytime under **Settings → About → t3 command**). Use **Add to PATH** if needed, then open a new terminal.

- **Open a folder in the running desktop app**: Run `t3 app` (or `t3 app ../my-project`) from a terminal, or drag folders from your file manager onto the desktop sidebar.

### Windows Subsystem for Linux

Select a WSL distro in **Settings → Sharing & access** to run agents and projects inside WSL (install provider CLIs inside that distro). T3 Code manages its own server runtime inside WSL automatically.

## Mobile app

Install from the [App Store](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824) or [Google Play](https://play.google.com/store/apps/details?id=com.t3tools.t3code) (QR codes are also in **Settings → About → Mobile app**). The mobile app connects to a server on another machine via [remote access](./remote-access.md).

- Store builds work with both Stable and Nightly servers. Optional Android beta APKs are under [Android beta releases](https://github.com/pingdotgg/t3code/releases?q=android-beta-).
- If the mobile app crashes on launch, open **Settings → Diagnostics** on the next launch to copy recent startup crash reports.

## Providers

Open **Settings → Providers** (web or desktop), select the environment, and enable the providers you use. Installation and sign-in always happen on the **environment's machine**.

| Provider         | Install and authenticate                                                                                                 | Guide                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| **Codex**        | Connect with ChatGPT in Settings, or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`. | [Codex](./providers-codex.md)             |
| **Claude**       | Install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`.                               | [Claude](./providers-claude.md)           |
| **Cursor**       | Sign in in Settings or install [Cursor CLI](https://cursor.com/cli) and run `agent login`.                               | [Cursor](./cursor.md)                     |
| **Grok Build**   | Install [Grok Build CLI](https://x.ai/cli) and run `grok login`.                                                         | [Grok](./providers-grok.md)               |
| **Antigravity**  | Install managed runtime and sign in with Google in Settings.                                                             | [Antigravity](./providers-antigravity.md) |
| **OpenCode**     | Install [OpenCode](https://opencode.ai) and run `opencode auth login`.                                                   | [OpenCode](./providers-opencode.md)       |
| **Kiro**         | Install [Kiro CLI](https://kiro.dev/docs/cli/) and run `kiro-cli login`.                                                 | [Kiro](./providers-kiro.md)               |
| **Pi**           | Install [Pi](./providers-pi.md) (Node.js 22.19+) and run `pi` → `/login`.                                                | [Pi](./providers-pi.md)                   |
| **Muse Code**    | Install [Muse Code](https://dev.meta.ai/docs/muse-code) and run `muse login`.                                            | [Muse Code](./providers-muse.md)          |
| **fx**           | Install [fx](https://fx.sh) and run `fx login`.                                                                          | [fx](./providers-fx.md)                   |
| **ACP Registry** | Add GitHub Copilot and other agents in **Settings → Providers → Add provider → Show more**.                              | [ACP](./providers-acp.md)                 |

- **Binary path**: If a CLI isn't on the server's `PATH` (common with version managers), set **Binary path** in the provider's settings.
- **Updates**: Click **Update now** on outdated provider cards (supports Homebrew, mise `latest`, npm/pnpm/Yarn/Bun/Volta/Vite+, or the CLI's own updater; update Nix, Chocolatey, or pinned mise installs manually).
- **Multiple instances**: Add extra provider instances for separate accounts, API keys, or custom endpoints (mark secret env vars as sensitive).

### Provider check timeouts

If a working CLI times out during T3 Code's readiness check, increase its probe deadline (in milliseconds) in the server's environment (or systemd override / `service.env`) and restart:

```bash
T3CODE_CODEX_PROBE_TIMEOUT_MS=60000 T3CODE_CLAUDE_PROBE_TIMEOUT_MS=60000 t3 serve
```

| Provider     | Environment variable                   |
| ------------ | -------------------------------------- |
| Codex        | `T3CODE_CODEX_PROBE_TIMEOUT_MS`        |
| Claude       | `T3CODE_CLAUDE_PROBE_TIMEOUT_MS`       |
| Cursor       | `T3CODE_CURSOR_PROBE_TIMEOUT_MS`       |
| Antigravity  | `T3CODE_ANTIGRAVITY_PROBE_TIMEOUT_MS`  |
| Grok         | `T3CODE_GROK_PROBE_TIMEOUT_MS`         |
| Kiro         | `T3CODE_KIRO_PROBE_TIMEOUT_MS`         |
| fx           | `T3CODE_FX_PROBE_TIMEOUT_MS`           |
| Pi           | `T3CODE_PI_PROBE_TIMEOUT_MS`           |
| Muse Code    | `T3CODE_MUSE_PROBE_TIMEOUT_MS`         |
| OpenCode     | `T3CODE_OPENCODE_PROBE_TIMEOUT_MS`     |
| ACP Registry | `T3CODE_ACP_REGISTRY_PROBE_TIMEOUT_MS` |

## Next steps

- [User guide index](./README.md): overview of how T3 Code works.
- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): control when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Updating T3 Code](./updating.md): keep apps, servers, and providers up to date.
