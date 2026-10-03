import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeNativeLiveEvents,
} from "../src/domains/conversation/native-live-conversation-orchestrator.js";

test("foreground MCP resource candidates remain runtime references", () => {
  const resourceLinks = [{
    type: "resource_link",
    uri: "mcp://exports/report.pdf",
    name: "report.pdf",
    title: "Report",
    description: "Generated report",
    mime_type: "application/pdf",
    size: 12345,
    annotations: {
      audience: ["user"],
    },
    metadata: {
      source: "mcp",
    },
  }];

  const canonical = canonicalizeNativeLiveEvents([
    {
      type: "tool_result",
      provider_session_id: "provider-1",
      payload: {
        tool_use_id: "tool-1",
        output: "Generated report",
        is_error: false,
        resource_links: resourceLinks,
      },
    },
  ]);

  assert.equal(canonical.error, null);
  assert.deepEqual(canonical.blocks, []);
});

test("background task resource links remain runtime provenance and do not become chat content", () => {
  const canonical = canonicalizeNativeLiveEvents([
    {
      type: "task",
      provider_session_id: "provider-1",
      payload: {
        phase: "notification",
        task_id: "task-1",
        tool_use_id: "tool-1",
        resource_links: [{
          type: "resource_link",
          uri: "mcp://exports/report.pdf",
          name: "report.pdf",
        }],
      },
    },
  ]);

  assert.equal(canonical.error, null);
  assert.deepEqual(canonical.blocks, []);
});
