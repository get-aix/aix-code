{
  description = "Pinned Nix package for T3 Code";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/d4f25a3e562008648d45bcf2d70bcc7422cad84e";

  outputs =
    { self, nixpkgs }:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
      revision = builtins.substring 0 7 (self.rev or "working-tree");
      version = (builtins.fromJSON (builtins.readFile ./apps/server/package.json)).version;

      mkPackagesForSystem =
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          inherit (pkgs) lib;
          inherit (pkgs.stdenv.hostPlatform) isLinux isAarch64;
          defaultAndroidAbi = if isAarch64 then "arm64-v8a" else "x86_64";

          src = pkgs.runCommand "t3code-source" { } ''
            mkdir -p "$out"
            cp -R ${self.outPath}/. "$out/"
          '';

          # Build native Rust sidecars from the local source's Cargo.lock so
          # Cargo.lock bumps never break on nixpkgs's stale 0.1.8 cargoHash.
          mkNativeRustHelper =
            subdir: description:
            pkgs.rustPlatform.buildRustPackage {
              pname = "t3code-${subdir}";
              inherit version;
              src = "${src}/native/${subdir}";
              cargoLock.lockFile = ./native/${subdir}/Cargo.lock;
              doCheck = false;
              meta = {
                inherit description;
                mainProgram = "t3-${subdir}";
                license = lib.licenses.mit;
                platforms = pkgs.t3code.unwrapped.meta.platforms;
              };
            };

          t3codeResourceMonitor = mkNativeRustHelper "resource-monitor" "Native resource diagnostics sidecar for T3 Code";
          t3codeKdeSnapShot = mkNativeRustHelper "kde-snap-shot" "Native KDE Plasma SnapShot capture helper for T3 Code";
          t3codeHyprlandSnapShot = mkNativeRustHelper "hyprland-snap-shot" "Native Hyprland SnapShot capture helper for T3 Code";

          # Shared libraries required by prebuilt Linux .node / .so addons shipped
          # in 0.1.11 that nixpkgs's 0.1.8 unwrapped recipe does not patch:
          # - @transcribe-cpp (local Whisper/ggml speech-to-text, CPU + Vulkan)
          # - @crowecawcaw/xa11y (desktop SnapShot accessibility & keyboard)
          # - @img/sharp, @koromix/koffi, utf-8-validate (libstdc++)
          nativeAddonLibPath = lib.makeLibraryPath [
            pkgs.stdenv.cc.cc.lib
            pkgs.vulkan-loader
            pkgs.libxkbcommon
          ];

          t3codeUnwrapped = pkgs.t3code.unwrapped.overrideAttrs (old: {
            pname = "t3code-unwrapped";
            inherit version src;
            meta = old.meta // {
              changelog = "https://github.com/get-aix/t3code/commit/${self.rev or revision}";
            };
            # T3 Connect's public identifiers are compiled into the client and CLI.
            postPatch = (old.postPatch or "") + ''
              cp .env.example .env
            '';
            pnpmDeps = pkgs.fetchPnpmDeps {
              pname = "t3code-unwrapped";
              inherit version src;
              pnpm = pkgs.pnpm_12;
              inherit (old) pnpmWorkspaces;
              fetcherVersion = 5;
              hash = "sha256-s/vm8Ox4o/AYpNC/amYP1KFWwh7SY5bCmVBuIJn9f/c=";
            };
            # Register x-scheme-handler/t3code in the packaged .desktop file
            # so t3code:// sign-in callbacks work out of the box on Linux.
            desktopItems = lib.optionals isLinux [
              (pkgs.makeDesktopItem {
                name = "t3code";
                desktopName = "T3 Code (Beta)";
                comment = "Minimal web GUI for coding agents";
                exec = "t3code-desktop %U";
                terminal = false;
                icon = "t3code";
                startupWMClass = "t3code";
                categories = [ "Development" ];
                mimeTypes = [ "x-scheme-handler/t3code" ];
              })
            ];
            # Stage Linux SnapShot capture helpers where DesktopSnapShot.ts looks
            # when running unpackaged under Nix's shared Electron binary.
            postInstall =
              (old.postInstall or "")
              + lib.optionalString isLinux ''
                libexec="$out/libexec/t3code"
                if [ -d apps/desktop/gnome-extension ]; then
                  mkdir -p "$libexec/apps/desktop/gnome-extension"
                  cp -r apps/desktop/gnome-extension/. "$libexec/apps/desktop/gnome-extension/"
                fi
                install -Dm755 "${lib.getExe t3codeKdeSnapShot}" \
                  "$libexec/native/kde-snap-shot/target/release/t3-kde-snap-shot"
                install -Dm755 "${lib.getExe t3codeHyprlandSnapShot}" \
                  "$libexec/native/hyprland-snap-shot/target/release/t3-hyprland-snap-shot"
                if [ -d native/hyprland-snap-shot/protocols ]; then
                  mkdir -p "$libexec/native/hyprland-snap-shot/protocols"
                  cp -r native/hyprland-snap-shot/protocols/. "$libexec/native/hyprland-snap-shot/protocols/"
                fi
              '';
            postFixup =
              (old.postFixup or "")
              + lib.optionalString isLinux ''
                # Patch Linux native addons for local speech-to-text (@transcribe-cpp),
                # SnapShot accessibility (@crowecawcaw/xa11y), sharp, koffi, and utf-8-validate.
                pnpmStore="$out/libexec/t3code/node_modules/.pnpm"
                for module in \
                  "$pnpmStore"/@transcribe-cpp+*/node_modules/@transcribe-cpp/*/*.so* \
                  "$pnpmStore"/@crowecawcaw+xa11y-*/node_modules/@crowecawcaw/*/*.node \
                  "$pnpmStore"/@img+sharp-*/node_modules/@img/*/lib/*.node \
                  "$pnpmStore"/@img+sharp-libvips-*/node_modules/@img/*/lib/*.so* \
                  "$pnpmStore"/@koromix+koffi-*/node_modules/@koromix/*/linux_*/*.node \
                  "$pnpmStore"/utf-8-validate@*/node_modules/utf-8-validate/prebuilds/linux-*/utf-8-validate.node; do
                  [ -f "$module" ] || continue
                  patchelf --add-rpath "${nativeAddonLibPath}" "$module"
                done
              '';
          });

          # Direct DT_NEEDED shared libraries of T3's downloaded chrome-headless-shell.
          # Scoped via NIX_LD_LIBRARY_PATH so nix-ld resolves them for the headless
          # browser without touching global nix-ld libraries or Nix-built binaries.
          browserRuntimeLibraryPath = lib.makeLibraryPath (
            with pkgs;
            [
              alsa-lib
              at-spi2-core
              dbus.lib
              expat
              glib
              libgbm
              libx11
              libxcb
              libxcomposite
              libxdamage
              libxext
              libxfixes
              libxkbcommon
              libxrandr
              nspr
              nss
              systemdMinimal
            ]
          );

          # Free runtime tools needed by T3's local Android device support:
          # npm installs expo-device-hub and agent-device, ffmpeg (libx264) streams
          # emulator video, and java runs Android SDK's avdmanager.
          deviceToolsPath = lib.makeBinPath (
            with pkgs;
            [
              nodejs
              ffmpeg
              jdk21_headless
            ]
          );

          # Lazily instantiated only when opting into unfree packages (such as
          # Claude Code, Cursor, Kiro, 1Password CLI, or the Android SDK).
          pkgsUnfree = import nixpkgs {
            inherit system;
            config = {
              allowUnfree = true;
              android_sdk.accept_license = true;
            };
          };

          mkAndroidSdk =
            {
              platformVersions,
              systemImageTypes,
              abiVersions,
            }:
            let
              composition = pkgsUnfree.androidenv.composeAndroidPackages {
                cmdLineToolsVersion = "latest";
                includeEmulator = true;
                includeSystemImages = true;
                inherit platformVersions systemImageTypes abiVersions;
              };
            in
            # T3's LocalDeviceHost checks for cmdline-tools/latest/bin/avdmanager.
            pkgs.runCommand "t3code-android-sdk" { } ''
              mkdir -p "$out"
              cp -rs "${composition.androidsdk}/libexec/android-sdk/"* "$out/"
              chmod -R u+w "$out/cmdline-tools"
              if [ ! -e "$out/cmdline-tools/latest" ]; then
                first="$(find "$out/cmdline-tools" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
                ln -s "$first" "$out/cmdline-tools/latest"
              fi
            '';

          mkT3Code = lib.makeOverridable (
            {
              # Upstream pkgs.t3code runtime/provider options (defaults match nixpkgs).
              enableAzureDevOps ? false,
              enableBitbucket ? false,
              enableClaude ? false,
              enableCodex ? true,
              enableCursor ? false,
              enableCursorCli ? false,
              enableGit ? true,
              enableGitHub ? true,
              enableGitLab ? false,
              enableJujutsu ? false,
              enableOpencode ? false,
              enableResourceMonitor ? true,
              # Use nixpkgs cloudflared for T3 Connect instead of downloading at runtime
              # (matches upstream nixos-unstable).
              enableCloudflared ? true,
              # Provide xdg-open fallback on Linux for opening files, folders, and URLs.
              enableXdgUtils ? isLinux,
              # Additional T3 Code runtime integrations available in nixpkgs.
              enablePi ? false,
              enableKiro ? false,
              enableForgejo ? false,
              enableTailscale ? false,
              enableSsh ? false,
              enable1Password ? false,
              # Optional browser and Android device runtime environments.
              withBrowser ? false,
              withAndroid ? false,
              androidPlatformVersions ? [ "35" ],
              androidSystemImageTypes ? [ "google_apis" ],
              androidAbiVersions ? [ defaultAndroidAbi ],
              # Escape hatches for extra CLIs or wrapper flags (e.g. custom providers).
              extraRuntimePackages ? [ ],
              extraWrapArgs ? [ ],
            }:
            let
              androidSdk = mkAndroidSdk {
                platformVersions = androidPlatformVersions;
                systemImageTypes = androidSystemImageTypes;
                abiVersions = androidAbiVersions;
              };

              # Added via --suffix PATH so system wrappers (e.g. NixOS setgid `op`,
              # system `tailscale`, `xdg-open`, or user-installed CLIs) still take precedence.
              additionalRuntimePackages =
                lib.optionals (enableXdgUtils && isLinux) [ pkgs.xdg-utils ]
                ++ lib.optionals enablePi [ pkgs.pi-coding-agent ]
                ++ lib.optionals enableKiro [ pkgsUnfree.kiro-cli ]
                ++ lib.optionals enableForgejo [
                  pkgs.tea
                  pkgs.forgejo-cli
                ]
                ++ lib.optionals enableTailscale [ pkgs.tailscale ]
                ++ lib.optionals enableSsh [ pkgs.openssh ]
                ++ lib.optionals enable1Password [ pkgsUnfree._1password-cli ]
                ++ extraRuntimePackages;

              commonWrapArgs =
                lib.optionals enableCloudflared [
                  "--set-default"
                  "T3CODE_CLOUDFLARED_PATH"
                  (lib.getExe pkgs.cloudflared)
                ]
                ++ lib.optionals (additionalRuntimePackages != [ ]) [
                  "--suffix"
                  "PATH"
                  ":"
                  (lib.makeBinPath additionalRuntimePackages)
                ]
                ++ lib.optionals (withBrowser && isLinux) [
                  "--suffix"
                  "NIX_LD_LIBRARY_PATH"
                  ":"
                  browserRuntimeLibraryPath
                ]
                ++ lib.optionals withAndroid [
                  "--set-default"
                  "ANDROID_HOME"
                  "${androidSdk}"
                  "--suffix"
                  "PATH"
                  ":"
                  "${deviceToolsPath}:${androidSdk}/platform-tools:${androidSdk}/cmdline-tools/latest/bin:${androidSdk}/emulator"
                ]
                ++ extraWrapArgs;

              desktopLauncherArg = lib.optionalString isLinux ''--set-default T3CODE_DESKTOP_LAUNCHER_PATH "$out/bin/t3code-desktop"'';
              escapedCommonWrapArgs = lib.escapeShellArgs commonWrapArgs;

              baseT3Code = pkgs.t3code.override (
                {
                  t3code-unwrapped = t3codeUnwrapped;
                  t3code-resource-monitor = t3codeResourceMonitor;
                  inherit
                    enableAzureDevOps
                    enableBitbucket
                    enableClaude
                    enableCodex
                    enableCursor
                    enableCursorCli
                    enableGit
                    enableGitHub
                    enableGitLab
                    enableJujutsu
                    enableOpencode
                    enableResourceMonitor
                    ;
                }
                // lib.optionalAttrs enableClaude { claude-code = pkgsUnfree.claude-code; }
                // lib.optionalAttrs enableCursor { code-cursor = pkgsUnfree.code-cursor; }
                // lib.optionalAttrs enableCursorCli { cursor-cli = pkgsUnfree.cursor-cli; }
              );
            in
            baseT3Code.overrideAttrs (old: {
              pname = "t3code";
              inherit version;
              name = "t3code-${version}";
              # The desktop registers itself as the t3code:// handler (T3 Connect sign-in callback);
              # without this it would register the shared bare Electron binary instead.
              # symlinkJoin bakes postBuild into buildCommand, so overriding postBuild is a no-op.
              buildCommand =
                old.buildCommand
                + lib.optionalString (isLinux || commonWrapArgs != [ ]) ''
                  for program in "$out/bin"/*; do
                    if [ "$(basename "$program")" = "t3code-desktop" ]; then
                      wrapProgram "$program" ${desktopLauncherArg} ${escapedCommonWrapArgs}
                    ${lib.optionalString (commonWrapArgs != [ ]) ''
                      else
                        wrapProgram "$program" ${escapedCommonWrapArgs}
                    ''}
                    fi
                  done
                '';
              meta = old.meta // {
                mainProgram = "t3code-desktop";
              };
            })
          );

          t3code = mkT3Code { };
          t3code-browser = mkT3Code { withBrowser = true; };
          t3code-android = mkT3Code { withAndroid = true; };
          t3code-full = mkT3Code {
            withBrowser = true;
            withAndroid = true;
          };
        in
        {
          default = t3code;
          inherit
            t3code
            t3code-browser
            t3code-android
            t3code-full
            ;
        };
    in
    {
      packages = forAllSystems mkPackagesForSystem;

      overlays.default = final: _prev: {
        t3code = self.packages.${final.stdenv.hostPlatform.system}.t3code;
      };
    };
}
