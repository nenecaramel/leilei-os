import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeClaudeEvents,
} from "../tools/claude-bridge/src/normalized-events.mjs";

test("root suite preserves Claude rate limit windows for account usage", () => {
  const events = normalizeClaudeEvents(
    [{
      type: "rate_limit_event",
      session_id: "provider-usage",
      rate_limit_info: {
        status: "allowed_warning",
        rateLimitType: "seven_day",
        surpassedThreshold: 0.75,
        unifiedWindows: {
          five_hour: {
            utilization: 0.14,
            resetsAt: 1788284400,
          },
          seven_day: {
            utilization: 0.79,
            resetsAt: 1788588000,
          },
        },
      },
    }],
    {
      logicalConversationId: "conversation-1",
      mode: "new",
      parentProviderSessionId: null,
    },
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "runtime");
  assert.deepEqual(events[0]?.payload, {
    kind: "claude_account_usage",
    provider: "claude_code",
    status: "allowed_warning",
    active_window: "seven_day",
    windows: [
      {
        kind: "five_hour",
        utilization: 0.14,
        resets_at: "2026-09-01T17:40:00.000Z",
      },
      {
        kind: "seven_day",
        utilization: 0.79,
        resets_at: "2026-09-05T06:00:00.000Z",
      },
    ],
    overage: null,
    surpassed_threshold: 0.75,
  });
});
