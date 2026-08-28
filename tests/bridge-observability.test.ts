import assert from "node:assert/strict";
import test from "node:test";
import { BridgeService } from "../src/domains/bridge/bridge-service.js";
import { createBridgeObserver, projectBridgeEvent } from "../src/observability/runtime-observers.js";

test("bridge observer projects safe lifecycle fields only", () => {
  const event = { name: "bridge_event_created" as const, eventId: "event-1", status: "pending" as const };
  const projected = projectBridgeEvent(event);
  assert.deepEqual(projected, { eventId: "event-1", status: "pending" });
  assert.doesNotMatch(JSON.stringify(projected), /visibleText|modelContext|idempotency|secret/);
});

test("bridge service emits lifecycle events without message payloads", async () => {
  const observed: unknown[] = [];
  const repository = {
    createEvent: async (_userId: string, input: never) => ({ outcome: "created", event: { id: input.id, status: "pending", createdAt: input.createdAt } }) as never,
  } as never;
  const service = new BridgeService(repository, { createId: () => "00000000-0000-4000-8000-000000000001", observe: (event) => observed.push(event) });
  await service.createPwaEvent("user-1", "private message", "bridge-observe-event-0001");
  assert.equal(observed.length, 1);
  assert.doesNotMatch(JSON.stringify(observed), /private message|model context|bridge-observe-event-0001/);
});
