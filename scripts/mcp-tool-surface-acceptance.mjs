import { spawnSync } from "node:child_process";

function runGit(args) {
  return spawnSync("git", args, {
    encoding: "utf8",
    env: process.env,
  });
}

function requireCleanTrackedCheckout() {
  const head = runGit(["rev-parse", "--verify", "HEAD"]);
  if (head.status !== 0) {
    process.stderr.write("\nFAILED: acceptance checkout is not a Git worktree with a valid HEAD.\n");
    process.exit(1);
  }

  const diff = runGit(["diff", "--name-only", "HEAD", "--"]);
  if (diff.status !== 0) {
    process.stderr.write("\nFAILED: could not verify acceptance checkout integrity.\n");
    process.exit(1);
  }
  const changed = diff.stdout.trim();
  if (changed) {
    process.stderr.write(
      "\nFAILED: tracked files differ from HEAD; acceptance results would not represent the fetched branch.\n"
      + changed
        .split("\n")
        .filter(Boolean)
        .map((file) => `  - ${file}\n`)
        .join("")
      + "Inspect with: git diff -- <file>\n",
    );
    process.exit(1);
  }

  const flagged = runGit(["ls-files", "-v"]);
  if (flagged.status !== 0) {
    process.stderr.write("\nFAILED: could not inspect tracked-file flags.\n");
    process.exit(1);
  }
  const hidden = flagged.stdout
    .split("\n")
    .filter((line) => /^[a-zS]/.test(line));
  if (hidden.length) {
    process.stderr.write(
      "\nFAILED: tracked files use assume-unchanged/skip-worktree flags; acceptance may read stale local content.\n"
      + hidden.map((line) => `  - ${line}\n`).join("")
      + "Clear those flags before acceptance.\n",
    );
    process.exit(1);
  }
}

requireCleanTrackedCheckout();

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
