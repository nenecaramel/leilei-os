import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Claude Code handoff forks the exact canonical checkpoint without mutating the source session", () => {
  const source = read("scripts/native-live-handoff-current-session-local.ts");

  assert.match(source, /sdk\.forkSession\(/);
  assert.match(source, /upToMessageId: leaf\.provider_checkpoint_id/);
  assert.match(source, /sourceBeforeHash = transcriptHash\(localEntries\)/);
  assert.match(source, /transcriptHash\(sourceAfter\) !== sourceBeforeHash/);
  assert.match(source, /sourceSessionUnchanged: "passed"/);
  assert.match(source, /forkTranscriptReadable: "passed"/);
  assert.match(source, /sdkGetSessionMessages: "passed"/);
  assert.match(source, /claude --resume/);

  assert.doesNotMatch(source, /recover-existing|historyMatchesCanonical/);
  assert.doesNotMatch(source, /archiveConversation|lifecycle_status\s*=\s*'archived'/);
  assert.doesNotMatch(source, /deleteSession|unlinkSync|rmSync/);
});

test("handoff validates source identity and fork readability without assuming UUID preservation", () => {
  const source = read("scripts/native-live-handoff-current-session-local.ts");

  assert.match(source, /forkEntries\.length === 0/);
  assert.match(source, /sdk\.getSessionMessages\(/);
  assert.doesNotMatch(
    source,
    /checkpointPrefixOrNull\(\s*forkEntries,\s*leaf\.provider_checkpoint_id/,
  );
});

test("production Claude transport refuses official handoff from a remote SessionStore", () => {
  const source = read("tools/claude-bridge/src/agent-sdk-claude-transport.mjs");

  assert.match(
    source,
    /Claude Code handoff requires the local SDK transcript store/,
  );
  assert.match(source, /async forkSessionAtCheckpoint/);
  assert.match(source, /upToMessageId: checkpoint/);
});

test("package exposes an explicit non-destructive current-session handoff command", () => {
  const pkg = JSON.parse(read("package.json")) as {
    scripts: Record<string, string>;
  };

  assert.equal(
    pkg.scripts["runtime:native-live-handoff-current-session-local"],
    "tsx scripts/native-live-handoff-current-session-local.ts",
  );
});
