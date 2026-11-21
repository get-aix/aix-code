import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  extractNixHash,
  rewritePnpmDepsHash,
  updateFlakePnpmHash,
} from "./update-flake-pnpm-hash.mjs";

const originalHash = "sha256-oldhash=";
const expectedHash = "sha256-QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ=";
const flake = `fetchPnpmDeps { hash = "${originalHash}"; }`;

NodeTest.test("extracts the got hash from Nix's mismatch diagnostic", () => {
  NodeAssert.equal(
    extractNixHash(
      `error: hash mismatch\n  specified: sha256-oldhash=\n       got: ${expectedHash}\n`,
    ),
    expectedHash,
  );
  NodeAssert.throws(() => extractNixHash("error: Nix is unavailable"), /did not contain/);
});

NodeTest.test("rewrites only the pnpmDeps hash assignment", () => {
  NodeAssert.equal(
    rewritePnpmDepsHash(flake, expectedHash),
    `fetchPnpmDeps { hash = "${expectedHash}"; }`,
  );
  NodeAssert.throws(() => rewritePnpmDepsHash("{}", expectedHash), /found 0/);
});

NodeTest.test("updates the hash from mocked Nix output", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "flake-hash-"));
  try {
    await NodeFSP.writeFile(NodePath.join(root, "flake.nix"), flake);
    const hash = await updateFlakePnpmHash({
      root,
      runNix: async () => {
        const temporary = await NodeFSP.readFile(NodePath.join(root, "flake.nix"), "utf8");
        NodeAssert.match(temporary, /sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=/);
        const error = new Error("hash mismatch");
        error.stderr = `specified: sha256-old=\ngot: ${expectedHash}`;
        throw error;
      },
    });
    NodeAssert.equal(hash, expectedHash);
    NodeAssert.equal(
      await NodeFSP.readFile(NodePath.join(root, "flake.nix"), "utf8"),
      `fetchPnpmDeps { hash = "${expectedHash}"; }`,
    );
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

NodeTest.test("restores the previous flake if Nix cannot provide a hash", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "flake-hash-fail-"));
  try {
    await NodeFSP.writeFile(NodePath.join(root, "flake.nix"), flake);
    await NodeAssert.rejects(
      updateFlakePnpmHash({
        root,
        runNix: async () => {
          throw new Error("nix not found");
        },
      }),
      /Ensure Nix is installed/,
    );
    NodeAssert.equal(await NodeFSP.readFile(NodePath.join(root, "flake.nix"), "utf8"), flake);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
