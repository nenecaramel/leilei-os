import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectNativeSessionVisibleThinking } from "../src/domains/conversation/native-live-native-history-thinking.js";

const ids = {
  a: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  b: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  c: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  d: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
};
const fixture = (entries: Array<Record<string, unknown>>, requested: string[] = [ids.a, ids.b, ids.c, ids.d]) =>
  projectNativeSessionVisibleThinking(new Map(entries.map(e => [String(e.uuid), e])), {
    sourceEntryUuids: requested, providerSessionId: ids.d, fallbackTime: "2026-10-11T12:00:00.000Z",
  });

test("already imported and future synced Claude session entries project into the existing runtime Thinking contract", () => {
  const entries = [
    { uuid: ids.a, type: "assistant", timestamp: "2026-10-11T12:01:00.000Z", message: { content: [
      { type: "thinking", thinking: "Provider-visible summary", signature: "DO_NOT_EXPOSE" },
      { type: "text", text: "answer" },
    ] } },
    { uuid: ids.b, type: "assistant", message: { content: [{ type: "thinking", thinking: "second summary" }] } },
  ];
  const projected = fixture(entries);
  assert.deepEqual(projected.map(e => e.event.payload?.kind), ["user_visible_thinking", "user_visible_thinking"]);
  assert.deepEqual(projected.map(e => e.event.payload?.text), ["Provider-visible summary", "second summary"]);
  assert.deepEqual(projected.map(e => e.event.payload?.source_uuid), [ids.a, ids.b]);
  assert.deepEqual(projected.map(e => e.event.payload?.content_index), [0, 0]);
  assert.equal(projected[0]?.createdAt, "2026-10-11T12:01:00.000Z");
  assert.equal(projected[1]?.createdAt, "2026-10-11T12:00:00.000Z");
  assert.doesNotMatch(JSON.stringify(projected), /DO_NOT_EXPOSE|answer/);
});

test("empty omitted thinking, signatures, redacted blocks, tool output and sidechains stay excluded", () => {
  const entries = [
    { uuid: ids.a, type: "assistant", message: { content: [
      { type: "thinking", thinking: "", signature: "private" },
      { type: "redacted_thinking", data: "private" },
      { type: "thinking_delta", thinking: "private" },
      { type: "tool_use", input: { thinking: "private" } },
    ] } },
    { uuid: ids.b, type: "assistant", isSidechain: true, message: { content: [{ type: "thinking", thinking: "nested" }] } },
    { uuid: ids.c, type: "assistant", parent_tool_use_id: "tool", message: { content: [{ type: "thinking", thinking: "nested" }] } },
    { uuid: ids.d, type: "user", message: { content: [{ type: "thinking", thinking: "user" }] } },
  ];
  assert.deepEqual(fixture(entries), []);
});

test("only exact claimed UUIDs are displayed; duplicate claims and oversized strings are bounded", () => {
  const entries = [
    { uuid: ids.a, type: "assistant", message: { content: [{ type: "thinking", thinking: "x".repeat(12_000) }] } },
    { uuid: ids.b, type: "assistant", message: { content: [{ type: "thinking", thinking: "not in claim" }] } },
  ];
  const output = fixture(entries, [ids.a, ids.a]);
  assert.equal(output.length, 1);
  assert.equal(String(output[0]?.event.payload?.text).length, 8_000);
  assert.equal(output[0]?.event.payload?.source_uuid, ids.a);
});

test("historical Thinking is a read-time overlay, with no canonical message or digest rewrites", () => {
  const read = readFileSync("src/domains/conversation/native-live-current-path-read-repository.ts", "utf8");
  const owner = readFileSync("src/domains/conversation/native-live-native-history-thinking.ts", "utf8");
  assert.match(read, /readNativeSessionVisibleThinkingByAssistant/);
  assert.match(read, /events: \[\.\.\.baseActivity\.events, \.\.\.supplemental\]/);
  assert.match(read, /HIDDEN_REASONING_EXCLUDED/);
  assert.match(read, /native-thinking-v1/);
  assert.match(owner, /conversationProviderSessionCheckpoints\.runtimeMetadata/);
  assert.match(owner, /native_source_message_id/);
  assert.match(owner, /source_entry_uuids/);
  assert.match(owner, /eq\(nativeLiveProviderSessionEntries\.userId, input\.userId\)/);
  assert.match(owner, /eq\(nativeLiveProviderSessionEntries\.subpath, ""\)/);
  assert.doesNotMatch(owner, /insert\(|update\(|delete\(/);
});
