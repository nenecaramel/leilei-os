import { spawnSync } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const steps = [
  ["typecheck", ["typecheck"]],
  ["Todo batch", ["test:mcp-todo-batch"]],
  ["pagination", ["test:mcp-pagination"]],
  ["bounded read", ["test:mcp-bounded-read"]],
  ["typed Notion", ["test:mcp-typed-notion"]],
  ["mutation contract", ["test:mcp-mutation-contract"]],
  ["error recovery", ["test:mcp-error-recovery"]],
  ["revision / idempotency", ["test:mcp-revision-idempotency"]],
  ["domain / enum semantics", ["test:mcp-domain-semantics"]],
  ["naming / deprecation", ["test:mcp-naming-deprecation"]],
  ["UI working note", ["test:mcp-ui-working-note"]],
  ["tool surface", ["test:mcp-tool-surface"]],
  ["native live minimal", ["test:native-live-minimal"]],
];

for (let index = 0; index < steps.length; index += 1) {
  const [label, args] = steps[index];
  const stepNumber = index + 1;
  process.stdout.write(`\n[${stepNumber}/${steps.length}] ${label}\n`);

  const result = spawnSync(pnpm, args, {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    process.stderr.write(
      `\nFAILED: step ${stepNumber}/${steps.length} ${label} — ${result.error.message}\n`,
    );
    process.exit(1);
  }

  const exitCode = result.status ?? 1;
  if (exitCode !== 0) {
    process.stderr.write(
      `\nFAILED: step ${stepNumber}/${steps.length} ${label} (exit ${exitCode})\n`,
    );
    process.exit(exitCode);
  }

  process.stdout.write(`PASS: ${label}\n`);
}

process.stdout.write("\nALL PASS\n");
