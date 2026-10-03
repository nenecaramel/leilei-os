import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeNativeLiveEvents,
} from "../src/domains/conversation/native-live-conversation-orchestrator.js";

test("canonical tool blocks preserve provider parent provenance", () => {
  const result = canonicalizeNativeLiveEvents([
    {
      type: "tool_use",
      payload: {
        tool_use_id: "tool-child",
        tool_name: "Read",
        input: { path: "src/example.ts" },
        parent_tool_use_id: "tool-subagent",
        parent_agent_id: "agent-parent",
        display_name: "Read file",
      },
    },
  ]);

  assert.equal(result.error, null);
  assert.deepEqual(result.blocks, [
    {
      kind: "tool_use",
      rawType: "tool_use",
      payload: {
        tool_use_id: "tool-child",
        tool_name: "Read",
        input: { path: "src/example.ts" },
        parent_tool_use_id: "tool-subagent",
        parent_agent_id: "agent-parent",
      },
    },
  ]);
});


test("canonical tool blocks preserve hidden task lineage after runtime retention", () => {
  const result = canonicalizeNativeLiveEvents([
    {
      type: "task",
      payload: {
        phase: "started",
        task_id: "task-hidden",
        tool_use_id: "tool-hidden-root",
        hidden_from_transcript: true,
      },
    },
    {
      type: "tool_use",
      payload: {
        tool_use_id: "tool-hidden-root",
        tool_name: "Task",
        input: {},
      },
    },
    {
      type: "tool_use",
      payload: {
        tool_use_id: "tool-hidden-child",
        tool_name: "Read",
        input: { path: "src/private.ts" },
        parent_tool_use_id: "tool-hidden-root",
      },
    },
    {
      type: "tool_use",
      payload: {
        tool_use_id: "tool-visible",
        tool_name: "Read",
        input: { path: "src/public.ts" },
      },
    },
  ]);

  assert.equal(result.error, null);
  assert.equal(
    result.blocks[0]?.payload?.hidden_from_transcript,
    true,
  );
  assert.equal(
    result.blocks[1]?.payload?.hidden_from_transcript,
    true,
  );
  assert.equal(
    result.blocks[2]?.payload?.hidden_from_transcript,
    undefined,
  );
});


test("canonical tool blocks preserve ambient activity suppression lineage", () => {
  const result = canonicalizeNativeLiveEvents([
    {
      type: "task",
      payload: {
        phase: "started",
        task_id: "task-ambient",
        tool_use_id: "tool-ambient-root",
        ambient: true,
      },
    },
    {
      type: "tool_use",
      payload: {
        tool_use_id: "tool-ambient-root",
        tool_name: "Task",
        input: {},
      },
    },
    {
      type: "tool_use",
      payload: {
        tool_use_id: "tool-ambient-child",
        tool_name: "Read",
        input: { path: "src/housekeeping.ts" },
        parent_tool_use_id: "tool-ambient-root",
      },
    },
    {
      type: "tool_use",
      payload: {
        tool_use_id: "tool-visible",
        tool_name: "Read",
        input: { path: "src/user-visible.ts" },
      },
    },
  ]);

  assert.equal(result.error, null);
  assert.equal(
    result.blocks[0]?.payload?.hidden_from_activity,
    true,
  );
  assert.equal(
    result.blocks[1]?.payload?.hidden_from_activity,
    true,
  );
  assert.equal(
    result.blocks[2]?.payload?.hidden_from_activity,
    undefined,
  );
});

test("ordinary tool use and result retain durable Activity evidence without Chat opt-in", () => {
  const use = { tool_use_id: "read1", tool_name: "Read", input: { path: "src/example.ts" }, parent_tool_use_id: "task1", parent_agent_id: "agent1", provenance: { provider: "claude_code", raw_type: "tool_use", tool_use_id: "read1" } };
  const output = { tool_use_id: "read1", output: { text: "file contents" }, is_error: false, provenance: { provider: "claude_code", raw_type: "tool_result", tool_use_id: "read1" } };
  const result = canonicalizeNativeLiveEvents([
    { type: "tool_use", payload: { ...use, display_name: "Read file", server_display_name: "Provider", icon_url: "https://example.test/icon" } },
    { type: "tool_result", payload: output },
  ]);
  assert.equal(result.error, null);
  assert.deepEqual(result.blocks, [
    { kind: "tool_use", rawType: "tool_use", payload: use },
    { kind: "tool_result", rawType: "tool_result", payload: output },
  ]);
  assert.ok(result.blocks.every(block => !["text", "attachment", "artifact", "resource", "canonical_tool_result"].includes(block.kind)));
});
