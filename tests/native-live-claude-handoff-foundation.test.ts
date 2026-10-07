import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Claude handoff migration persists exact source checkpoint, terminal B, and bounded queue state", () => {
  const migration =
    read("drizzle/0103_native_live_claude_handoff.sql");

  for (const column of [
    "expected_head_message_id",
    "source_message_id",
    "provider_session_id",
    "provider_checkpoint_id",
    "effective_working_directory",
    "handoff_session_id",
    "reservation_expires_at",
  ]) {
    assert.match(migration, new RegExp(`"${column}"`));
  }
  assert.match(
    migration,
    /status" IN \(\s*'pending','reserved','delivery_unknown','completed','failed','stale','expired'/,
  );
  assert.match(
    migration,
    /"effective_working_directory" text NOT NULL/,
  );
  assert.match(
    migration,
    /native_live_claude_handoffs_active_uidx/,
  );
});

test("server archives A only after an isolated B is returned and exact head/checkpoint are still current", () => {
  const source =
    read("src/domains/bridge/provider-session/native-live-claude-handoff.ts");

  const isolated = source.indexOf(
    "handoffSessionId === current.provider_session_id",
  );
  const headCheck = source.indexOf(
    "conversation.current_head_message_id",
    isolated,
  );
  const checkpointCheck = source.indexOf(
    "provider_checkpoint_id =",
    headCheck,
  );
  const archive = source.indexOf(
    "SET lifecycle_status = 'archived'",
  );

  assert.ok(isolated >= 0);
  assert.ok(headCheck > isolated);
  assert.ok(checkpointCheck > headCheck);
  assert.ok(archive > checkpointCheck);
  assert.match(source, /hasInFlightTurn\(tx/);
  assert.match(source, /'delivery_unknown'/);
  assert.match(source, /current\.status === "completed"/);
  assert.match(source, /current\.status === "stale"/);
  assert.match(
    source,
    /checkpoint\.canonical_message_id =[\s\S]*conversation\.current_head_message_id/,
  );
  assert.doesNotMatch(
    source,
    /WITH RECURSIVE current_path/,
  );
  assert.match(source, /effective_working_directory IS NOT NULL/);
  assert.match(source, /return "completed" as const/);
  assert.match(source, /return "stale" as const/);
});

test("repeated handoff creation resumes the existing nonterminal request instead of scheduling B2", () => {
  const source =
    read("src/domains/bridge/provider-session/native-live-claude-handoff.ts");

  assert.match(
    source,
    /status IN \('pending','reserved','delivery_unknown'\)[\s\S]*return readModel\(active\[0\]\)/,
  );
});

test("handoff and manual compact share conversation-first locking and reject each other", () => {
  const handoff =
    read("src/domains/bridge/provider-session/native-live-claude-handoff.ts");
  const compact =
    read("src/domains/bridge/turn/native-live-manual-compact.ts");

  const handoffLock = handoff.indexOf(
    "FROM conversations",
    handoff.indexOf("async create"),
  );
  const handoffQueue = handoff.indexOf(
    "UPDATE native_live_claude_handoffs",
    handoff.indexOf("async create"),
  );
  const compactLock = compact.indexOf(
    "FROM conversations",
    compact.indexOf("async create"),
  );
  const compactQueue = compact.indexOf(
    "UPDATE native_live_manual_compactions",
    compact.indexOf("async create"),
  );

  assert.ok(handoffLock >= 0 && handoffQueue > handoffLock);
  assert.ok(compactLock >= 0 && compactQueue > compactLock);
  assert.match(
    handoff,
    /FROM native_live_manual_compactions[\s\S]*status IN \('pending','reserved'\)/,
  );
  assert.match(
    compact,
    /FROM native_live_claude_handoffs[\s\S]*'pending','reserved','delivery_unknown'/,
  );
  assert.match(
    compact,
    /'staged','pending','reserved','executing',[\s\S]*'delivery_unknown'/,
  );
});

test("public handoff maintenance reconciles crashed reservations without allowing an immediate second fork", () => {
  const source =
    read("src/domains/bridge/provider-session/native-live-claude-handoff.ts");

  assert.match(
    source,
    /const DELIVERY_UNKNOWN_RECOVERY_TTL_MS =\s*15 \* 60_000/,
  );
  assert.match(
    source,
    /status = 'delivery_unknown'[\s\S]*status = 'reserved'[\s\S]*reservation_expires_at <= now\(\)/,
  );
  assert.match(
    source,
    /status = 'failed'[\s\S]*failure_code = 'RECOVERY_EXPIRED'[\s\S]*status = 'delivery_unknown'/,
  );
  assert.match(
    source,
    /status IN \('pending','reserved','delivery_unknown'\)/,
  );
});

test("expired Claude handoff reservations preserve the original owner so a durable B receipt can arrive late", () => {
  const source =
    read("src/domains/bridge/provider-session/native-live-claude-handoff.ts");

  const expiry = source.match(
    /UPDATE native_live_claude_handoffs[\s\S]*?status = 'delivery_unknown'[\s\S]*?failure_code = 'RESULT_DELIVERY_UNKNOWN'[\s\S]*?WHERE user_id = \$\{input\.userId\}::uuid[\s\S]*?status = 'reserved'/,
  )?.[0];
  assert.ok(expiry, "reservation expiry update must exist");
  assert.doesNotMatch(
    expiry,
    /reserved_by = NULL/,
  );
  assert.match(
    source,
    /current\.status === "delivery_unknown"[\s\S]*current\.failure_code === "RESULT_DELIVERY_UNKNOWN"[\s\S]*current\.reserved_by === input\.listenerInstanceId/,
  );
  assert.match(
    source,
    /current\.status = "reserved"/,
  );
  assert.match(
    source,
    /status IN \('pending','reserved','delivery_unknown'\)/,
  );
});

test("handoff failure never archives the LeileiOS source conversation", () => {
  const source =
    read("src/domains/bridge/provider-session/native-live-claude-handoff.ts");
  const failure = source.match(
    /if \(input\.outcome\.status === "failure"\) \{([\s\S]*?)return "failed" as const;/,
  )?.[1];

  assert.ok(failure, "failure branch must exist");
  assert.doesNotMatch(failure, /UPDATE conversations|lifecycle_status/);
});

test("archived LeileiOS conversations remain readable but active write gates remain separate", () => {
  const reader =
    read("src/domains/conversation/native-live-current-path-read-repository.ts");
  const repository =
    read("src/domains/conversation/native-live-conversation-repository.ts");

  assert.match(
    reader,
    /inArray\(\s*conversations\.lifecycleStatus,\s*\["active", "archived"\]/,
  );
  assert.match(
    repository,
    /eq\(conversations\.lifecycleStatus, "active"\)/,
  );
  assert.match(
    repository,
    /outcome: "handoff_archived"/,
  );
});

test("production daemon durably persists successful Claude handoff receipts before delivery", () => {
  const daemon =
    read("scripts/native-live-mac-daemon.ts");
  const loop =
    read("src/domains/bridge/mac/native-live-mac-daemon-loop.ts");

  assert.match(
    daemon,
    /new NativeLiveMacClaudeHandoffOutbox/,
  );
  assert.match(
    daemon,
    /"claude-handoffs"/,
  );
  const save = loop.indexOf(
    "claudeHandoffOutbox\n              ?.save",
  );
  const submit = loop.indexOf(
    "submitClaudeHandoffResult",
    save,
  );
  const acknowledge = loop.indexOf(
    "acknowledge(pendingHandoff)",
    submit,
  );
  assert.ok(save >= 0);
  assert.ok(submit > save);
  assert.ok(acknowledge > submit);
});

test("iOS exposes Continue in Claude Code and archived conversations open a read-only canonical viewer", () => {
  const page =
    read("ios/LeileiOS/LeileiOS/Navigation/PageContainer.swift");
  const list =
    read("ios/LeileiOS/LeileiOS/Pages/Conversations/ConversationList.swift");
  const archived =
    read("ios/LeileiOS/LeileiOS/Pages/Conversations/ArchivedConversationView.swift");

  assert.match(page, /Continue in Claude Code/);
  assert.match(
    page,
    /continueActiveNativeLiveConversationInClaudeCode/,
  );
  assert.match(list, /ArchivedConversationView\(/);
  assert.match(list, /conversation\.claudeHandoffSessionId == nil/);
  assert.match(archived, /nativeLiveCurrentPath\(/);
  assert.match(archived, /nativeLiveMessageList\(/);
  assert.match(archived, /beforeMessageID: olderCursor/);
  assert.doesNotMatch(
    archived,
    /activeNativeLiveConversationID\s*=|ChatComposer\(|sendMessage\(/,
  );
});
