import assert from "node:assert/strict";
import test from "node:test";
import { backgroundResult, parseBackgroundPrepareBody, parseBackgroundSubmitBody, NativeLiveBackgroundResultError } from "../src/domains/bridge/protocol/native-live-background-result.js";
import { createNativeLiveRelayInternalRouter } from "../src/web-api/native-live-relay-internal-router.js";
import { FakeRelayService, withServer, userId, listenerId, prepareId, requestId, conversationId } from "./helpers/native-live-http-relay-fixtures.js";
const receiptId = "77777777-7777-4777-8777-777777777777", generationId = "88888888-8888-4888-8888-888888888888", checkpoint = "99999999-9999-4999-8999-999999999999";
const prepare = { receipt_id: receiptId, listener_instance_id: listenerId, generation_id: generationId, parent_provider_checkpoint_id: checkpoint };
const result = { protocol_version: 4, prepare_id: prepareId, request_id: requestId, conversation_id: conversationId, status: "success", provider_session_id: "synthetic", provider_checkpoint_id: checkpoint, normalized_events: [{ type: "text", payload: { text: "synthetic" } }] };

test("background parser preserves exact receipt and source identities and snapshots result payload", () => {
  assert.deepEqual(parseBackgroundPrepareBody(prepare), { receiptId, listenerInstanceId: listenerId, generationId, parentProviderCheckpointId: checkpoint });
  const raw = structuredClone(result), parsed = parseBackgroundSubmitBody({ listener_instance_id: listenerId, generation_id: generationId, result: raw });
  raw.normalized_events[0]!.payload.text = "changed";
  assert.equal(parsed.result.status === "success" && parsed.result.normalized_events[0]!.payload?.text, "synthetic");
  assert.throws(() => parseBackgroundPrepareBody({ ...prepare, user_id: userId }));
  assert.throws(() => parseBackgroundSubmitBody({ listener_instance_id: listenerId, generation_id: "wrong", result }));
});

for (const [name, patch] of [
  ["missing checkpoint", { provider_checkpoint_id: undefined }],
  ["legacy protocol", { protocol_version: 3 }],
  ["foreign session event", { normalized_events: [{ type: "text", provider_session_id: "foreign", payload: { text: "synthetic" } }] }],
  ["unknown event type", { normalized_events: [{ type: "untrusted" }] }],
  ["malformed payload", { normalized_events: [{ type: "text", payload: [] }] }],
  ["too many events", { normalized_events: Array.from({ length: 1025 }, () => ({ type: "text", payload: { text: "synthetic" } })) }],
  ["oversized content", { normalized_events: [{ type: "text", payload: { text: "x".repeat(2 * 1024 * 1024) } }] }],
  ["normalized attachment event", { normalized_events: [{ type: "attachment", payload: { attachment_id: receiptId } }] }],
  ["unbound output attachment", { output_attachment_ids: [receiptId] }],
] as const) test(`background result rejects ${name}`, () => {
  assert.throws(() => backgroundResult({ ...result, ...patch }), { code: "INVALID_BACKGROUND_RESULT" });
});

test("HTTP background routes authenticate first and do not accept caller-supplied user identity", async () => {
  await withServer(app => { app.use("/relay", createNativeLiveRelayInternalRouter({ relayService: new FakeRelayService() })); }, async baseUrl => {
    const response = await fetch(`${baseUrl}/relay/reservations/${prepareId}/background-results/prepare`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(prepare) });
    assert.equal(response.status, 401);
  });
  await withServer(app => {
    app.use((request, _response, next) => { request.mcpUserId = userId; next(); });
    app.use("/relay", createNativeLiveRelayInternalRouter({ relayService: new FakeRelayService() }));
  }, async baseUrl => {
    for (const body of [{ ...prepare, user_id: userId }, { ...prepare, generation_id: "wrong" }]) {
      const response = await fetch(`${baseUrl}/relay/reservations/${prepareId}/background-results/prepare`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      assert.equal(response.status, 400);
    }
    const unsupported = await fetch(`${baseUrl}/relay/reservations/${prepareId}/background-results/prepare`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(prepare) });
    assert.equal(unsupported.status, 503);
  });
});

for (const [code, status] of [["BACKGROUND_NOT_FOUND", 404], ["BACKGROUND_CONFLICT", 409], ["BACKGROUND_UNAVAILABLE", 503]] as const) test(`HTTP ${code} exposes fixed code without internal failure details`, async () => {
  const service = Object.assign(new FakeRelayService(), { async submitBackgroundResult() { throw new NativeLiveBackgroundResultError(code); } });
  await withServer(app => {
    app.use((request, _response, next) => { request.mcpUserId = userId; next(); });
    app.use("/relay", createNativeLiveRelayInternalRouter({ relayService: service }));
  }, async baseUrl => {
    const response = await fetch(`${baseUrl}/relay/reservations/${prepareId}/background-results/${receiptId}/result`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ listener_instance_id: listenerId, generation_id: generationId, result }) });
    assert.equal(response.status, status); assert.deepEqual(await response.json(), { success: false, error: { code, message: "Native background result could not be accepted." } });
  });
});
