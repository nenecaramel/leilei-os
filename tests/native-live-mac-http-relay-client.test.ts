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
    execution_selection: null,
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
    { success: true, data: { outcome: "created" } },
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

  await client.appendRuntimeEvents({
    listenerInstanceId: listenerId,
    reservationId: prepareId,
    events: [{
      sequence: 1,
      event: {
        type: "partial_text",
        payload: {
          delta: "hel",
          accumulated_length: 3,
        },
      },
    }, {
      sequence: 2,
      event: {
        type: "result",
        payload: {
          status: "success",
          final_text: "hello",
        },
      },
    }],
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
      `https://relay.example/internal/native-live-relay/reservations/${prepareId}/events/batch`,
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

test("Mac HTTP relay client waits for event-driven work without exposing user identity", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(JSON.stringify({
      success: true,
      data: {
        outcome: "ready",
        version: 3,
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const client = new NativeLiveMacHttpRelayClient(
    "https://relay.example",
    "secret-token",
    fakeFetch,
  );
  const controller = new AbortController();
  assert.equal(
    await client.waitForWork({
      listenerInstanceId: listenerId,
      dispatchTarget: "claude_code",
      signal: controller.signal,
    }),
    "ready",
  );
  assert.deepEqual(calls, [{
    url:
      "https://relay.example/internal/native-live-relay/work/wait",
    body: {
      listener_instance_id: listenerId,
      dispatch_target: "claude_code",
    },
  }]);
  assert.equal(
    JSON.stringify(calls[0]?.body).includes("user"),
    false,
  );
});

test("Mac HTTP relay client waits for active-turn controls without polling", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(JSON.stringify({
      success: true,
      data: {
        outcome: "reserved",
        control: {
          controlId: "77777777-7777-4777-8777-777777777777",
          kind: "mid_turn_input",
          payload: { text: "steer" },
        },
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const client = new NativeLiveMacHttpRelayClient(
    "https://relay.example",
    "secret-token",
    fakeFetch,
  );
  const controller = new AbortController();
  const control = await client.waitRuntimeControl({
    listenerInstanceId: listenerId,
    reservationId: prepareId,
    signal: controller.signal,
  });

  assert.deepEqual(control, {
    controlId: "77777777-7777-4777-8777-777777777777",
    kind: "mid_turn_input",
    payload: { text: "steer" },
  });
  assert.deepEqual(calls, [{
    url:
      `https://relay.example/internal/native-live-relay/reservations/${prepareId}/controls/wait`,
    body: {
      listener_instance_id: listenerId,
    },
  }]);
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


test("Mac HTTP relay client transports background model reservations without user identity", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const responses = [
    {
      success: true,
      data: {
        reservationId: prepareId,
        command: {
          protocol_version: 1,
          task_id: prepareId,
          task_kind: "topic_resurface_retention",
          prompt_contract_version: "topic-resurface-retention-v1",
          prompt: "retain?",
        },
      },
    },
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
  const reservation = await client.reserveBackgroundModel({
    listenerInstanceId: listenerId,
    dispatchTarget: "claude_code",
  });
  assert.equal(reservation?.reservationId, prepareId);
  assert.equal("userId" in reservation!.command, false);

  await client.submitBackgroundModelResult({
    listenerInstanceId: listenerId,
    reservationId: prepareId,
    result: {
      protocol_version: 1,
      task_id: prepareId,
      task_kind: "topic_resurface_retention",
      status: "success",
      final_text: '{"decision":"discard"}',
    },
  });

  assert.deepEqual(calls.map((call) => call.url), [
    "https://relay.example/internal/native-live-relay/background-model/reserve",
    `https://relay.example/internal/native-live-relay/background-model/reservations/${prepareId}/result`,
  ]);
  assert.deepEqual(calls[0]?.body, {
    listener_instance_id: listenerId,
    dispatch_target: "claude_code",
  });
});


test("Mac HTTP relay client offers one scoped companion background opportunity", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(JSON.stringify({
      success: true,
      data: {
        reason: "dirty",
        maintenanceKinds: ["decay"],
        effectDeliveryScheduled: true,
        proactivityScheduled: false,
        topicResurfaceOffered: true,
        failures: [],
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const client = new NativeLiveMacHttpRelayClient(
    "https://relay.example",
    "secret-token",
    fakeFetch,
  );
  const result = await client.offerCompanionBackgroundOpportunity({
    listenerInstanceId: listenerId,
    dispatchTarget: "claude_code",
    reason: "dirty",
  });

  assert.deepEqual(result, {
    reason: "dirty",
    maintenanceKinds: ["decay"],
    effectDeliveryScheduled: true,
    proactivityScheduled: false,
    topicResurfaceOffered: true,
    failures: [],
  });
  assert.deepEqual(calls, [{
    url:
      "https://relay.example/internal/native-live-relay/background/opportunity",
    body: {
      listener_instance_id: listenerId,
      dispatch_target: "claude_code",
      reason: "dirty",
    },
  }]);
  assert.equal(
    JSON.stringify(calls[0]?.body).includes("user"),
    false,
  );
});

test("Mac HTTP relay client offers Topic resurface opportunity without user identity", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(JSON.stringify({
      success: true,
      data: {
        outcome: "not_due",
        lastAttemptAt: "2026-09-23T04:00:00.000Z",
        nextEligibleAt: "2026-09-23T04:01:00.000Z",
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const client = new NativeLiveMacHttpRelayClient(
    "https://relay.example",
    "secret-token",
    fakeFetch,
  );
  const result = await client.offerTopicResurfaceOpportunity({
    listenerInstanceId: listenerId,
    dispatchTarget: "claude_code",
  });

  assert.deepEqual(result, {
    outcome: "not_due",
    lastAttemptAt: "2026-09-23T04:00:00.000Z",
    nextEligibleAt: "2026-09-23T04:01:00.000Z",
  });
  assert.deepEqual(calls, [{
    url:
      "https://relay.example/internal/native-live-relay/background-model/topic-resurface/opportunity",
    body: {
      listener_instance_id: listenerId,
      dispatch_target: "claude_code",
    },
  }]);
  assert.equal(
    JSON.stringify(calls[0]?.body).includes("user"),
    false,
  );
});


test("Mac HTTP relay client round-trips a durable permission interaction", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  let interactionId: string | null = null;
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });

    if (url.endsWith("/interactions")) {
      interactionId = body.interaction_id;
      return new Response(JSON.stringify({
        success: true,
        data: {
          outcome: "created",
          interaction: {
            interactionId,
            prepareId,
            kind: "permission",
            request: body.request,
            status: "pending",
            response: null,
          },
        },
      }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      data: {
        outcome: "terminal",
        interaction: {
          interactionId,
          prepareId,
          kind: "permission",
          request: {
            toolName: "Write",
            input: { file_path: "/tmp/a" },
          },
          status: "resolved",
          response: {
            decision: "allow",
            updatedInput: {
              file_path: "/allowed/a",
            },
          },
        },
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const client = new NativeLiveMacHttpRelayClient(
    "https://relay.example",
    "secret-token",
    fakeFetch,
  );
  const decision = await client.requestRuntimeInteraction({
    listenerInstanceId: listenerId,
    reservationId: prepareId,
    kind: "permission",
    request: {
      toolName: "Write",
      input: { file_path: "/tmp/a" },
    },
    signal: null,
  });

  assert.deepEqual(decision, {
    decision: "allow",
    updatedInput: {
      file_path: "/allowed/a",
    },
  });
  assert.equal(calls.length, 2);
  assert.match(
    calls[0]!.url,
    new RegExp(
      `/reservations/${prepareId}/interactions$`,
      "u",
    ),
  );
  assert.match(
    calls[1]!.url,
    new RegExp(
      `/reservations/${prepareId}/interactions/[0-9a-f-]+/wait$`,
      "u",
    ),
  );
  assert.equal(
    (calls[0]!.body as { kind: string }).kind,
    "permission",
  );
});


test("Mac HTTP relay client reserves and receipts provider session cleanup", async () => {
  const cleanupId = "77777777-7777-4777-8777-777777777777";
  const calls: Array<{ url: string; body: unknown }> = [];
  const responses = [
    {
      success: true,
      data: {
        reservationId: cleanupId,
        providerSessionId: "provider-old-fork",
      },
    },
    {
      success: true,
      data: { outcome: "applied" },
    },
  ];
  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const payload = responses.shift();
    if (!payload) throw new Error("unexpected fetch");
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = new NativeLiveMacHttpRelayClient(
    "https://relay.example",
    "secret-token",
    fakeFetch,
  );

  assert.deepEqual(
    await client.reserveProviderSessionCleanup({
      listenerInstanceId: listenerId,
      dispatchTarget: "claude_code",
    }),
    {
      reservationId: cleanupId,
      providerSessionId: "provider-old-fork",
    },
  );
  await client.submitProviderSessionCleanupResult({
    listenerInstanceId: listenerId,
    reservationId: cleanupId,
    outcome: { status: "success" },
  });

  assert.deepEqual(calls, [
    {
      url:
        "https://relay.example/internal/native-live-relay/provider-session-cleanup/reserve",
      body: {
        listener_instance_id: listenerId,
        dispatch_target: "claude_code",
      },
    },
    {
      url:
        `https://relay.example/internal/native-live-relay/provider-session-cleanup/reservations/${cleanupId}/result`,
      body: {
        listener_instance_id: listenerId,
        status: "success",
      },
    },
  ]);
});


test("Mac HTTP relay client transports independent Mind semantic grouping reservations", async () => {
  const groupingId = "99999999-9999-4999-8999-999999999999";
  const stateId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const calls: Array<{ url: string; body: unknown }> = [];
  const responses = [
    {
      success: true,
      data: {
        reservationId: groupingId,
        query: "complete the backend cleanup",
        candidates: [{
          stateId,
          kind: "drive",
          text: "finish the runtime cleanup",
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
  assert.deepEqual(
    await client.reserveMindSemanticGrouping({
      listenerInstanceId: listenerId,
      dispatchTarget: "claude_code",
    }),
    {
      reservationId: groupingId,
      query: "complete the backend cleanup",
      candidates: [{
        stateId,
        kind: "drive",
        text: "finish the runtime cleanup",
      }],
    },
  );
  await client.submitMindSemanticGroupingScores({
    listenerInstanceId: listenerId,
    reservationId: groupingId,
    scores: { [stateId]: 0.93 },
  });
  await client.submitMindSemanticGroupingFallback({
    listenerInstanceId: listenerId,
    reservationId: groupingId,
    code: "E5_SCORING_FAILED",
  });

  assert.deepEqual(calls.map((call) => call.url), [
    "https://relay.example/internal/native-live-relay/mind-semantic-grouping/reserve",
    `https://relay.example/internal/native-live-relay/mind-semantic-grouping/reservations/${groupingId}/scores`,
    `https://relay.example/internal/native-live-relay/mind-semantic-grouping/reservations/${groupingId}/fallback`,
  ]);
  assert.deepEqual(calls[0]?.body, {
    listener_instance_id: listenerId,
    dispatch_target: "claude_code",
  });
});
