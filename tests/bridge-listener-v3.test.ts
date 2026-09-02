import assert from "node:assert/strict";
import test from "node:test";
import {
  BRIDGE_RESOURCE_URI,
  composeBridgeDispatchContext,
  createBridgeListenerHtml,
  getSentinelWakeRoutingMetadata,
} from "../src/mcp/tools/bridge-listener/listener-resource.js";
import { createSentinelWakeModelContext } from "../src/domains/bridge/bridge-service.js";

const event = {
  id: "11111111-1111-4111-8111-111111111111",
  modelContext: "Sentinel wake context",
  kind: "wake" as const,
  source: "leileios_sentinel" as const,
  wakeId: "22222222-2222-4222-8222-222222222222",
  sentinelId: "33333333-3333-4333-8333-333333333333",
  controlRevision: 4,
  scheduledFor: new Date("2026-08-30T00:00:00.000Z"),
  dispatchStartedAt: null,
  reservedAt: new Date("2026-08-30T00:00:01.000Z"),
  wakeMetadata: {
    wakeId: "22222222-2222-4222-8222-222222222222",
    sentinelId: "33333333-3333-4333-8333-333333333333",
    controlRevision: 4,
    scheduledFor: "2026-08-30T00:00:00.000Z",
  },
};

test("Bridge resource v3 carries neutral Sentinel routing metadata", () => {
  assert.equal(BRIDGE_RESOURCE_URI, "ui://leileios/message-bridge/v3");
  const context = composeBridgeDispatchContext(event);
  assert.match(context, /eventId=11111111-1111-4111-8111-111111111111/);
  assert.match(context, /wakeId=22222222-2222-4222-8222-222222222222/);
  assert.match(context, /sentinelId=33333333-3333-4333-8333-333333333333/);
  assert.match(context, /controlRevision=4/);
  assert.match(context, /scheduledFor=2026-08-30T00:00:00\.000Z/);
  assert.doesNotMatch(context, /bridge_event_claim|bridge_event_complete|sentinel_get_state|complete_sentinel_wake/i);
  assert.doesNotMatch(context, /claim this|call\s+\w+|finalize with/i);
  assert.doesNotMatch(context, /policyPrompt|contextCapsule|wakeContextCapsule/);
  assert.deepEqual(getSentinelWakeRoutingMetadata({
    id: event.id,
    kind: event.kind,
    source: event.source,
    modelContext: `wakeId=${event.wakeId}; sentinelId=${event.sentinelId}; controlRevision=${event.controlRevision}; scheduledFor=${event.scheduledFor.toISOString()}.`,
    reservedAt: event.reservedAt,
    dispatchStartedAt: event.dispatchStartedAt,
  }), {
    eventId: event.id,
    wakeId: event.wakeId,
    sentinelId: event.sentinelId,
    controlRevision: event.controlRevision,
    scheduledFor: event.scheduledFor.toISOString(),
    reservedAt: event.reservedAt.toISOString(),
    dispatchStartedAt: null,
  });

  const html = createBridgeListenerHtml();
  for (const field of ["eventId", "wakeId", "sentinelId", "controlRevision", "scheduledFor", "dispatchStartedAt"]) {
    assert.match(html, new RegExp(field));
  }
  assert.doesNotMatch(html, /policyPrompt|wakeContextCapsule/);
  assert.doesNotMatch(html, /bridge_event_claim|bridge_event_complete|sentinel_get_state|complete_sentinel_wake/i);
});

test("Bridge v3 keeps ordinary routing metadata factual", () => {
  const ordinary = composeBridgeDispatchContext({
    id: event.id,
    modelContext: "chat",
  });
  assert.match(ordinary, /LeileiOS Bridge event metadata: eventId=11111111-1111-4111-8111-111111111111/);
  assert.doesNotMatch(ordinary, /bridge_event_claim|bridge_event_complete/i);
  assert.doesNotMatch(ordinary, /sentinel_get_state/);
});

test("Sentinel wake model context is factual and non-imperative", () => {
  const context = createSentinelWakeModelContext({
    eventId: event.id,
    wakeId: event.wakeId,
    sentinelId: event.sentinelId,
    controlRevision: event.controlRevision,
    scheduledFor: event.scheduledFor,
  });
  assert.match(context, /wakeId=22222222-2222-4222-8222-222222222222/);
  assert.match(context, /sentinelId=33333333-3333-4333-8333-333333333333/);
  assert.match(context, /scheduledFor=2026-08-30T00:00:00\.000Z/);
  assert.doesNotMatch(context, /bridge_event_claim|bridge_event_complete|sentinel_get_state|complete_sentinel_wake/i);
  assert.doesNotMatch(context, /claim this wake first|call\s+\w+|finalize with/i);
});
