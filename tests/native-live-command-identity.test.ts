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

test("provider command lifecycle and user-message attribution stay runtime-only", () => {
  const userId =
    "44444444-4444-4444-8444-444444444444";
  const events = normalizeClaudeEvents(
    [
      {
        type: "command_lifecycle",
        session_id: "provider-1",
        command_uuid: userId,
        state: "started",
        uuid: "lifecycle-started",
      },
      {
        type: "assistant",
        session_id: "provider-1",
        user_message_uuid: userId,
        user_message_uuids: [userId],
        message: {
          content: [{
            type: "text",
            text: "READY",
          }],
        },
      },
    ],
    base,
  );

  assert.deepEqual(
    events.map((event) => event.type),
    ["runtime", "runtime", "text"],
  );

  const canonical = canonicalizeNativeLiveEvents(events);
  assert.equal(canonical.error, null);
  assert.equal(canonical.blocks.length, 1);
  assert.equal(canonical.blocks[0]?.kind, "text");
  assert.equal(canonical.blocks[0]?.text, "READY");
  assert.equal(
    JSON.stringify(canonical).includes("command_lifecycle"),
    false,
  );
  assert.equal(
    JSON.stringify(canonical).includes("user_message_uuid"),
    false,
  );
});
