import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

if (process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    "Unset ANTHROPIC_API_KEY; this suite verifies the existing Claude subscription login.",
  );
}

const here = path.dirname(fileURLToPath(import.meta.url));
const cases = [
  ["filesystem", "agent-sdk-filesystem-parity-smoke.mjs"],
  ["mcp", "agent-sdk-mcp-parity-smoke.mjs"],
  ["background_task", "agent-sdk-background-task-parity-smoke.mjs"],
  ["plugin", "agent-sdk-plugin-parity-smoke.mjs"],
];

const results = [];

for (const [name, script] of cases) {
  const startedAt = Date.now();
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(here, script)],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      if (signal) {
        reject(
          new Error(
            `Agent SDK parity smoke ${name} exited by signal ${signal}.`,
          ),
        );
        return;
      }
      resolve(exitCode ?? 1);
    });
  });

  results.push({
    name,
    outcome: code === 0 ? "PASS" : "FAIL",
    exitCode: code,
    durationMs: Date.now() - startedAt,
  });

  if (code !== 0) break;
}

const passed =
  results.length === cases.length
  && results.every((result) => result.outcome === "PASS");

process.stdout.write(
  JSON.stringify(
    {
      outcome: passed ? "PASS" : "FAIL",
      sdk: "@anthropic-ai/claude-agent-sdk@0.3.281",
      auth: "existing_claude_subscription_login",
      suite: "remaining_core_parity",
      results,
    },
    null,
    2,
  ) + "\n",
);

if (!passed) process.exitCode = 1;
