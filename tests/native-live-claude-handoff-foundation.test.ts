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
    /status" IN \(\s*'pending','reserved','completed','failed','stale','expired'/,
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
  assert.match(source, /effective_working_directory IS NOT NULL/);
  assert.match(source, /return "completed" as const/);
  assert.match(source, /return "stale" as const/);
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
