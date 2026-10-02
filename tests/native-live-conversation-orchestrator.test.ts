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
