import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeNativeLiveEvents,
} from "../src/domains/conversation/native-live-conversation-orchestrator.js";

test("execution with parent provenance remains Activity", () => {
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
  assert.deepEqual(result.blocks, []);

});


test("hidden task lineage does not enter canonical content", () => {
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
  assert.deepEqual(result.blocks, []);



});


test("ambient task lineage does not enter canonical content", () => {
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
  assert.deepEqual(result.blocks, []);



});
