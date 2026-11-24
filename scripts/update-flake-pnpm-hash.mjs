import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const DUMMY_HASH = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const HASH_PATTERN = /^sha256-[A-Za-z0-9+/]{43}=$/;

export function extractNixHash(output) {
  const match = /\bgot:\s*(sha256-[A-Za-z0-9+/]{43}=)/.exec(output);
  if (!match || !HASH_PATTERN.test(match[1])) {
    throw new Error("Nix output did not contain a usable 'got: sha256-…' hash.");
  }
  return match[1];
}

export function rewritePnpmDepsHash(flake, hash) {
  if (!HASH_PATTERN.test(hash)) {
    throw new Error(`Invalid Nix SRI hash: ${hash}`);
  }
  const pattern = /(\bhash\s*=\s*")[^"]+("\s*;)/g;
  const matches = [...flake.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one pnpmDeps hash assignment in flake.nix; found ${matches.length}.`,
    );
  }
  return flake.replace(pattern, `$1${hash}$2`);
}

function capturedOutput(error) {
  return [error?.stdout, error?.stderr, error?.message]
    .map((part) => (Buffer.isBuffer(part) ? part.toString("utf8") : String(part ?? "")))
    .join("\n");
}

export async function updateFlakePnpmHash({ root = process.cwd(), runNix } = {}) {
  const flakePath = NodePath.join(root, "flake.nix");
  const original = await NodeFSP.readFile(flakePath, "utf8");
  const dummy = rewritePnpmDepsHash(original, DUMMY_HASH);
  await NodeFSP.writeFile(flakePath, dummy);
  const restoreOnSignal = (signal) => {
    NodeFS.writeFileSync(flakePath, original);
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  const onInterrupt = () => restoreOnSignal("SIGINT");
  const onTerminate = () => restoreOnSignal("SIGTERM");
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  try {
    const run =
      runNix ??
      (() =>
        NodeChildProcess.execFileSync(
          "nix",
          ["build", "--no-link", ".#t3code.unwrapped.pnpmDeps"],
          {
            cwd: root,
            encoding: "utf8",
            maxBuffer: 32 * 1024 * 1024,
            stdio: ["ignore", "pipe", "pipe"],
          },
        ));
    let output = "";
    try {
      output = await run(root);
    } catch (error) {
      output = capturedOutput(error);
    }
    const hash = extractNixHash(output);
    await NodeFSP.writeFile(flakePath, rewritePnpmDepsHash(dummy, hash));
    return hash;
  } catch (error) {
    await NodeFSP.writeFile(flakePath, original);
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not update flake.nix pnpmDeps.hash. Ensure Nix is installed and can evaluate/build .#t3code, then retry. ${detail}`,
      { cause: error },
    );
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--root");
  const root = rootIndex >= 0 ? NodePath.resolve(args[rootIndex + 1] ?? "") : process.cwd();
  const hash = await updateFlakePnpmHash({ root });
  console.log(`Updated flake.nix pnpmDeps.hash to ${hash}`);
}

if (
  process.argv[1] &&
  NodeURL.fileURLToPath(import.meta.url) === NodePath.resolve(process.argv[1])
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
