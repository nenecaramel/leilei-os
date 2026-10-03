import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeClaudeEvents,
} from "../tools/claude-bridge/src/normalized-events.mjs";
import {
  canonicalizeNativeLiveEvents,
} from "../src/domains/conversation/native-live-conversation-orchestrator.js";

const base = {
  logicalConversationId: "conversation-1",
  mode: "new",
  parentProviderSessionId: null,
};

test("bounded binary tool_result retains durable Activity backing without raw bytes", () => {
  const binary = Buffer.alloc(75_000, 5).toString("base64");
  const events = normalizeClaudeEvents(
    [{
      type: "user",
      session_id: "session-1",
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: "toolu-binary",
          is_error: false,
          content: [{
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: binary,
            },
          }, {
            type: "resource_link",
            uri: "file:///tmp/image.png",
            name: "image.png",
            mimeType: "image/png",
          }],
        }],
      },
    }],
    base,
  );

  const serializedRuntime = JSON.stringify(events);
  assert.equal(
    serializedRuntime.includes(binary.slice(0, 64)),
    false,
  );

  const canonical = canonicalizeNativeLiveEvents(events);
  assert.equal(canonical.error, null);
  assert.deepEqual(canonical.blocks.map(block => block.kind), ["tool_result"]);
  assert.equal(JSON.stringify(canonical.blocks).includes(binary.slice(0, 64)), false);
  assert.deepEqual(canonical.blocks[0]?.payload, events.find(event => event.type === "tool_result")?.payload);
  const result = events.find(event => event.type === 'tool_result');
  assert.equal(result?.payload?.tool_use_id, 'toolu-binary');
  assert.equal(result?.payload?.output_binary_omitted, true);
  assert.equal(result?.payload?.output[1]?.uri, 'file:///tmp/image.png');
});
