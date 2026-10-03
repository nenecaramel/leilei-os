import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { canonicalizeNativeLiveEvents } from "../src/domains/conversation/native-live-conversation-orchestrator.js";

const helperPath = "src/domains/conversation/native-live-question-activity.ts";
const use = { kind: "tool_use" as const, rawType: "tool_use", payload: {
  tool_use_id: "q1", tool_name: "AskUserQuestion", input: { questions: [{ question: "Theme?", header: "Theme", options: [] }] }, parent_tool_use_id: "task1",
} };
const result = { kind: "tool_result" as const, rawType: "tool_result", payload: { tool_use_id: "q1", output: "opaque provider text", is_error: false } };

test("canonical tool blocks preserve provider question identity, input and parent after runtime history expires", () => {
  const canonical = canonicalizeNativeLiveEvents([
    { type: "tool_use", payload: { ...use.payload, display_name: "Misleading UI title" } },
    { type: "tool_result", payload: result.payload },
  ]);
  assert.deepEqual(canonical.blocks, [use, result]);
});

test("resolved questions persist only minimal answer/cancel metadata in existing canonical blocks", async () => {
  assert.ok(fs.existsSync(helperPath), "durable canonical question enrichment is missing");
  const { withCanonicalQuestionActivity } = await import("../src/domains/conversation/native-live-question-activity.js");
  for (const [response, expected] of [
    [{ decision: "answer", answers: { "Theme?": "Dark" } }, { kind: "question", resolution: "answered", answers: { "Theme?": "Dark" } }],
    [{ decision: "cancel", message: "Dismissed" }, { kind: "question", resolution: "cancelled", message: "Dismissed" }],
  ] as const) {
    const enriched = withCanonicalQuestionActivity([use, result], [{ kind: "question", status: "resolved", request: { toolUseId: "q1" }, response }]);
    assert.deepEqual(enriched[1]?.payload?.question_activity, expected);
    assert.deepEqual(enriched[0], use);
    assert.equal(enriched.length, 2);
    assert.equal(result.payload.output, "opaque provider text");
  }
});

test("question enrichment handles missing results, ignores permissions/pending and never matches display names", async () => {
  assert.ok(fs.existsSync(helperPath), "durable canonical question enrichment is missing");
  const { withCanonicalQuestionActivity } = await import("../src/domains/conversation/native-live-question-activity.js");
  const resolution = { kind: "question", status: "resolved", request: { tool_use_id: "q1" }, response: { decision: "cancel", message: "Cancelled" } };
  const enriched = withCanonicalQuestionActivity([use], [resolution]);
  assert.deepEqual(enriched[0]?.payload?.question_activity, { kind: "question", resolution: "cancelled", message: "Cancelled" });
  const normal = { ...use, payload: { ...use.payload, tool_name: "Read", display_name: "AskUserQuestion" } };
  assert.deepEqual(withCanonicalQuestionActivity([normal, result], [resolution]), [normal, result]);
  for (const ignored of [{ ...resolution, kind: "permission" }, { ...resolution, status: "pending" }, { ...resolution, request: { toolUseId: "another" } }]) {
    assert.deepEqual(withCanonicalQuestionActivity([use, result], [ignored]), [use, result]);
  }
});
