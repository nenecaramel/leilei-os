import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveMacHttpRelayClient,
} from "../src/domains/bridge/native-live-mac-http-relay-client.js";
import type {
  NativeLiveRuntimeExecutionResult,
} from "../src/domains/bridge/native-live-runtime-protocol.js";

const listenerId = "11111111-1111-4111-8111-111111111111";
const prepareId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const conversationId = "44444444-4444-4444-8444-444444444444";
const userMessageId = "55555555-5555-4555-8555-555555555555";

function command() {
  return {
    protocol_version: 1,
    dispatch_target: "claude_code",
    prepare_id: prepareId,
    request_id: requestId,
    operation: "send",
    conversation_id: conversationId,
    canonical_user_message_id: userMessageId,
    runtime_mode: "new",
    parent_provider_session_id: null,
    prompt: "hello",
  };
}

test("Mac HTTP relay client maps daemon calls onto authenticated internal endpoints", async () => {
  const calls: Array<{
    url: string;
    init: RequestInit | undefined;
  }> = [];
  const responses = [
    { success: true, data: { state: "acquired" } },
    {
      success: true,
      data: {
        reservationId: prepareId,
        command: command(),
      },
    },
    { success: true, data: { accepted: true } },
    { success: true, data: { accepted: true } },
    { success: true, data: { accepted: true } },
    { success: true, data: { accepted: true } },
  ];

  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const payload = responses.shift();
    if (!payload) throw new Error("unexpected fetch");
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const client = new NativeLiveMacHttpRelayClient(
    "https://relay.example/",
    "secret-token",
    fakeFetch,
  );

  assert.equal(
    await client.renewLease({
      listenerInstanceId: listenerId,
      dispatchTarget: "claude_code",
    }),
    "acquired",
  );

  const reservation = await client.reserveNext({
    listenerInstanceId: listenerId,
    dispatchTarget: "claude_code",
  });
  assert.equal(reservation?.reservationId, prepareId);
  assert.deepEqual(reservation?.command, command());

  await client.markExecutionStarted({
    listenerInstanceId: listenerId,
    reservationId: prepareId,
  });

  const result: NativeLiveRuntimeExecutionResult = {
    protocol_version: 1,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "failure",
    error_code: "CLAUDE_PROCESS_FAILED",
  };
  await client.submitResult({
    listenerInstanceId: listenerId,
    reservationId: prepareId,
    result,
  });
  await client.markResultDeliveryUnknown({
    listenerInstanceId: listenerId,
    reservationId: prepareId,
  });
  await client.rejectReservation({
    listenerInstanceId: listenerId,
    reservationId: prepareId,
    code: "INVALID_COMMAND",
  });

  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://relay.example/internal/native-live-relay/lease/renew",
      "https://relay.example/internal/native-live-relay/reserve",
      `https://relay.example/internal/native-live-relay/reservations/${prepareId}/execution-started`,
      `https://relay.example/internal/native-live-relay/reservations/${prepareId}/result`,
      `https://relay.example/internal/native-live-relay/reservations/${prepareId}/delivery-unknown`,
      `https://relay.example/internal/native-live-relay/reservations/${prepareId}/reject`,
    ],
  );
  for (const call of calls) {
    const headers = call.init?.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer secret-token");
  }
});

test("Mac HTTP relay client transports semantic candidate snapshots and score callbacks", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const responses = [
    {
      success: true,
      data: {
        reservationId: prepareId,
        query: "solo travel independent",
        candidates: [{
          stateId: "state-travel",
          kind: "memory",
          text: "独自旅行让我觉得自己可以照顾好自己",
        }],
      },
    },
    { success: true, data: { accepted: true } },
    { success: true, data: { accepted: true } },
  ];

  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const client = new NativeLiveMacHttpRelayClient(
    "https://relay.example",
    "secret-token",
    fakeFetch,
  );
  const reservation = await client.reserveSemanticScoring({
    listenerInstanceId: listenerId,
    dispatchTarget: "claude_code",
  });
  assert.deepEqual(reservation, {
    reservationId: prepareId,
    query: "solo travel independent",
    candidates: [{
      stateId: "state-travel",
      kind: "memory",
      text: "独自旅行让我觉得自己可以照顾好自己",
    }],
  });

  await client.submitSemanticScores({
    listenerInstanceId: listenerId,
    reservationId: prepareId,
    scores: { "state-travel": 0.93 },
  });
  await client.submitSemanticFallback({
    listenerInstanceId: listenerId,
    reservationId: prepareId,
    code: "E5_SCORING_FAILED",
  });

  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://relay.example/internal/native-live-relay/semantic/reserve",
      `https://relay.example/internal/native-live-relay/semantic/reservations/${prepareId}/scores`,
      `https://relay.example/internal/native-live-relay/semantic/reservations/${prepareId}/fallback`,
    ],
  );
  assert.deepEqual(calls[1]?.body, {
    listener_instance_id: listenerId,
    scores: { "state-travel": 0.93 },
  });
});

test("Mac HTTP relay client treats non-success responses as transport failures without leaking server details", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        success: false,
        error: { code: "RESERVATION_CONFLICT", message: "private" },
      }),
      { status: 409, headers: { "content-type": "application/json" } },
    );

  const client = new NativeLiveMacHttpRelayClient(
    "https://relay.example",
    "secret-token",
    fakeFetch,
  );

  await assert.rejects(
    () =>
      client.markExecutionStarted({
        listenerInstanceId: listenerId,
        reservationId: prepareId,
      }),
    /Native live relay request failed/u,
  );
});
