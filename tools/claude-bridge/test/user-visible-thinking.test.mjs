import assert from "node:assert/strict";
import test from "node:test";
import { normalizeClaudeEvents } from "../src/normalized-events.mjs";

const base = { logicalConversationId: "visible-thinking-test", mode: "new", parentProviderSessionId: null };

test("explicit top-level Claude assistant thinking becomes a visible runtime event", () => {
  const events = normalizeClaudeEvents([{
    type: "assistant", session_id: "s", uuid: "assistant-message-1",
    message: { content: [
      { type: "thinking", thinking: "Checking the next step.", signature: "DO_NOT_LEAK" },
      { type: "text", text: "Here is the result." },
      { type: "tool_use", id: "t1", name: "Read", input: { path: "a" } }
    ] },
  }], base);
  assert.deepEqual(events.map(e => e.type), ["runtime", "text", "tool_use"]);
  assert.deepEqual(events[0].payload, {
    kind: "user_visible_thinking", text: "Checking the next step.",
    source_uuid: "assistant-message-1", content_index: 0,
  });
  assert.ok(!JSON.stringify(events).includes("DO_NOT_LEAK"));
  assert.equal(events[1].payload.text, "Here is the result.");
  assert.equal(events[2].payload.tool_name, "Read");
});

test("streamed reasoning deltas, redacted thinking and nested assistant reasoning stay hidden", () => {
  const events = normalizeClaudeEvents([
    { type: "stream_event", session_id: "s",
      event: { type: "content_block_delta", index: 0,
        delta: { type: "thinking_delta", thinking: "PRIVATE_DELTA" } } },
    { type: "assistant", session_id: "s", parent_agent_id: "nested",
      message: { content: [{ type: "thinking", thinking: "PRIVATE_AGENT" }] } },
    { type: "assistant", session_id: "s",
      message: { content: [{ type: "redacted_thinking", data: "PRIVATE_REDACTED" }] } },
    { type: "assistant", session_id: "s", parent_tool_use_id: "nested",
      message: { content: [{ type: "thinking", thinking: "PRIVATE_TOOL" }] } },
  ], base);
  const serialized = JSON.stringify(events);
  for(const secret of ["PRIVATE_DELTA","PRIVATE_AGENT","PRIVATE_REDACTED","PRIVATE_TOOL"]) {
    assert.ok(!serialized.includes(secret));
  }
  assert.equal(events.filter(e => e.payload?.kind === "user_visible_thinking").length, 0);
});

test("empty thinking is skipped and surfaced text is bounded", () => {
  const events = normalizeClaudeEvents([
    { type: "assistant", session_id: "s", message: { content: [
      { type: "thinking", thinking: "  " },
      { type: "thinking", thinking: "A".repeat(12_000) }
    ] } }
  ], base);
  const visible = events.filter(e => e.payload?.kind === "user_visible_thinking");
  assert.equal(visible.length, 1);
  assert.equal(visible[0].payload.text.length, 8_000);
  assert.equal(visible[0].payload.content_index, 1);
});
