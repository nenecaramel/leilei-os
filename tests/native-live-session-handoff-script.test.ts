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
  assert.match(source, /forkHistoryMatchesCanonical: "passed"/);
  assert.match(source, /--recover-existing/);
  assert.match(source, /recentClaudeSessionFiles\(/);
  assert.match(source, /\.claude/);
  assert.doesNotMatch(source, /sdk\.listSessions\(/);
  assert.match(source, /claude --resume/);

  assert.doesNotMatch(source, /archiveConversation|lifecycle_status\s*=\s*'archived'/);
  assert.doesNotMatch(source, /deleteSession|unlinkSync|rmSync/);
});

test("handoff validation compares full visible history without requiring source UUIDs to survive the fork", () => {
  const source = read("scripts/native-live-handoff-current-session-local.ts");

  assert.match(
    source,
    /visibleConversationProjectionFromEntries\(\s*verified\.prefix/,
  );
  assert.match(
    source,
    /visibleConversationProjectionFromSdkMessages\(\s*visible/,
  );
  assert.match(source, /historyMatchesCanonical/);
  assert.doesNotMatch(
    source,
    /checkpointPrefixOrNull\(\s*forkEntries,\s*leaf\.provider_checkpoint_id/,
  );
});

test("local restore probes the real local SDK transcript before remote SessionStore fallback", () => {
  const source = read("scripts/native-live-restore-current-session-local.ts");

  const localProbe = source.indexOf(
    "const localEntries = await readLocalEntriesWithInstalledSdk",
  );
  const remoteProbe = source.indexOf(
    "new NativeLiveMacProviderSessionStore",
  );

  assert.ok(localProbe >= 0, "local SDK transcript probe must exist");
  assert.ok(remoteProbe > localProbe, "remote SessionStore must be fallback-only");
  assert.match(source, /sourceStorage = "local_sdk"/);
  assert.match(
    source,
    /Neither the local Claude transcript nor the remote SessionStore contains the current canonical checkpoint/,
  );
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
