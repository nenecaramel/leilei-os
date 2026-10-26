import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

// The owner's switch command runs these scripts with the repository's pinned
// Node. A stale major check refuses every handoff before it starts.
const pinned = Number(readFileSync(new URL("../.node-version", import.meta.url), "utf8").trim().split(".")[0]);

// Without a terminal, the picker's next refusal after the Node check.
for (const [script, args, expected] of [
  ["native-session-local.mjs", ["bogus"], null],
  ["native-session-pick.mjs", ["desktop"], "INTERACTIVE_TERMINAL_REQUIRED"],
] as const) {
  test(`${script} accepts the pinned Node major`, { skip: Number(process.versions.node.split(".")[0]) !== pinned }, () => {
    const run = spawnSync(process.execPath, [new URL(`../scripts/${script}`, import.meta.url).pathname, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    assert.doesNotMatch(run.stderr, /NODE_\d+_REQUIRED/);
    if (expected) assert.equal(run.stderr.trim(), expected);
  });
}
