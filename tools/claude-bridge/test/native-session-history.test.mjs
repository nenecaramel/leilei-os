import assert from "node:assert/strict";
import test from "node:test";
const moduleUrl = new URL("../src/native-session-history.mjs", import.meta.url);
const row = (uuid, parentUuid, type, content, extra = {}) => ({ uuid, parentUuid, type, timestamp: "2026-10-10T00:00:00.123Z", message: { content }, ...extra });
const snapshot = entries => ({ sessionId: "A", revision: "revision", entries });
const initial = [row("u", null, "user", "hello"), row("a1", "u", "assistant", [{ type: "tool_use", id: "t", name: "Read", input: { file_path: "/fixture" } }]), row("r", "a1", "user", [{ type: "tool_result", tool_use_id: "t", content: "result" }]), row("a2", "r", "assistant", [{ type: "text", text: "reply" }])];

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

test("sync is idempotent and appends new turns without deleting existing history", async () => {
  const { projectNativeHistory, planNativeHistorySync } = await import(moduleUrl);
  const before = projectNativeHistory(snapshot(initial), "a2");
  assert.deepEqual(planNativeHistorySync(before, before).upserts, []);
  const after = projectNativeHistory({ ...snapshot([...initial, row("u2", "a2", "user", "again"), row("a3", "u2", "assistant", "next")]), revision: "next" }, "a3");
  assert.deepEqual(planNativeHistorySync(before, after).upserts.map(m => m.sourceMessageId), ["u2", "a3"]);
  assert.equal(planNativeHistorySync(before, after).expectedRevision, "revision");
  assert.throws(() => planNativeHistorySync(after, before), e => e.code === "EXPLICIT_BRANCH_SELECTION_REQUIRED");
  assert.throws(() => planNativeHistorySync(before, { ...after, sessionId: "B" }), e => e.code === "EXPLICIT_BRANCH_SELECTION_REQUIRED");
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

test("sync cannot silently rewrite a previously projected older turn", async () => {
  const { projectNativeHistory, planNativeHistorySync } = await import(moduleUrl);
  const before = projectNativeHistory(snapshot(initial), "a2");
  const changed = structuredClone(initial);
  changed[0].message.content = "different old prompt";
  const after = projectNativeHistory(snapshot([...changed, row("u2", "a2", "user", "new"), row("a3", "u2", "assistant", "next")]), "a3");
  assert.throws(() => planNativeHistorySync(before, after), e => e.code === "NATIVE_HISTORY_REWRITTEN");
});

test("same active assistant may append blocks while preserving previously seen blocks", async () => {
  const { projectNativeHistory, planNativeHistorySync } = await import(moduleUrl);
  const before = projectNativeHistory(snapshot(initial), "a2");
  const after = projectNativeHistory(snapshot([...initial, row("a3", "a2", "assistant", "extra")]), "a3");
  assert.deepEqual(planNativeHistorySync(before, after).upserts.map(m => m.sourceMessageId), ["a1"]);
  const changed = structuredClone(initial);
  changed[3].message.content[0].text = "replaced reply";
  assert.throws(() => planNativeHistorySync(before, projectNativeHistory(snapshot(changed), "a2")), e => e.code === "NATIVE_HISTORY_REWRITTEN");
});

test("image extraction preserves bytes and computes integrity without writing files", async () => {
  const { projectNativeHistory, extractNativeHistoryAsset } = await import(moduleUrl);
  const bytes = Buffer.from([0, 1, 2, 255, 128]);
  const source = snapshot([row("u", null, "user", [{ type: "image", source: { type: "base64", media_type: "image/png", data: bytes.toString("base64") } }])]);
  const ref = projectNativeHistory(source, "u").messages[0].blocks[0].payload;
  const result = extractNativeHistoryAsset(source, ref, { expectedRevision: source.revision, maxBytes: 10 });
  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.sizeBytes, 5);
  assert.equal(result.sha256.length, 64);
  assert.equal(result.mimeType, "image/png");
});

test("image extraction rejects stale references, oversized bytes and invalid base64", async () => {
  const { projectNativeHistory, extractNativeHistoryAsset } = await import(moduleUrl);
  const source = snapshot([row("u", null, "user", [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }])]);
  const ref = projectNativeHistory(source, "u").messages[0].blocks[0].payload;
  assert.throws(() => extractNativeHistoryAsset(source, ref, { expectedRevision: "other", maxBytes: 10 }), e => e.code === "STALE_NATIVE_SNAPSHOT");
  assert.throws(() => extractNativeHistoryAsset(source, ref, { expectedRevision: source.revision, maxBytes: 1 }), e => e.code === "NATIVE_ASSET_TOO_LARGE");
  source.entries[0].message.content[0].source.data = "INVALID!";
  assert.throws(() => extractNativeHistoryAsset(source, ref, { expectedRevision: source.revision, maxBytes: 10 }), e => e.code === "INVALID_NATIVE_ASSET");
});

test("external URLs and local paths never trigger implicit image reads or downloads", async () => {
  const { projectNativeHistory, extractNativeHistoryAsset } = await import(moduleUrl);
  for (const asset of [{ type: "url", url: "https://private.invalid/image" }, { type: "file", path: "/private/file" }]) {
    const source = snapshot([row("u", null, "user", [{ type: "image", source: asset }])]);
    const ref = projectNativeHistory(source, "u").messages[0].blocks[0].payload;
    assert.throws(() => extractNativeHistoryAsset(source, ref, { expectedRevision: source.revision, maxBytes: 10 }), e => e.code === "NATIVE_ASSET_UNAVAILABLE");
  }
});

test("asset references cannot cross sessions or resolve to changed image content", async () => {
  const { projectNativeHistory, extractNativeHistoryAsset } = await import(moduleUrl);
  const source = snapshot([row("u", null, "user", [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }])]);
  const ref = projectNativeHistory(source, "u").messages[0].blocks[0].payload;
  assert.throws(() => extractNativeHistoryAsset({ ...source, sessionId: "B" }, ref, { expectedRevision: source.revision, maxBytes: 10 }), e => e.code === "STALE_NATIVE_ASSET");
  source.entries[0].message.content[0].source.data = "AQAA";
  assert.throws(() => extractNativeHistoryAsset(source, ref, { expectedRevision: source.revision, maxBytes: 10 }), e => e.code === "STALE_NATIVE_ASSET");
});
