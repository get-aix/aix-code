# Reproducible NixOS development environment

The repository includes a pinned `devenv` shell for development on NixOS. It provides Node.js 26,
pnpm 12, `git`, `pkg-config`, `libsecret`, and the shared libraries the headless Chromium used by
the Vitest browser tests (`*.browser.test.tsx`) needs. It does not install project dependencies or
start T3 Code automatically.

From the repository root, enter the shell and install dependencies:

```sh
devenv shell
vp i
```

The Node.js and pnpm versions follow the pinned Nixpkgs revision in `devenv.lock`, and Vite+
remains pinned by `pnpm-lock.yaml`.

Run changed-file checks from the repository root:

```sh
vp run check:changed
```

Start the local T3 development server from your checkout:

```sh
vp run dev
```

In a worktree, the dev runner stores its state in the worktree's ignored `.t3` directory. Entering
`devenv` does not configure, restart, or attach to an already running T3 server, and no
`VITE_HTTP_URL` or `VITE_WS_URL` override is needed. For browser verification, use T3's built-in
Browser panel (see [test-t3-app](../../.agents/skills/test-t3-app/SKILL.md)).
