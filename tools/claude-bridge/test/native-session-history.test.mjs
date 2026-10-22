import assert from "node:assert/strict";
import test from "node:test";
const moduleUrl = new URL("../src/native-session-history.mjs", import.meta.url);
const row = (uuid, parentUuid, type, content, extra = {}) => ({ uuid, parentUuid, type, timestamp: "2026-10-10T00:00:00.123Z", message: { content }, ...extra });
const snapshot = entries => ({ sessionId: "A", revision: "revision", entries });
const initial = [row("u", null, "user", "hello"), row("a1", "u", "assistant", [{ type: "tool_use", id: "t", name: "Read", input: { file_path: "/fixture" } }]), row("r", "a1", "user", [{ type: "tool_result", tool_use_id: "t", content: "result" }]), row("a2", "r", "assistant", [{ type: "text", text: "reply" }])];

test("a retained compact summary without its boundary is never complete original history", async () => {
  const { projectNativeHistory } = await import(moduleUrl);
  assert.throws(() => projectNativeHistory(snapshot([
    row("summary", null, "user", "SYNTHETIC_SUMMARY", { isCompactSummary: true }),
    row("a", "summary", "assistant", "reply"),
  ]), "a"), e => e.code === "COMPACT_SOURCE_HISTORY_REQUIRED");
});

test("history groups SDK fragments and tool responses into one assistant turn", async () => {
  const { projectNativeHistory } = await import(moduleUrl);
  const source = snapshot(initial);
  const before = structuredClone(source);
  const result = projectNativeHistory(source, "a2");
  assert.deepEqual(result.messages.map(m => [m.sourceMessageId, m.role]), [["u", "user"], ["a1", "assistant"]]);
  assert.deepEqual(result.messages[1].blocks.map(b => b.kind), ["tool_use", "tool_result", "text"]);
  assert.equal(result.messages[1].providerCheckpointId, "a2");
  assert.equal(result.messages[0].parentProviderCheckpointId, null);
  assert.equal(result.messages[1].parentSourceMessageId, "u");
  assert.equal(result.messages[0].createdAt, "2026-10-10T00:00:00.123Z");
  assert.deepEqual(source, before);
});

test("compact display ancestry retains prior history without projecting synthetic prompts", async () => {
  const { projectNativeHistory } = await import(moduleUrl);
  const entries = [...initial, row("compact", null, "system", null, { subtype: "compact_boundary", logicalParentUuid: "a2" }), row("summary", "compact", "user", "INTERNAL_SUMMARY", { isCompactSummary: true }), row("u2", "summary", "user", "after compact"), row("a3", "u2", "assistant", "new reply")];
  const result = projectNativeHistory(snapshot(entries), "a3");
  assert.deepEqual(result.messages.map(m => m.sourceMessageId), ["u", "a1", "u2", "a3"]);
  assert.equal(result.messages[2].parentProviderCheckpointId, "summary");
  assert.equal(result.messages[2].parentSourceMessageId, "a1");
  assert.doesNotMatch(JSON.stringify(result), /INTERNAL_SUMMARY/);
});

test("exact selected history excludes later tails, alternatives and sidechains", async () => {
  const { projectNativeHistory } = await import(moduleUrl);
  const entries = [...initial, row("other", "u", "assistant", "OTHER_BRANCH"), row("side", "u", "assistant", "SIDECHAIN", { isSidechain: true }), row("later", "a2", "user", "LATER")];
  const result = projectNativeHistory(snapshot(entries), "a2");
  assert.equal(result.messages.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /OTHER_BRANCH|SIDECHAIN|LATER/);
});

test("attachment reminders stay internal; images retain extraction references without raw bytes", async () => {
  const { projectNativeHistory } = await import(moduleUrl);
  const entries = [row("u", null, "user", [{ type: "image", source: { type: "base64", media_type: "image/png", data: "PRIVATE_BINARY" } }, { type: "text", text: "picture" }]), row("reminder", "u", "attachment", null, { attachment: { type: "hook_context", content: "PRIVATE_REMINDER" } }), row("a", "reminder", "assistant", [{ type: "thinking", thinking: "PRIVATE_REASONING", signature: "PRIVATE_SIGNATURE" }, { type: "text", text: "reply" }])];
  const result = projectNativeHistory(snapshot(entries), "a");
  const image = result.messages[0].blocks[0];
  assert.equal(image.kind, "image");
  assert.equal(image.payload.source_entry_uuid, "u");
  assert.equal(image.payload.source_block_ordinal, 0);
  assert.equal(image.payload.materialization, "pending");
  assert.equal(image.payload.mime_type, "image/png");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_BINARY|PRIVATE_REMINDER|PRIVATE_REASONING|PRIVATE_SIGNATURE/);
});

test("unknown content and missing timestamps remain explicit rather than invented", async () => {
  const { projectNativeHistory } = await import(moduleUrl);
  const entries = [row("u", null, "user", "hello", { timestamp: undefined }), row("a", "u", "assistant", [{ type: "future_block", value: 7 }])];
  const result = projectNativeHistory(snapshot(entries), "a");
  assert.equal(result.messages[0].createdAt, null);
  assert.equal(result.messages[1].blocks[0].kind, "unknown");
  assert.equal(result.messages[1].blocks[0].rawType, "future_block");
});

test("incomplete compact history, contradictory UUIDs and logical cycles fail closed", async () => {
  const { projectNativeHistory } = await import(moduleUrl);
  for (const entries of [
    [row("compact", null, "system", null, { subtype: "compact_boundary", logicalParentUuid: "missing" }), row("a", "compact", "assistant", "reply")],
    [row("u", null, "user", "first"), row("u", null, "user", "contradiction"), row("a", "u", "assistant", "reply")],
    [row("compact", null, "system", null, { subtype: "compact_boundary", logicalParentUuid: "a" }), row("a", "compact", "assistant", "reply")],
  ]) assert.throws(() => projectNativeHistory(snapshot(entries), "a"));
});

test("replayed duplicate carriers do not duplicate displayed messages", async () => {
  const { projectNativeHistory } = await import(moduleUrl);
  assert.equal(projectNativeHistory(snapshot([...initial, ...initial]), "a2").messages.length, 2);
});

test("Desktop rewritten preserved tail requires a source transcript, never a guessed history", async () => {
  const { projectNativeHistory } = await import(moduleUrl);
  const entries = [
    row("compact", null, "system", null, { subtype: "compact_boundary", logicalParentUuid: "stop", compactMetadata: { preservedSegment: { anchorUuid: "old-user", headUuid: "a", tailUuid: "stop" } } }),
    row("summary", "compact", "user", "SUMMARY_IS_NOT_OLD_MESSAGES", { isCompactSummary: true }),
    row("a", "summary", "assistant", "retained reply"),
    row("stop", "a", "system", null, { subtype: "stop_hook_summary" }),
    row("u2", "stop", "user", "new prompt"),
    row("a2", "u2", "assistant", "new reply"),
  ];
  assert.throws(() => projectNativeHistory(snapshot(entries), "a2"), e => e.code === "COMPACT_SOURCE_HISTORY_REQUIRED");
});
