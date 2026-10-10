#!/usr/bin/env node
// Diagnostic-only offline checks for the PR #1001 + production 0108 compatibility branch.
// No deploys, migrations, database writes, Claude queries or daemon restarts.
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
const compatibilityBase = "fde5dd14effdb30c09a66c29e08cd3d1bc9627a2";
const logDirectory = mkdtempSync(join(tmpdir(), "leileios-native-handoff-offline-"));

function stop(message) {
  console.error(`STOP: ${message}`);
  process.exit(2);
}

// The user's shell may default to Node 26 even when Node 22 is installed.
 // Select an existing local Node 22 for every pnpm subprocess. Never install
 // Node, mutate the shell, or silently run the test suite using Node 26.
function existingNode22() {
  const home = homedir();
  const candidatePaths = [process.execPath];
  const brewPrefixes = ["/opt/homebrew", "/usr/local", process.env.HOMEBREW_PREFIX].filter(Boolean);
  for (const prefix of brewPrefixes) {
    candidatePaths.push(join(prefix, "opt", "node@22", "bin", "node"));
  }
  if (process.env.FNM_MULTISHELL_PATH) {
    candidatePaths.push(join(process.env.FNM_MULTISHELL_PATH, "bin", "node"));
  }
  const installations = [
    { root: join(process.env.NVM_DIR || join(home, ".nvm"), "versions", "node"), pattern: /^v22\./u, suffix: ["bin", "node"] },
    { root: join(process.env.FNM_DIR || join(home, ".local", "share", "fnm"), "node-versions"), pattern: /^v22\./u, suffix: ["installation", "bin", "node"] },
    { root: join(process.env.VOLTA_HOME || join(home, ".volta"), "tools", "image", "node"), pattern: /^22\./u, suffix: ["bin", "node"] },
    { root: join(home, ".local", "share", "mise", "installs", "node"), pattern: /^22\./u, suffix: ["bin", "node"] },
    { root: join(home, ".asdf", "installs", "nodejs"), pattern: /^22\./u, suffix: ["bin", "node"] },
  ];
  for (const { root, pattern, suffix } of installations) {
    try {
      for (const version of readdirSync(root).filter(name => pattern.test(name)).sort().reverse()) {
        candidatePaths.push(join(root, version, ...suffix));
      }
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") {
        console.error(`Node 22 discovery skipped an unreadable install directory: ${root}`);
      }
    }
  }
  for (const candidate of new Set(candidatePaths)) {
    const result = spawnSync(candidate, ["-p", "process.versions.node"], {
      encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status === 0 && /^22\./u.test(result.stdout.trim())) {
      return { path: candidate, version: result.stdout.trim() };
    }
  }
  return null;
}
const selectedNode = existingNode22();
if (!selectedNode) {
  stop(`Node 22 required; shell uses ${process.versions.node}, and no existing Node 22 installation was found. Try 'nvm use 22' or 'fnm use 22' in this terminal and rerun.`);
}
if (process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT_ID ||
    process.env.RAILWAY_ENVIRONMENT_NAME?.toLowerCase() === "production") {
  stop("Refusing to run offline acceptance checks in a production-marked environment.");
}
const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", compatibilityBase, "HEAD"], {
  cwd: repository, stdio: "ignore",
});
if (ancestor.status !== 0) {
  stop("Wrong checkout. Switch to origin/accept/native-session-1001-256-20261011 first.");
}

// Offline tests must never accidentally inherit live opt-in flags or credentials.
const safeEnvironment = { ...process.env };
for (const key of Object.keys(safeEnvironment)) {
  if (key.startsWith("RUN_") || [
    "DATABASE_URL", "ANTHROPIC_API_KEY", "LEILEI_NATIVE_LIVE_RELAY_TOKEN",
    "LEILEI_NATIVE_LIVE_RELAY_URL", "LEILEI_NATIVE_LIVE_WAKE_BROKER_TOKEN",
    "LEILEI_NATIVE_LIVE_WAKE_BROKER_URL", "MCP_SERVER_URL",
  ].includes(key)) delete safeEnvironment[key];
}

safeEnvironment.PATH = dirname(selectedNode.path) + delimiter + (safeEnvironment.PATH || "");
const verified = spawnSync("node", ["-p", "process.versions.node"], {
  env: safeEnvironment, encoding: "utf8", timeout: 3000,
});
if (verified.status !== 0 || !/^22\./u.test(verified.stdout.trim())) {
  stop("Could not activate the discovered Node 22 for child processes.");
}

const steps = [
  ["Install root dependencies", ["install", "--frozen-lockfile"]],
  ["Install Claude Bridge dependencies", ["--dir", "tools/claude-bridge", "install", "--frozen-lockfile"]],
  ["Typecheck", ["typecheck"]],
  ["Build", ["build"]],
  ["Migration metadata check (no migration)", ["db:check"]],
  ["Production runtime OFFLINE tests", ["test:production-runtime-gate"]],
  ["Claude Bridge OFFLINE tests", ["--dir", "tools/claude-bridge", "test"]],
];

function printFailure(logFile) {
  const lines = readFileSync(logFile, "utf8").split(/\r?\n/u);
  const errors = [];
  const pattern = /(?:^|\s)(?:not ok\s+\d+|ERR_[A-Z_]+|ELIFECYCLE|FAIL(?:ED)?\b|error TS\d+|AssertionError\b|ReferenceError:|TypeError:|SyntaxError:|Error:|Cannot find (?:module|package)|✖)/iu;
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i]) && errors.length < 8) errors.push(i);
  }
  if (errors.length) {
    const relevant = new Set();
    for (const i of errors) {
      for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 5); j++) relevant.add(j);
    }
    console.error("\n--- Error locations (line number in saved log) ---");
    for (const i of [...relevant].sort((a, b) => a - b)) {
      console.error(`${i + 1}: ${lines[i]}`);
    }
  }
  console.error("\n--- Last 30 log lines ---");
  for (let i = Math.max(0, lines.length - 31); i < lines.length; i++) {
    if (lines[i]) console.error(`${i + 1}: ${lines[i]}`);
  }
}

console.log(`Using existing Node ${selectedNode.version} for offline checks.`);
console.log("Checking PR #1005 offline. Full output saved to private temporary logs.");
for (let i = 0; i < steps.length; i++) {
  const [name, args] = steps[i];
  const logFile = join(logDirectory, `step-${i + 1}.log`);
  const logFd = openSync(logFile, "w", 0o600);
  process.stdout.write(`[${i + 1}/${steps.length}] ${name} ... `);
  const result = spawnSync("pnpm", args, {
    cwd: repository, env: safeEnvironment,
    stdio: ["ignore", logFd, logFd],
    timeout: 15 * 60 * 1000,
  });
  closeSync(logFd);
  if (result.error || result.status !== 0) {
    console.log("FAIL");
    console.error(`FAILED STEP ${i + 1}: ${name}`);
    if (result.error) console.error(`Process error: ${result.error.code ?? result.error.message}`);
    else console.error(`Exit code: ${result.status ?? result.signal}`);
    printFailure(logFile);
    console.error(`\nComplete logs: ${logDirectory}`);
    console.error("OFFLINE_ACCEPTANCE_FAIL");
    process.exit(1);
  }
  console.log("PASS");
}
console.log("OFFLINE_ACCEPTANCE_PASS");
