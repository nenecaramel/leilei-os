import { spawnSync } from "node:child_process";

const stages = [
  { label: "typecheck", script: "typecheck" },
  { label: "runtime-background-loops", script: "test:runtime-background-loops" },
  { label: "runtime-proactivity", script: "test:runtime-proactivity" },
  { label: "native-live-minimal", script: "test:native-live-minimal" },
];

let failed = false;

for (const stage of stages) {
  process.stdout.write("\n=== " + stage.label + " ===\n");
  const result = spawnSync("pnpm", [stage.script], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    process.stderr.write(
      "\nFAILED: " + stage.label
      + " SPAWN="
      + (result.error.code ?? result.error.name ?? "UNKNOWN")
      + "\n",
    );
    failed = true;
    break;
  }

  if (result.status !== 0) {
    process.stderr.write(
      "\nFAILED: " + stage.label
      + (result.status === null ? "" : " EXIT=" + result.status)
      + (result.signal ? " SIGNAL=" + result.signal : "")
      + "\n",
    );
    failed = true;
    break;
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  process.stdout.write("\nALL PASS\n");
}
