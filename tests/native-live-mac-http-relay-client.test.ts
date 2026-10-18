import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveMacHttpRelayClient,
} from "../src/domains/bridge/mac/native-live-mac-http-relay-client.js";
import type {
  NativeLiveRuntimeExecutionResult,
} from "../src/domains/bridge/protocol/native-live-runtime-protocol.js";

const listenerId = "11111111-1111-4111-8111-111111111111";
const prepareId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const conversationId = "44444444-4444-4444-8444-444444444444";
const userMessageId = "55555555-5555-4555-8555-555555555555";

function command() {
  return {
    protocol_version: 4,
    dispatch_target: "claude_code",
    prepare_id: prepareId,
    request_id: requestId,
    operation: "send",
    conversation_id: conversationId,
    canonical_user_message_id: userMessageId,
    runtime_mode: "new",
    parent_provider_session_id: null,
    expected_working_directory: null,
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
  assert.deepEqual(reservation?.command, {
    ...command(),
    attachments: [],
  });

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
    protocol_version: 4,
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

test("Mac HTTP relay client splits oversized runtime event batches on 413", async () => {
  const attempts: number[][] = [];
  const delivered: number[] = [];
  const fakeFetch: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      events?: Array<{ sequence: number }>;
    };
    const sequences = (body.events ?? []).map((event) => event.sequence);
    attempts.push(sequences);

    if (sequences.length > 1) {
      return new Response(JSON.stringify({
        success: false,
        error: { code: "PAYLOAD_TOO_LARGE" },
      }), {
        status: 413,
        headers: { "content-type": "application/json" },
      });
    }

    delivered.push(...sequences);
    return new Response(JSON.stringify({
      success: true,
      data: { outcome: { created: 1, idempotent: 0 } },
    }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };

  const client = new NativeLiveMacHttpRelayClient(
    "https://relay.example",
    "secret-token",
    fakeFetch,
  );

  await client.appendRuntimeEvents({
    listenerInstanceId: listenerId,
    reservationId: prepareId,
    events: [1, 2, 3, 4].map((sequence) => ({
      sequence,
      event: {
        type: "runtime" as const,
        payload: { kind: "fixture", sequence },
      },
    })),
  });

  assert.deepEqual(delivered, [1, 2, 3, 4]);
  assert.deepEqual(
    attempts.map((batch) => batch.length),
    [4, 2, 1, 1, 2, 1, 1],
  );
});

test("Mac HTTP relay client closes each relay connection so aborted waits cannot poison later requests", async () => {
  const calls: Array<RequestInit | undefined> = [];
  const fakeFetch: typeof fetch = async (_input, init) => {
    calls.push(init);
    return new Response(JSON.stringify({
      success: true,
      data: { state: "acquired" },
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
  await client.renewLease({
    listenerInstanceId: listenerId,
    dispatchTarget: "claude_code",
  });

  const headers = calls[0]?.headers as Record<string, string>;
  assert.equal(headers.connection, "close");
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
          task_kind: "proactivity_deliberate",
          prompt_contract_version: "proactivity-wake-deliberation-v1",
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
      task_kind: "proactivity_deliberate",
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

test("Mac HTTP relay client reads and fires silence wake without sending user identity", async () => {
  const epochId = userMessageId;
  const calls: Array<{ url: string; body: unknown }> = [];
  const schedule = {
    epochId,
    conversationId,
    postTurnDueAt: "2026-10-04T01:08:00.000Z",
    longIdleDueAt: "2026-10-04T02:40:00.000Z",
    postTurnConsumed: false,
    longIdleConsumed: false,
  };
  const responses = [
    { success: true, data: schedule },
    {
      success: true,
      data: {
        outcome: "queued",
        schedule: {
          ...schedule,
          postTurnConsumed: true,
        },
      },
    },
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

  assert.deepEqual(await client.readSilenceWakeSchedule(), schedule);
  assert.deepEqual(
    await client.fireSilenceWake({
      epochId,
      slot: "post_turn_idle",
    }),
    {
      outcome: "queued",
      schedule: {
        ...schedule,
        postTurnConsumed: true,
      },
    },
  );
  assert.deepEqual(calls, [
    {
      url:
        "https://relay.example/internal/native-live-relay/silence-wake/schedule",
      body: {},
    },
    {
      url:
        "https://relay.example/internal/native-live-relay/silence-wake/fire",
      body: {
        epoch_id: epochId,
        slot: "post_turn_idle",
      },
    },
  ]);
  assert.equal(JSON.stringify(calls).includes("user_id"), false);
  assert.equal(JSON.stringify(calls).includes("userId"), false);
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
      effectiveWorkingDirectory: null,
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

test("Mac HTTP relay wait retries transient deploy 502 and then continues", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "BAD_GATEWAY" },
        }),
        {
          status: 502,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return new Response(
      JSON.stringify({
        success: true,
        data: { outcome: "ready", version: 9 },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  const client = new NativeLiveMacHttpRelayClient(
    "https://relay.example",
    "secret-token",
    fakeFetch,
  );
  assert.equal(
    await client.waitForWork({
      listenerInstanceId: listenerId,
      dispatchTarget: "claude_code",
    }),
    "ready",
  );
  assert.equal(calls, 2);
});

test("Mac HTTP relay wait does not retry durable 409 conflicts", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "RESERVATION_CONFLICT" },
      }),
      {
        status: 409,
        headers: { "content-type": "application/json" },
      },
    );
  };

  const client = new NativeLiveMacHttpRelayClient(
    "https://relay.example",
    "secret-token",
    fakeFetch,
  );
  await assert.rejects(
    () => client.waitForWork({
      listenerInstanceId: listenerId,
      dispatchTarget: "claude_code",
    }),
    /Native live relay request failed/u,
  );
  assert.equal(calls, 1);
});

test("Mac HTTP relay terminal result retries transient 503 and then completes", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "TEMPORARILY_UNAVAILABLE" },
        }),
        {
          status: 503,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return new Response(
      JSON.stringify({
        success: true,
        data: { accepted: true, canonicalOutcome: "finalized_success" },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  const client = new NativeLiveMacHttpRelayClient(
    "https://relay.example",
    "secret-token",
    fakeFetch,
  );
  const result: NativeLiveRuntimeExecutionResult = {
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "failure",
    error_code: "CLAUDE_PROCESS_FAILED",
  };

  assert.deepEqual(
    await client.submitResult({
      listenerInstanceId: listenerId,
      reservationId: prepareId,
      result,
    }),
    { canonicalOutcome: "finalized_success" },
  );

  assert.equal(calls, 2);
});

test("Mac relay carries a verified cursor on stale Wake but rejects unproven acknowledgements",async()=>{
  const nativeCursor="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let outcome="wake_stale";
  const client=new NativeLiveMacHttpRelayClient("https://relay.example","secret-token",
    async()=>new Response(JSON.stringify({success:true,data:{
      accepted:true,canonicalOutcome:outcome,nativeResumeCheckpointId:nativeCursor,
    }}),{status:200,headers:{"content-type":"application/json"}}));
  const result:NativeLiveRuntimeExecutionResult={
    protocol_version:4,prepare_id:prepareId,request_id:requestId,
    conversation_id:conversationId,status:"failure",error_code:"CLAUDE_PROCESS_FAILED",
  };
  assert.deepEqual(await client.submitResult({
    listenerInstanceId:listenerId,reservationId:prepareId,result,
  }),{canonicalOutcome:"wake_stale",nativeResumeCheckpointId:nativeCursor});
  outcome="completed";
  await assert.rejects(()=>client.submitResult({
    listenerInstanceId:listenerId,reservationId:prepareId,result,
  }),/quiet acknowledgement is invalid/);
});

test("Mac HTTP relay terminal result bounds persistent transient failures", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: "NATIVE_LIVE_RELAY_UNAVAILABLE",
          message: "temporary",
        },
      }),
      {
        status: 503,
        headers: { "content-type": "application/json" },
      },
    );
  };

  const client = new NativeLiveMacHttpRelayClient(
    "https://relay.example",
    "secret-token",
    fakeFetch,
  );
  const result: NativeLiveRuntimeExecutionResult = {
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "failure",
    error_code: "CLAUDE_PROCESS_FAILED",
  };

  await assert.rejects(
    () => client.submitResult({
      listenerInstanceId: listenerId,
      reservationId: prepareId,
      result,
    }),
    /Native live relay request failed/u,
  );

  assert.equal(calls, 3);
});

test("Mac HTTP relay terminal result does not retry durable 409 conflicts", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "RESERVATION_CONFLICT" },
      }),
      {
        status: 409,
        headers: { "content-type": "application/json" },
      },
    );
  };

  const client = new NativeLiveMacHttpRelayClient(
    "https://relay.example",
    "secret-token",
    fakeFetch,
  );
  const result: NativeLiveRuntimeExecutionResult = {
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "failure",
    error_code: "CLAUDE_PROCESS_FAILED",
  };

  await assert.rejects(
    () => client.submitResult({
      listenerInstanceId: listenerId,
      reservationId: prepareId,
      result,
    }),
    /Native live relay request failed/u,
  );

  assert.equal(calls, 1);
});

test("Mac HTTP relay client creates and completes private output attachment uploads", async () => {
  const attachmentId =
    "66666666-6666-4666-8666-666666666666";
  const calls: Array<{
    url: string;
    body: unknown;
    authorization: string | null;
  }> = [];
  const descriptor = {
    attachmentId,
    filename: "report.pdf",
    mimeType: "application/pdf",
    sizeBytes: 321,
    sha256: "a".repeat(64),
    kind: "file" as const,
  };
  const responses = [
    {
      success: true,
      data: {
        attachment: descriptor,
        upload: {
          url: "https://bucket.example/native-live/upload",
          method: "PUT",
          headers: {
            "content-type": "application/pdf",
            "x-amz-meta-sha256": "a".repeat(64),
          },
          expiresAt: "2026-09-30T06:30:00.000Z",
        },
      },
    },
    {
      success: true,
      data: { attachment: descriptor },
    },
  ];

  const fakeFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : null,
      authorization: headers.get("authorization"),
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

  const slot = await client.createAttachmentUploadSlot({
    filename: "report.pdf",
    mimeType: "application/pdf",
    sizeBytes: 321,
    sha256: "a".repeat(64),
    kind: "file",
  });
  assert.deepEqual(slot, {
    attachment: descriptor,
    upload: {
      url: "https://bucket.example/native-live/upload",
      method: "PUT",
      headers: {
        "content-type": "application/pdf",
        "x-amz-meta-sha256": "a".repeat(64),
      },
    },
  });

  assert.deepEqual(
    await client.completeAttachmentUpload({ attachmentId }),
    descriptor,
  );

  assert.deepEqual(calls, [
    {
      url:
        "https://relay.example/internal/native-live-relay/attachments/upload-slots",
      body: {
        filename: "report.pdf",
        mime_type: "application/pdf",
        size_bytes: 321,
        sha256: "a".repeat(64),
        kind: "file",
      },
      authorization: "Bearer secret-token",
    },
    {
      url:
        `https://relay.example/internal/native-live-relay/attachments/${attachmentId}/complete`,
      body: {},
      authorization: "Bearer secret-token",
    },
  ]);
});

test("Mac HTTP relay runtime event batch retries a transient transport failure with the exact same payload", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  let attempt = 0;
  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    attempt += 1;
    if (attempt === 1) {
      throw new TypeError("fetch failed");
    }
    return new Response(JSON.stringify({
      success: true,
      data: { created: 0, idempotent: 2 },
    }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };

  const client = new NativeLiveMacHttpRelayClient(
    "https://relay.example",
    "secret-token",
    fakeFetch,
  );
  const events = [{
    sequence: 1,
    event: {
      type: "partial_text" as const,
      payload: { delta: "hel", accumulated_length: 3 },
    },
  }, {
    sequence: 2,
    event: {
      type: "result" as const,
      payload: { status: "success", final_text: "hello" },
    },
  }];

  await client.appendRuntimeEvents({
    listenerInstanceId: listenerId,
    reservationId: prepareId,
    events,
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(calls[1]?.body, {
    listener_instance_id: listenerId,
    events,
  });
});

test("Mac HTTP relay runtime event batch bounds transient retries", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      success: false,
      error: { code: "TEMPORARILY_UNAVAILABLE" },
    }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  };

  const client = new NativeLiveMacHttpRelayClient(
    "https://relay.example",
    "secret-token",
    fakeFetch,
  );

  await assert.rejects(
    () => client.appendRuntimeEvents({
      listenerInstanceId: listenerId,
      reservationId: prepareId,
      events: [{
        sequence: 1,
        event: {
          type: "result",
          payload: { status: "success", final_text: "hello" },
        },
      }],
    }),
    /Native live relay request failed/u,
  );
  assert.equal(calls, 3);
});

for (const stalledPhase of ["fetch", "body", "retry", "split"] as const) {
  test(`Mac HTTP relay runtime event upload bounds stalled ${stalledPhase} within one elapsed deadline`, async () => {
    let calls = 0;
    const signals: Array<AbortSignal | null | undefined> = [];
    let release!: () => void;
    const stalled = new Promise<void>((resolve) => { release = resolve; });
    const accepted = () => new Response(JSON.stringify({ success: true, data: { accepted: true } }));
    const client = new NativeLiveMacHttpRelayClient("https://relay.example", "synthetic-token", async (_url, init) => {
      calls += 1;
      signals.push(init?.signal);
      if ((stalledPhase === "retry" || stalledPhase === "split") && calls === 1) {
        // Spend part of the budget before retrying/splitting; a fresh deadline
        // for the next request would exceed the caller's elapsed deadline.
        await new Promise((resolve) => setTimeout(resolve, 1_100));
        return new Response(JSON.stringify({ success: false }), { status: stalledPhase === "split" ? 413 : 503 });
      }
      if (stalledPhase === "body") {
        const response = accepted();
        response.json = async () => { await stalled; return { success: true, data: {} }; };
        return response;
      }
      // Deliberately ignore abort: the application must release its caller even
      // if the transport/response reader does not cooperate with cancellation.
      await stalled;
      return accepted();
    });
    const startedAt = performance.now();
    const upload = client.appendRuntimeEvents({
      listenerInstanceId: listenerId,
      reservationId: prepareId,
      events: [1, 2].map((sequence) => ({ sequence, event: {
        type: "partial_text" as const, payload: { delta: "a", accumulated_length: sequence },
      } })),
    }).then(() => "accepted", (error: unknown) => error instanceof Error ? error.name : "unknown");
    let guard!: ReturnType<typeof setTimeout>;
    try {
      const outcome = await Promise.race([upload, new Promise<string>((resolve) => {
        guard = setTimeout(() => resolve("caller still blocked"), 2_800);
      })]);
      assert.equal(outcome, "TimeoutError");
      assert.ok(performance.now() - startedAt < 2_750, "one deadline covers all requests and response parsing");
      assert.equal(calls, stalledPhase === "retry" || stalledPhase === "split" ? 2 : 1);
      assert.ok(signals.every((signal) => signal instanceof AbortSignal && signal.aborted));
      assert.ok(signals.every((signal) => signal === signals[0]), "split/retry keeps the same budget");
    } finally {
      clearTimeout(guard);
      release();
      await upload;
    }
  });
}

test("Mac HTTP relay runtime event batch does not retry durable 409 conflicts", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      success: false,
      error: { code: "EVENT_CONFLICT" },
    }), {
      status: 409,
      headers: { "content-type": "application/json" },
    });
  };

  const client = new NativeLiveMacHttpRelayClient(
    "https://relay.example",
    "secret-token",
    fakeFetch,
  );

  await assert.rejects(
    () => client.appendRuntimeEvents({
      listenerInstanceId: listenerId,
      reservationId: prepareId,
      events: [{
        sequence: 1,
        event: {
          type: "result",
          payload: { status: "success", final_text: "hello" },
        },
      }],
    }),
    /Native live relay request failed/u,
  );
  assert.equal(calls, 1);
});

test("Mac HTTP relay client parses silence wake ignore reason", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(JSON.stringify({
      success: true,
      data: {
        outcome: "ignored",
        reason: "foreground_active",
        schedule: null,
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const client = new NativeLiveMacHttpRelayClient(
    "https://relay.example",
    "secret-token",
    fakeFetch,
  );

  assert.deepEqual(
    await client.fireSilenceWake({
      epochId: userMessageId,
      slot: "post_turn_idle",
    }),
    {
      outcome: "ignored",
      reason: "foreground_active",
      schedule: null,
    },
  );
});


test("malformed relay JSON retains safe status and route diagnostics without leaking body", async () => {
  const client = new NativeLiveMacHttpRelayClient("https://relay.example", "secret-token", async () =>
    new Response("private body secret-token", { status: 502, headers: { "content-type": "text/html" } }));
  await assert.rejects(() => client.reserveSemanticScoring({ listenerInstanceId: listenerId, dispatchTarget: "claude_code" }),
    (error: unknown) => {
      const record = error as Error & { httpStatus?: number; relayPath?: string };
      assert.equal(record.httpStatus, 502);
      assert.equal(record.relayPath, "/semantic/reserve");
      assert.equal(record.message.includes("private body"), false);
      assert.equal(record.message.includes("secret-token"), false);
      return true;
    });
});


test("relay distinguishes HTTP 200 body transport loss from invalid JSON without leaking the cause", async () => {
  for (const [responseErrorName, makeResponse] of [
    ["TypeError", () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"success":true,"data":'));
      controller.error(new TypeError("private transcript and token must not reach logs"));
    } }), { status: 200 })],
    ["SyntaxError", () => new Response('{"success":true,"data":', { status: 200 })],
  ] as const) {
    const client = new NativeLiveMacHttpRelayClient("https://relay.example", "secret-token", async () => makeResponse());
    await assert.rejects(() => client.reserveSemanticScoring({ listenerInstanceId: listenerId, dispatchTarget: "claude_code" }),
      (error: unknown) => {
        const record = error as Error & { httpStatus?: number; responseErrorName?: string; relayCode?: string };
        assert.equal(record.httpStatus, 200);
        assert.equal(record.responseErrorName, responseErrorName);
        assert.equal(record.relayCode, responseErrorName === "TypeError" ? "RELAY_RESPONSE_BODY_UNAVAILABLE" : "RELAY_RESPONSE_INVALID_JSON");
        assert.equal(record.message.includes("private transcript"), false);
        assert.equal(JSON.stringify(record).includes("secret-token"), false);
        return true;
      });
  }
});
test("execution admission sends only reservation identity metadata with a bounded abort signal", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = new NativeLiveMacHttpRelayClient("https://relay.example", "synthetic-token", async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ success: true, data: { admitted: true } }), { status: 200 });
  });
  const cmd = { ...command(), parent_provider_checkpoint_id: null };
  assert.equal(await client.checkExecutionAdmission({ listenerInstanceId: listenerId, command: cmd }), true);
  assert.ok(calls[0]!.url.endsWith(`/reservations/${prepareId}/execution-admission`));
  const body = JSON.parse(calls[0]!.init!.body as string);
  assert.equal(body.listener_instance_id, listenerId); assert.equal(body.request_id, requestId);
  assert.equal(body.parent_provider_checkpoint_id, null); assert.equal(body.prompt, undefined);
  assert.ok(calls[0]!.init!.signal instanceof AbortSignal);
});
for (const admitted of [false, "true", 1, null, undefined]) test(`execution admission never coerces ${String(admitted)} to approval`, async () => {
  const client = new NativeLiveMacHttpRelayClient("https://relay.example", "synthetic-token", async () => new Response(JSON.stringify({ success: true, data: { admitted } }), { status: 200 }));
  const call = client.checkExecutionAdmission({ listenerInstanceId: listenerId, command: { ...command(), parent_provider_checkpoint_id: null } });
  if (admitted === false) assert.equal(await call, false); else await assert.rejects(call, /admission/i);
});
test("execution admission timeout aborts one request without retry or cached approval", async () => {
  let calls = 0;
  const client = new NativeLiveMacHttpRelayClient("https://relay.example", "synthetic-token", async (_url, init) => {
    calls++;
    return new Promise((_resolve, reject) => {
      assert.ok(init?.signal);
      init.signal.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    });
  });
  // Keep the synthetic process alive; AbortSignal.timeout's timer is unref'ed.
  const keepAlive = setTimeout(() => {}, 10_000);
  try { await assert.rejects(client.checkExecutionAdmission({ listenerInstanceId: listenerId, command: { ...command(), parent_provider_checkpoint_id: null } }), error => error instanceof Error && error.name === "TimeoutError"); assert.equal(calls, 1); }
  finally { clearTimeout(keepAlive); }
});

test("separate task stopping is advertised only by the matching authenticated backend",async()=>{
 for(const [status,version,expected] of [[404,null,false],[200,0,false],[200,1,true]] as const){
  const client=new NativeLiveMacHttpRelayClient("https://relay.invalid","synthetic",async(url,init)=>{
   assert.match(String(url),/\/task-controls\/capabilities$/);assert.equal(init?.method,"POST");
   return new Response(JSON.stringify(status===200?{success:true,data:{version}}:{success:false}),{status,headers:{"content-type":"application/json"}});
  });
  assert.equal(await client.supportsTaskControls(),expected);
 }
});
