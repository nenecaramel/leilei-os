import assert from "node:assert/strict";
import test from "node:test";
import { normalizeClaudeEvents } from "../src/normalized-events.mjs";

const base = { logicalConversationId: "logical-1", mode: "new", parentProviderSessionId: null };
const realFixture = [
  { type: "system", subtype: "init", session_id: "session-1", model: "claude" },
  { type: "rate_limit_event", session_id: "session-1", rate_limit_info: {} },
  { type: "assistant", session_id: "session-1", message: { content: [{ type: "text", text: "READY" }] } },
  { type: "result", subtype: "success", session_id: "session-1", result: "READY", duration_ms: 42 },
];

test("normalizes real Claude 2.1.267 system, assistant, rate-limit, and result events", () => {
  const events = normalizeClaudeEvents(realFixture, base);
  assert.deepEqual(events.map((event) => event.type), ["session", "runtime", "text", "result"]);
  assert.equal(events[2].payload.text, "READY"); assert.equal(events[3].payload.final_text, "READY");
  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3, 4]);
});

test("keeps rate-limit events out of final text and maps synthetic partial/tool contracts", () => {
  const events = normalizeClaudeEvents([{ type: "system", subtype: "init", session_id: "s" }, { type: "assistant", session_id: "s", delta: { text: "hel" } }, { type: "assistant", session_id: "s", message: { content: [{ type: "tool_use", id: "tu-1", name: "Read", input: { path: "x" } }, { type: "tool_result", tool_use_id: "tu-1", content: "ok", is_error: false }] } }], base);
  assert.deepEqual(events.map((event) => event.type), ["session", "partial_text", "tool_use", "tool_result"]);
});

test("unknown and conflicting-session events are surfaced without crashing", () => {
  const events = normalizeClaudeEvents([{ type: "system", subtype: "init", session_id: "s" }, { type: "future", subtype: "x", session_id: "s" }, { type: "assistant", session_id: "other", message: { content: [] } }], base);
  assert.equal(events[1].type, "runtime"); assert.equal(events[2].type, "error");
});
