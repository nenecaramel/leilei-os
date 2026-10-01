import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveRuntimeEventService,
} from "../src/domains/bridge/native-live-runtime-event-stream.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const LISTENER_ID = "00000000-0000-4000-8000-000000000098";
const RESERVATION_ID = "00000000-0000-4000-8000-000000000097";

test("runtime event service projects Claude account usage after accepted event delivery", async () => {
  const observed: unknown[] = [];
  const repository = {
    async appendBatch() {
      return { created: 1, idempotent: 0 };
    },
  };
  const usageWriter = {
    async observeRuntimeEvents(input: unknown) {
      observed.push(input);
    },
  };
  const service = new NativeLiveRuntimeEventService(
    repository as never,
    usageWriter as never,
  );
  const event = {
    type: "runtime" as const,
    provider_session_id: "provider-1",
    payload: {
      kind: "claude_account_usage",
      provider: "claude_code",
      windows: [{
        kind: "five_hour",
        utilization: 0.14,
        resets_at: "2026-09-01T17:40:00.000Z",
      }],
      overage: null,
    },
  };

  const outcome = await service.appendBatch({
    userId: USER_ID,
    listenerInstanceId: LISTENER_ID,
    reservationId: RESERVATION_ID,
    events: [{ sequence: 1, event }],
  });

  assert.deepEqual(outcome, { created: 1, idempotent: 0 });
  assert.deepEqual(observed, [{
    userId: USER_ID,
    events: [{ sequence: 1, event }],
  }]);
});

test("single-event append also projects Claude account usage", async () => {
  const observed: unknown[] = [];
  const repository = {
    async append() {
      return "created" as const;
    },
  };
  const usageWriter = {
    async observeRuntimeEvents(input: unknown) {
      observed.push(input);
    },
  };
  const service = new NativeLiveRuntimeEventService(
    repository as never,
    usageWriter as never,
  );
  const event = {
    type: "runtime" as const,
    payload: {
      kind: "claude_account_usage",
      provider: "claude_code",
      windows: [],
      overage: null,
    },
  };

  const outcome = await service.append({
    userId: USER_ID,
    listenerInstanceId: LISTENER_ID,
    reservationId: RESERVATION_ID,
    sequence: 1,
    event,
  });

  assert.equal(outcome, "created");
  assert.deepEqual(observed, [{
    userId: USER_ID,
    events: [{ sequence: 1, event }],
  }]);
});
