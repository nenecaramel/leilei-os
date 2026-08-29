import assert from "node:assert/strict";
import test from "node:test";
import {
  BRIDGE_RESOURCE_URI,
  composeBridgeDispatchContext,
  createBridgeListenerHtml,
} from "../src/mcp/tools/bridge-listener/listener-resource.js";

const event = {
  id: "11111111-1111-4111-8111-111111111111",
  modelContext: "Sentinel wake context",
  kind: "wake" as const,
  wakeId: "22222222-2222-4222-8222-222222222222",
  sentinelId: "33333333-3333-4333-8333-333333333333",
  controlRevision: 4,
  scheduledFor: new Date("2026-08-30T00:00:00.000Z"),
  dispatchStartedAt: null,
  reservedAt: new Date("2026-08-30T00:00:01.000Z"),
};

test("Bridge resource v3 carries bounded Sentinel routing metadata and model order", () => {
  assert.equal(BRIDGE_RESOURCE_URI, "ui://leileios/message-bridge/v3");
  const context = composeBridgeDispatchContext(event);
  assert.match(context, /bridge_event_claim/);
  assert.match(context, /sentinel_get_state/);
  assert.match(context, /complete_sentinel_wake/);
  assert.match(context, /quiet/);
  assert.ok(context.indexOf("bridge_event_claim") < context.indexOf("sentinel_get_state"));
  assert.ok(context.indexOf("sentinel_get_state") < context.indexOf("complete_sentinel_wake"));
  assert.doesNotMatch(context, /policyPrompt|contextCapsule|wakeContextCapsule/);

  const html = createBridgeListenerHtml();
  for (const field of ["eventId", "wakeId", "sentinelId", "controlRevision", "scheduledFor", "dispatchStartedAt"]) {
    assert.match(html, new RegExp(field));
  }
  assert.doesNotMatch(html, /policyPrompt|wakeContextCapsule|contextCapsule/);
  assert.match(html, /bridge_event_claim/);
  assert.match(html, /sentinel_get_state/);
  assert.match(html, /complete_sentinel_wake/);
});

test("Bridge v3 keeps ordinary chat completion instructions separate", () => {
  const ordinary = composeBridgeDispatchContext({
    id: event.id,
    modelContext: "chat",
  });
  assert.match(ordinary, /bridge_event_claim/);
  assert.match(ordinary, /bridge_event_complete/);
  assert.doesNotMatch(ordinary, /sentinel_get_state/);
});
