import * as NodeFS from "node:fs";

if (process.env.T3_FAKE_CLAUDE_STARTED_FILE) {
  NodeFS.writeFileSync(process.env.T3_FAKE_CLAUDE_STARTED_FILE, "started", { mode: 0o600 });
}

const argv = process.argv.slice(2);
const args = argv.join(" ");

function fail(message, code) {
  process.stderr.write(message + "\n");
  process.exit(code);
}

const permissionIndex = argv.indexOf("--permission-mode");
if (permissionIndex === -1 || argv[permissionIndex + 1] !== "dontAsk") {
  fail("text generation must deny permission prompts", 12);
}
const toolsIndex = argv.indexOf("--tools");
if (
  toolsIndex === -1 ||
  argv[toolsIndex + 1] !== (process.env.T3_FAKE_CLAUDE_EXPECTED_TOOLS ?? "")
) {
  fail("text generation did not receive the expected tool set", 6);
}
if (argv.includes("--dangerously-skip-permissions")) {
  fail("text generation must not bypass permissions", 7);
}
if (!argv.includes("--disable-slash-commands")) {
  fail("text generation must disable skills", 8);
}
if (!argv.includes("--strict-mcp-config")) {
  fail("text generation must not load configured MCP servers", 9);
}
if (process.env.T3_FAKE_CLAUDE_REJECTS_NO_SESSION_PERSISTENCE === "1") {
  if (argv.includes("--no-session-persistence")) {
    fail("error: unknown option '--no-session-persistence'", 1);
  }
} else if (!argv.includes("--no-session-persistence")) {
  fail("text generation must not save a resumable session", 16);
}
const settingsIndex = argv.indexOf("--settings");
const settingsValue = settingsIndex === -1 ? "{}" : argv[settingsIndex + 1];
// Like the CLI: a value starting with a brace is inline JSON, anything else a file path.
const settingsText = settingsValue.startsWith("{")
  ? settingsValue
  : NodeFS.readFileSync(settingsValue, "utf8");
const settings = JSON.parse(settingsText);
if (settings.disableAllHooks !== true) {
  fail("text generation must disable hooks", 10);
}
if (process.env.T3_FAKE_CLAUDE_CHECK_GATEWAY_ENV === "1") {
  for (const name of ["ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY"]) {
    if (process.env[name] !== settings.env?.[name]) {
      fail(`title process did not apply its configured ${name}`, 18);
    }
  }
  if (Object.hasOwn(settings.env ?? {}, "ANTHROPIC_AUTH_TOKEN")) {
    fail("title process exposed its active credential in settings", 20);
  }
  if (
    process.env.ANTHROPIC_BASE_URL !== "https://gateway.example.test" ||
    process.env.ANTHROPIC_API_KEY !== "" ||
    !process.env.ANTHROPIC_AUTH_TOKEN ||
    process.env.ANTHROPIC_AUTH_TOKEN === "stale-host-token"
  ) {
    fail("title process used stale gateway credentials", 19);
  }
}
if (process.env.T3_FAKE_CLAUDE_SETTINGS_LOG) {
  NodeFS.writeFileSync(process.env.T3_FAKE_CLAUDE_SETTINGS_LOG, settingsText);
}
const cwdMustNotBe = process.env.T3_FAKE_CLAUDE_CWD_MUST_NOT_BE;
if (cwdMustNotBe && NodeFS.realpathSync(process.cwd()) === NodeFS.realpathSync(cwdMustNotBe)) {
  fail("text generation ran in the project directory", 11);
}

let stdinContent = "";
if (!process.stdin.isTTY) {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  stdinContent = Buffer.concat(chunks).toString("utf8");
}

const argsMustContain = process.env.T3_FAKE_CLAUDE_ARGS_MUST_CONTAIN;
if (argsMustContain && !args.includes(argsMustContain)) {
  fail("args missing expected content", 2);
}

const argsMustNotContain = process.env.T3_FAKE_CLAUDE_ARGS_MUST_NOT_CONTAIN;
if (argsMustNotContain && args.includes(argsMustNotContain)) {
  fail("args contained forbidden content", 3);
}

const stdinMustContain = process.env.T3_FAKE_CLAUDE_STDIN_MUST_CONTAIN;
if (stdinMustContain && !stdinContent.includes(stdinMustContain)) {
  fail("stdin missing expected content", 4);
}

const imageRejection = process.env.T3_FAKE_CLAUDE_IMAGE_REJECTION;
if (imageRejection && stdinContent.includes('"type":"image"')) {
  if (process.env.T3_FAKE_CLAUDE_IMAGE_ATTEMPT_LOG) {
    NodeFS.appendFileSync(process.env.T3_FAKE_CLAUDE_IMAGE_ATTEMPT_LOG, "image\n");
  }
  process.stdout.write(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: true,
      api_error_status: 400,
      result: `API Error: 400 ${imageRejection}`,
    }) + "\n",
  );
  process.exit(1);
}

const configDirMustBe = process.env.T3_FAKE_CLAUDE_CONFIG_DIR_MUST_BE;
if (configDirMustBe && process.env.CLAUDE_CONFIG_DIR !== configDirMustBe) {
  fail("CLAUDE_CONFIG_DIR was " + (process.env.CLAUDE_CONFIG_DIR ?? ""), 5);
}

const apiKeyFile = process.env.T3_FAKE_CLAUDE_API_KEY_FILE;
if (apiKeyFile && process.env.ANTHROPIC_API_KEY !== NodeFS.readFileSync(apiKeyFile, "utf8")) {
  fail("text-generation process used stale profile credentials", 17);
}

const stderrText = process.env.T3_FAKE_CLAUDE_STDERR;
if (stderrText) {
  process.stderr.write(stderrText + "\n");
}

if (process.env.T3_FAKE_CLAUDE_REPORT_GATEWAY_ROTATION === "1") {
  process.stdout.write(
    JSON.stringify({
      structured_output: {
        title: process.env.ANTHROPIC_AUTH_TOKEN?.endsWith("-before-rotation")
          ? "first gateway process"
          : "next gateway process",
      },
    }),
  );
} else {
  process.stdout.write(process.env.T3_FAKE_CLAUDE_OUTPUT ?? "");
}
process.exitCode = Number(process.env.T3_FAKE_CLAUDE_EXIT_CODE ?? 0);
