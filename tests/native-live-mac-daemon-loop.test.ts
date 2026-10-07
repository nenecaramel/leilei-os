import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeLiveMacResultOutbox } from "../src/domains/bridge/mac/native-live-mac-result-outbox.js";
import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveMacDaemonLoop,
  type NativeLiveBackgroundModelExecutor,
  type NativeLiveMacDaemonRelayClient,
  type NativeLivePreparedCommandExecutor,
} from "../src/domains/bridge/mac/native-live-mac-daemon-loop.js";
import type {
  NativeLiveRuntimeCommand,
  NativeLiveRuntimeExecutionResult,
} from "../src/domains/bridge/protocol/native-live-runtime-protocol.js";
import type {
  NativeLiveNormalizedEvent,
} from "../src/domains/conversation/native-live-conversation-orchestrator.js";

const listenerInstanceId = "11111111-1111-4111-8111-111111111111";
const reservationId = "22222222-2222-4222-8222-222222222222";
const prepareId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const conversationId = "55555555-5555-4555-8555-555555555555";
const userMessageId = "66666666-6666-4666-8666-666666666666";

function command(): NativeLiveRuntimeCommand {
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
    prompt: "hello",
  };
}

function success(): NativeLiveRuntimeExecutionResult {
  return {
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-new",
    normalized_events: [],
  };
}

class FakeRelay implements NativeLiveMacDaemonRelayClient {
  lease: "acquired" | "renewed" | "busy" = "acquired";
  reservation: { reservationId: string; command: NativeLiveRuntimeCommand } | null = {
    reservationId,
    command: command(),
  };
  calls: Array<{ name: string; input: unknown }> = [];
  startError: Error | null = null;
  submitError: Error | null = null;
  canonicalOutcome: string | null = null;

  async renewLease(input: unknown) {
    this.calls.push({ name: "renewLease", input });
    return this.lease;
  }

  async reserveNext(input: unknown) {
    this.calls.push({ name: "reserveNext", input });
    return this.reservation;
  }

  async markExecutionStarted(input: unknown) {
    this.calls.push({ name: "markExecutionStarted", input });
    if (this.startError) throw this.startError;
  }

  async submitResult(input: unknown) {
    this.calls.push({ name: "submitResult", input });
    if (this.submitError) throw this.submitError;
    return this.canonicalOutcome
      ? { canonicalOutcome: this.canonicalOutcome }
      : undefined;
  }

  async markResultDeliveryUnknown(input: unknown) {
    this.calls.push({ name: "markResultDeliveryUnknown", input });
  }

  async rejectReservation(input: unknown) {
    this.calls.push({ name: "rejectReservation", input });
  }
}

class FakeBackgroundRelay extends FakeRelay {
  backgroundReservation = {
    reservationId: prepareId,
    command: {
      protocol_version: 1 as const,
      task_id: prepareId,
      task_kind: "proactivity_deliberate" as const,
      prompt_contract_version: "proactivity-wake-deliberation-v1",
      prompt: "evaluate",
    },
  };
  backgroundSubmitError: Error | null = null;

  async reserveBackgroundModel(input: unknown) {
    this.calls.push({ name: "reserveBackgroundModel", input });
    return this.backgroundReservation;
  }

  async submitBackgroundModelResult(input: unknown) {
    this.calls.push({
      name: "submitBackgroundModelResult",
      input,
    });
    if (this.backgroundSubmitError) {
      throw this.backgroundSubmitError;
    }
  }
}

class FakeSemanticRelay extends FakeRelay {
  semanticReservation = {
    reservationId: prepareId,
    query: "solo travel independent",
    candidates: [{
      stateId: "state-travel",
      kind: "memory" as const,
      text: "独自旅行让我觉得自己可以照顾好自己",
    }],
  };
  semanticSubmitError: Error | null = null;
  semanticFallbackError: Error | null = null;

  async reserveSemanticScoring(input: unknown) {
    this.calls.push({ name: "reserveSemanticScoring", input });
    return this.semanticReservation;
  }

  async submitSemanticScores(input: unknown) {
    this.calls.push({ name: "submitSemanticScores", input });
    if (this.semanticSubmitError) throw this.semanticSubmitError;
  }

  async submitSemanticFallback(input: unknown) {
    this.calls.push({ name: "submitSemanticFallback", input });
    if (this.semanticFallbackError) throw this.semanticFallbackError;
  }
}

class FakeSemanticScorer {
  error: Error | null = null;
  calls: unknown[] = [];

  async score(input: {
    query: string;
    candidates: readonly {
      stateId: string;
      kind: "memory";
      text: string;
    }[];
  }) {
    this.calls.push(input);
    if (this.error) throw this.error;
    return new Map(input.candidates.map((candidate) => [
      candidate.stateId,
      0.93,
    ]));
  }
}

class FakeExecutor implements NativeLivePreparedCommandExecutor {
  calls: unknown[] = [];
  value: NativeLiveRuntimeExecutionResult = success();
  error: Error | null = null;

  async execute(input: unknown) {
    this.calls.push(input);
    if (this.error) throw this.error;
    return this.value;
  }
}

class FakeBackgroundExecutor
implements NativeLiveBackgroundModelExecutor {
  calls: unknown[] = [];

  async execute(input: unknown) {
    this.calls.push(input);
    return {
      protocol_version: 1 as const,
      task_id: prepareId,
      task_kind: "proactivity_deliberate" as const,
      status: "success" as const,
      final_text: '{"decision":"quiet"}',
    };
  }
}

function setup() {
  const relay = new FakeRelay();
  const executor = new FakeExecutor();
  const loop = new NativeLiveMacDaemonLoop(
    listenerInstanceId,
    relay,
    executor,
  );
  return { relay, executor, loop };
}

test("busy target lease prevents reservation and execution", async () => {
  const { relay, executor, loop } = setup();
  relay.lease = "busy";

  assert.deepEqual(await loop.runOnce(), { outcome: "busy" });
  assert.deepEqual(executor.calls, []);
  assert.deepEqual(relay.calls.map((entry) => entry.name), ["renewLease"]);
});

test("empty targeted queue returns idle without invoking Claude", async () => {
  const { relay, executor, loop } = setup();
  relay.reservation = null;

  assert.deepEqual(await loop.runOnce(), { outcome: "idle" });
  assert.deepEqual(executor.calls, []);
  assert.deepEqual(
    relay.calls.map((entry) => entry.name),
    ["renewLease", "reserveNext"],
  );
});

test("pure idle daemon cycle offers one background opportunity", async () => {
  const relay = new FakeRelay();
  relay.reservation = null;
  const executor = new FakeExecutor();
  let offers = 0;
  const loop = new NativeLiveMacDaemonLoop(
    listenerInstanceId,
    relay,
    executor,
    null,
    {
      async offer() {
        offers += 1;
      },
    },
  );

  assert.deepEqual(await loop.runOnce(), { outcome: "idle" });
  assert.equal(offers, 1);
  assert.deepEqual(executor.calls, []);
});

test("idle opportunity failure is fail-soft and still returns idle", async () => {
  const relay = new FakeRelay();
  relay.reservation = null;
  const executor = new FakeExecutor();
  const loop = new NativeLiveMacDaemonLoop(
    listenerInstanceId,
    relay,
    executor,
    null,
    {
      async offer() {
        throw new Error("background unavailable");
      },
    },
  );

  assert.deepEqual(await loop.runOnce(), { outcome: "idle" });
  assert.deepEqual(executor.calls, []);
});

test("foreground or semantic work suppresses idle background opportunity", async () => {
  let offers = 0;
  const opportunity = {
    async offer() {
      offers += 1;
    },
  };

  const foregroundRelay = new FakeRelay();
  const foreground = new NativeLiveMacDaemonLoop(
    listenerInstanceId,
    foregroundRelay,
    new FakeExecutor(),
    null,
    opportunity,
  );
  assert.equal((await foreground.runOnce()).outcome, "completed");
  assert.equal(offers, 0);

  const semanticRelay = new FakeSemanticRelay();
  semanticRelay.reservation = null;
  const semantic = new NativeLiveMacDaemonLoop(
    listenerInstanceId,
    semanticRelay,
    new FakeExecutor(),
    new FakeSemanticScorer(),
    opportunity,
  );
  assert.equal((await semantic.runOnce()).outcome, "semantic_completed");
  assert.equal(offers, 0);
});

test("background model runs only after foreground and semantic queues are empty", async () => {
  const relay = new FakeBackgroundRelay();
  relay.reservation = null;
  const foreground = new FakeExecutor();
  const background = new FakeBackgroundExecutor();
  const loop = new NativeLiveMacDaemonLoop(
    listenerInstanceId,
    relay,
    foreground,
    null,
    null,
    background,
  );

  const outcome = await loop.runOnce();
  assert.equal(outcome.outcome, "background_completed");
  assert.equal(foreground.calls.length, 0);
  assert.equal(background.calls.length, 1);
  assert.deepEqual(
    relay.calls.map((entry) => entry.name),
    [
      "renewLease",
      "reserveNext",
      "reserveBackgroundModel",
      "submitBackgroundModelResult",
    ],
  );
});

test("foreground reservation suppresses background model reservation", async () => {
  const relay = new FakeBackgroundRelay();
  const background = new FakeBackgroundExecutor();
  const loop = new NativeLiveMacDaemonLoop(
    listenerInstanceId,
    relay,
    new FakeExecutor(),
    null,
    null,
    background,
  );

  assert.equal((await loop.runOnce()).outcome, "completed");
  assert.equal(
    relay.calls.some(
      (entry) => entry.name === "reserveBackgroundModel",
    ),
    false,
  );
  assert.equal(background.calls.length, 0);
});

test("background result callback ambiguity is surfaced without re-executing in the same cycle", async () => {
  const relay = new FakeBackgroundRelay();
  relay.reservation = null;
  relay.backgroundSubmitError = new Error("timeout after write");
  const background = new FakeBackgroundExecutor();
  const loop = new NativeLiveMacDaemonLoop(
    listenerInstanceId,
    relay,
    new FakeExecutor(),
    null,
    null,
    background,
  );

  const outcome = await loop.runOnce();
  assert.equal(outcome.outcome, "background_delivery_unknown");
  assert.equal(background.calls.length, 1);
});

test("reserved command is marked started, executed once, then submitted once", async () => {
  const { relay, executor, loop } = setup();

  const outcome = await loop.runOnce();

  assert.deepEqual(outcome, {
    outcome: "completed",
    reservationId,
    result: success(),
  });
  assert.deepEqual(executor.calls, [command()]);
  assert.deepEqual(relay.calls.map((entry) => entry.name), [
    "renewLease",
    "reserveNext",
    "markExecutionStarted",
    "submitResult",
  ]);
  const submit = relay.calls.at(-1)?.input as {
    listenerInstanceId: string;
    reservationId: string;
    result: NativeLiveRuntimeExecutionResult;
  };
  assert.equal(submit.listenerInstanceId, listenerInstanceId);
  assert.equal(submit.reservationId, reservationId);
  assert.deepEqual(submit.result, success());
});

test("daemon propagates wake_quiet as canonical terminal metadata without changing completed execution semantics", async () => {
  const { relay, loop } = setup();
  relay.canonicalOutcome = "wake_quiet";

  assert.deepEqual(await loop.runOnce(), {
    outcome: "completed",
    reservationId,
    result: success(),
    canonicalOutcome: "wake_quiet",
  });
});

test("execution-start failure rejects reservation and never invokes Claude", async () => {
  const { relay, executor, loop } = setup();
  relay.startError = new Error("start callback failed");

  assert.deepEqual(await loop.runOnce(), {
    outcome: "rejected",
    reservationId,
    code: "EXECUTION_START_FAILED",
  });
  assert.deepEqual(executor.calls, []);
  assert.deepEqual(relay.calls.map((entry) => entry.name), [
    "renewLease",
    "reserveNext",
    "markExecutionStarted",
    "rejectReservation",
  ]);
});

test("invalid prepared command rejection never submits a fabricated runtime result", async () => {
  const { relay, executor, loop } = setup();
  executor.error = new Error("invalid command");

  assert.deepEqual(await loop.runOnce(), {
    outcome: "rejected",
    reservationId,
    code: "INVALID_COMMAND",
  });
  assert.deepEqual(relay.calls.map((entry) => entry.name), [
    "renewLease",
    "reserveNext",
    "markExecutionStarted",
    "rejectReservation",
  ]);
});

test("ambiguous result callback is quarantined and never blindly resubmitted", async () => {
  const { relay, executor, loop } = setup();
  relay.submitError = new Error("timeout after write");

  assert.deepEqual(await loop.runOnce(), {
    outcome: "delivery_unknown",
    reservationId,
    result: success(),
  });
  assert.equal(executor.calls.length, 1);
  assert.deepEqual(relay.calls.map((entry) => entry.name), [
    "renewLease",
    "reserveNext",
    "markExecutionStarted",
    "submitResult",
    "markResultDeliveryUnknown",
  ]);
  assert.equal(
    relay.calls.filter((entry) => entry.name === "submitResult").length,
    1,
  );
});

test("semantic reservation is scored locally before the Claude queue is polled", async () => {
  const relay = new FakeSemanticRelay();
  relay.reservation = null;
  const executor = new FakeExecutor();
  const semantic = new FakeSemanticScorer();
  const loop = new NativeLiveMacDaemonLoop(
    listenerInstanceId,
    relay,
    executor,
    semantic,
  );

  assert.deepEqual(await loop.runOnce(), {
    outcome: "semantic_completed",
    reservationId: prepareId,
  });
  assert.equal(semantic.calls.length, 1);
  assert.deepEqual(relay.calls.map((entry) => entry.name), [
    "renewLease",
    "reserveSemanticScoring",
    "submitSemanticScores",
    "reserveNext",
  ]);
});

test("unavailable local E5 falls back to lexical assembly without blocking the turn", async () => {
  const relay = new FakeSemanticRelay();
  relay.reservation = null;
  const executor = new FakeExecutor();
  const semantic = new FakeSemanticScorer();
  const providerError = Object.assign(new Error("not prepared"), {
    code: "PROVIDER_NOT_PREPARED",
  });
  semantic.error = providerError;
  const loop = new NativeLiveMacDaemonLoop(
    listenerInstanceId,
    relay,
    executor,
    semantic,
  );

  assert.deepEqual(await loop.runOnce(), {
    outcome: "semantic_completed",
    reservationId: prepareId,
  });
  assert.deepEqual(relay.calls.map((entry) => entry.name), [
    "renewLease",
    "reserveSemanticScoring",
    "submitSemanticFallback",
    "reserveNext",
  ]);
  const fallback = relay.calls.find(
    (entry) => entry.name === "submitSemanticFallback",
  )?.input as { code: string };
  assert.equal(fallback.code, "E5_PROVIDER_UNAVAILABLE");
});

test("ambiguous semantic callback is surfaced without executing Claude", async () => {
  const relay = new FakeSemanticRelay();
  relay.semanticSubmitError = new Error("timeout after semantic write");
  const executor = new FakeExecutor();
  const semantic = new FakeSemanticScorer();
  const loop = new NativeLiveMacDaemonLoop(
    listenerInstanceId,
    relay,
    executor,
    semantic,
  );

  assert.deepEqual(await loop.runOnce(), {
    outcome: "semantic_delivery_unknown",
    reservationId: prepareId,
  });
  assert.equal(executor.calls.length, 0);
  assert.equal(
    relay.calls.some((entry) => entry.name === "reserveNext"),
    false,
  );
});

class FakeRuntimeEventRelay extends FakeRelay {
  eventSubmitError: Error | null = null;

  async appendRuntimeEvents(input: unknown) {
    this.calls.push({ name: "appendRuntimeEvents", input });
    if (this.eventSubmitError) throw this.eventSubmitError;
  }
}

class FakeStreamingExecutor implements NativeLivePreparedCommandExecutor {
  async execute(
    _input: unknown,
    options?: {
      onNormalizedEvent?: (
        event: NativeLiveNormalizedEvent,
      ) => void | Promise<void>;
      permissionHandler?: (
        request: Record<string, unknown>,
        context: { signal: AbortSignal | null },
      ) => Promise<Record<string, unknown>>;
      questionHandler?: (
        request: Record<string, unknown>,
        context: { signal: AbortSignal | null },
      ) => Promise<Record<string, unknown>>;
    },
  ) {
    await options?.onNormalizedEvent?.({
      type: "partial_text",
      payload: {
        delta: "hel",
        accumulated_length: 3,
      },
    });
    await options?.onNormalizedEvent?.({
      type: "result",
      payload: {
        status: "success",
        final_text: "hello",
      },
    });
    return success();
  }
}

test("foreground normalized events are delivered in reservation-local sequence before terminal result", async () => {
  const relay = new FakeRuntimeEventRelay();
  const loop = new NativeLiveMacDaemonLoop(
    listenerInstanceId,
    relay,
    new FakeStreamingExecutor(),
  );

  const outcome = await loop.runOnce();
  assert.equal(outcome.outcome, "completed");
  assert.deepEqual(
    relay.calls.map((entry) => entry.name),
    [
      "renewLease",
      "reserveNext",
      "markExecutionStarted",
      "appendRuntimeEvents",
      "submitResult",
    ],
  );
  const batch = relay.calls
    .find((entry) => entry.name === "appendRuntimeEvents")
    ?.input as {
      events: Array<{
        sequence: number;
        event: { type: string };
      }>;
    };
  assert.deepEqual(
    batch.events.map((entry) => [
      entry.sequence,
      entry.event.type,
    ]),
    [
      [1, "partial_text"],
      [2, "result"],
    ],
  );
});

test("foreground runtime event buffering flushes in bounded batches", async () => {
  class NineEventExecutor implements NativeLivePreparedCommandExecutor {
    async execute(
      _input: unknown,
      options?: {
        onNormalizedEvent?: (
          event: NativeLiveNormalizedEvent,
        ) => void | Promise<void>;
      },
    ) {
      for (let index = 1; index <= 9; index += 1) {
        await options?.onNormalizedEvent?.({
          type: "partial_text",
          payload: {
            delta: String(index),
            accumulated_length: index,
          },
        });
      }
      return success();
    }
  }

  const relay = new FakeRuntimeEventRelay();
  const loop = new NativeLiveMacDaemonLoop(
    listenerInstanceId,
    relay,
    new NineEventExecutor(),
  );

  assert.equal((await loop.runOnce()).outcome, "completed");
  const batches = relay.calls
    .filter((entry) => entry.name === "appendRuntimeEvents")
    .map((entry) => (
      entry.input as {
        events: Array<{ sequence: number }>;
      }
    ).events);

  assert.deepEqual(
    batches.map((batch) => batch.length),
    [8, 1],
  );
  assert.deepEqual(
    batches.flat().map((event) => event.sequence),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
});

test("runtime event delivery is fail-soft and does not invalidate canonical terminal result", async () => {
  const relay = new FakeRuntimeEventRelay();
  relay.eventSubmitError = new Error("event store unavailable");
  const loop = new NativeLiveMacDaemonLoop(
    listenerInstanceId,
    relay,
    new FakeStreamingExecutor(),
  );

  const outcome = await loop.runOnce();
  assert.equal(outcome.outcome, "completed");
  if (outcome.outcome !== "completed") {
    throw new Error("expected completed");
  }
  assert.equal(outcome.eventDeliveryFailures, 2);
  assert.equal(
    relay.calls.filter((entry) => entry.name === "submitResult").length,
    1,
  );
});

class FakeInteractionRelay extends FakeRelay {
  interactionCalls: unknown[] = [];

  async requestRuntimeInteraction(input: {
    kind: "permission" | "question";
    request: Record<string, unknown>;
  }) {
    this.interactionCalls.push(input);
    return input.kind === "permission"
      ? { decision: "allow" }
      : {
          decision: "answer",
          answers: { Theme: "Dark" },
        };
  }
}

class FakeInteractiveExecutor implements NativeLivePreparedCommandExecutor {
  permissionDecision: unknown = null;
  questionDecision: unknown = null;

  async execute(
    _input: unknown,
    options?: {
      permissionHandler?: (
        request: Record<string, unknown>,
        context: { signal: AbortSignal | null },
      ) => Promise<Record<string, unknown>>;
      questionHandler?: (
        request: Record<string, unknown>,
        context: { signal: AbortSignal | null },
      ) => Promise<Record<string, unknown>>;
    },
  ) {
    this.permissionDecision =
      await options?.permissionHandler?.(
        {
          toolName: "Write",
          input: { file_path: "/tmp/a" },
        },
        { signal: null },
      );
    this.questionDecision =
      await options?.questionHandler?.(
        {
          toolName: "AskUserQuestion",
          input: { questions: [] },
          questions: [{ question: "Theme" }],
        },
        { signal: null },
      );
    return success();
  }
}

test("daemon binds permission and AskUserQuestion host callbacks to the active reservation", async () => {
  const relay = new FakeInteractionRelay();
  const executor = new FakeInteractiveExecutor();
  const loop = new NativeLiveMacDaemonLoop(
    listenerInstanceId,
    relay,
    executor,
  );

  assert.equal((await loop.runOnce()).outcome, "completed");
  assert.deepEqual(executor.permissionDecision, {
    decision: "allow",
  });
  assert.deepEqual(executor.questionDecision, {
    decision: "answer",
    answers: { Theme: "Dark" },
  });
  assert.equal(relay.interactionCalls.length, 2);
  assert.deepEqual(
    relay.interactionCalls.map(
      (entry) => (entry as { kind: string }).kind,
    ),
    ["permission", "question"],
  );
  for (const entry of relay.interactionCalls) {
    const value = entry as {
      listenerInstanceId: string;
      reservationId: string;
    };
    assert.equal(value.listenerInstanceId, listenerInstanceId);
    assert.equal(value.reservationId, reservationId);
  }
});

test("runOnce rejects reentrant polling while an execution is in flight", async () => {
  const relay = new FakeRelay();
  let resolveExecute!: (value: NativeLiveRuntimeExecutionResult) => void;
  const executor: NativeLivePreparedCommandExecutor = {
    execute: () =>
      new Promise<NativeLiveRuntimeExecutionResult>((resolve) => {
        resolveExecute = resolve;
      }),
  };
  const loop = new NativeLiveMacDaemonLoop(
    listenerInstanceId,
    relay,
    executor,
  );

  const first = loop.runOnce();
  await new Promise((resolve) => setImmediate(resolve));

  await assert.rejects(
    () => loop.runOnce(),
    (error: unknown) =>
      typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: unknown }).code === "NATIVE_LIVE_DAEMON_REENTRANT",
  );

  resolveExecute(success());
  assert.equal((await first).outcome, "completed");
});

test("daemon applies reserved mid-turn and interrupt controls exactly once on the active turn", async () => {
  class FakeControlRelay extends FakeRelay {
    controls = [
      {
        controlId: "77777777-7777-4777-8777-777777777777",
        kind: "mid_turn_input" as const,
        payload: { text: "steer this turn" },
      },
      {
        controlId: "88888888-8888-4888-8888-888888888888",
        kind: "interrupt" as const,
        payload: {},
      },
    ];

    async waitRuntimeControl(input: unknown) {
      this.calls.push({ name: "waitRuntimeControl", input });
      return this.controls.shift() ?? null;
    }

    async completeRuntimeControl(input: unknown) {
      this.calls.push({ name: "completeRuntimeControl", input });
    }
  }

  const relay = new FakeControlRelay();
  const providerCalls: unknown[] = [];
  const executor: NativeLivePreparedCommandExecutor = {
    async execute(_input, options) {
      const pump = options?.controlPump;
      assert.ok(pump);
      const abort = new AbortController();
      await pump(
        {
          sendUserMessage(
            text: string,
            options?: { uuid?: string | null },
          ) {
            providerCalls.push([
              "mid_turn_input",
              text,
              options?.uuid ?? null,
            ]);
            return {
              status: "queued",
              command_uuid: options?.uuid ?? null,
            };
          },
          async interrupt() {
            providerCalls.push(["interrupt"]);
            return { still_queued: [] };
          },
        },
        { signal: abort.signal },
      );
      abort.abort();
      return success();
    },
  };
  const loop = new NativeLiveMacDaemonLoop(
    listenerInstanceId,
    relay,
    executor,
  );

  const outcome = await loop.runOnce();
  assert.equal(outcome.outcome, "completed");
  assert.deepEqual(providerCalls, [
    [
      "mid_turn_input",
      "steer this turn",
      "77777777-7777-4777-8777-777777777777",
    ],
    ["interrupt"],
  ]);

  const completions = relay.calls
    .filter((entry) => entry.name === "completeRuntimeControl")
    .map((entry) => entry.input as {
      controlId: string;
      outcome: {
        status: string;
        receipt: Record<string, unknown>;
      };
    });
  assert.deepEqual(
    completions.map((entry) => [
      entry.controlId,
      entry.outcome.status,
      entry.outcome.receipt,
    ]),
    [
      [
        "77777777-7777-4777-8777-777777777777",
        "applied",
        {
          status: "queued",
          command_uuid:
            "77777777-7777-4777-8777-777777777777",
        },
      ],
      [
        "88888888-8888-4888-8888-888888888888",
        "applied",
        { still_queued: [] },
      ],
    ],
  );
});

test("daemon never blindly reapplies a provider control when completion delivery is ambiguous", async () => {
  class AmbiguousControlRelay extends FakeRelay {
    waitCount = 0;
    completeCount = 0;

    async waitRuntimeControl(input: unknown) {
      this.calls.push({ name: "waitRuntimeControl", input });
      this.waitCount += 1;
      return this.waitCount === 1
        ? {
            controlId: "99999999-9999-4999-8999-999999999999",
            kind: "interrupt" as const,
            payload: {},
          }
        : null;
    }

    async completeRuntimeControl(input: unknown) {
      this.calls.push({ name: "completeRuntimeControl", input });
      this.completeCount += 1;
      throw new Error("timeout after control completion write");
    }
  }

  const relay = new AmbiguousControlRelay();
  let interrupts = 0;
  const executor: NativeLivePreparedCommandExecutor = {
    async execute(_input, options) {
      const pump = options?.controlPump;
      assert.ok(pump);
      await pump(
        {
          sendUserMessage() {
            throw new Error("unexpected mid-turn input");
          },
          async interrupt() {
            interrupts += 1;
            return { still_queued: [] };
          },
        },
        { signal: new AbortController().signal },
      );
      return success();
    },
  };
  const loop = new NativeLiveMacDaemonLoop(
    listenerInstanceId,
    relay,
    executor,
  );

  assert.equal((await loop.runOnce()).outcome, "completed");
  assert.equal(interrupts, 1);
  assert.equal(relay.completeCount, 1);
  assert.equal(relay.waitCount, 1);
});

test("idle daemon hard-deletes a reserved purged provider session and receipts success", async () => {
  const relay = new FakeRelay();
  relay.reservation = null;
  const cleanupReservationId =
    "77777777-7777-4777-8777-777777777777";
  const calls: Array<{ name: string; input: unknown }> = [];
  const cleanupRelay = Object.assign(relay, {
    async reserveProviderSessionCleanup(input: unknown) {
      calls.push({ name: "reserveCleanup", input });
      return {
        reservationId: cleanupReservationId,
        providerSessionId: "provider-old-fork",
      };
    },
    async submitProviderSessionCleanupResult(input: unknown) {
      calls.push({ name: "submitCleanup", input });
    },
  });
  const deleted: string[] = [];
  const cleanupExecutor = {
    async deleteSession(sessionId: string) {
      deleted.push(sessionId);
    },
  };
  const loop = new NativeLiveMacDaemonLoop(
    listenerInstanceId,
    cleanupRelay,
    new FakeExecutor(),
    null,
    null,
    null,
    cleanupExecutor,
  );

  assert.deepEqual(await loop.runOnce(), {
    outcome: "provider_session_cleanup_completed",
    reservationId: cleanupReservationId,
  });
  assert.deepEqual(deleted, ["provider-old-fork"]);
  assert.deepEqual(calls, [
    {
      name: "reserveCleanup",
      input: {
        listenerInstanceId,
        dispatchTarget: "claude_code",
      },
    },
    {
      name: "submitCleanup",
      input: {
        listenerInstanceId,
        reservationId: cleanupReservationId,
        outcome: { status: "success" },
      },
    },
  ]);
});

test("provider session deletion failure is receipted for bounded retry", async () => {
  const relay = new FakeRelay();
  relay.reservation = null;
  const cleanupReservationId =
    "77777777-7777-4777-8777-777777777777";
  const receipts: unknown[] = [];
  const cleanupRelay = Object.assign(relay, {
    async reserveProviderSessionCleanup() {
      return {
        reservationId: cleanupReservationId,
        providerSessionId: "provider-old-fork",
      };
    },
    async submitProviderSessionCleanupResult(input: unknown) {
      receipts.push(input);
    },
  });
  const cleanupExecutor = {
    async deleteSession() {
      throw new Error("filesystem unavailable");
    },
  };
  const loop = new NativeLiveMacDaemonLoop(
    listenerInstanceId,
    cleanupRelay,
    new FakeExecutor(),
    null,
    null,
    null,
    cleanupExecutor,
  );

  assert.deepEqual(await loop.runOnce(), {
    outcome: "provider_session_cleanup_failed",
    reservationId: cleanupReservationId,
  });
  assert.deepEqual(receipts, [{
    listenerInstanceId,
    reservationId: cleanupReservationId,
    outcome: {
      status: "failure",
      failureCode: "DELETE_SESSION_FAILED",
    },
  }]);
});

test("provider clock start and terminal are delivered before sparse foreground execution continues", async () => {
  const relay = new FakeRuntimeEventRelay();
  const batches = () => relay.calls.filter(c=>c.name === "appendRuntimeEvents").map(c=>(c.input as {events:Array<{sequence:number;event:NativeLiveNormalizedEvent}>}).events);
  let atStart: string[][] = [], atTerminal: string[][] = [];
  const executor: NativeLivePreparedCommandExecutor = {
    async execute(_input, options) {
      await options?.onNormalizedEvent?.({type:"session",payload:{}});
      await options?.onNormalizedEvent?.({type:"runtime",payload:{kind:"provider_message_start"}});
      atStart = batches().map(b=>b.map(e=>e.event.type));
      await options?.onNormalizedEvent?.({type:"partial_text",payload:{delta:"Hello"}});
      await options?.onNormalizedEvent?.({type:"result",payload:{duration_ms:17000}});
      atTerminal = batches().map(b=>b.map(e=>e.event.type));
      return success();
    },
  };
  assert.equal((await new NativeLiveMacDaemonLoop(listenerInstanceId,relay,executor).runOnce()).outcome,"completed");
  assert.deepEqual(atStart,[["session","runtime"]],"clock must arrive before any body/tool/result event");
  assert.deepEqual(atTerminal,[["session","runtime"],["partial_text","result"]],"terminal timestamp cannot wait for executor teardown");
  assert.deepEqual(batches().flat().map(e=>e.sequence),[1,2,3,4]);
});


test("production loop persists before submit and restarted daemon replays without another execution", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "leilei-loop-outbox-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const relay = new FakeRelay();
  relay.reservation!.reservationId = prepareId;
  const executor = new FakeExecutor();
  const outbox = new NativeLiveMacResultOutbox(directory);
  relay.submitResult = async (input: unknown) => {
    assert.equal((await new NativeLiveMacResultOutbox(directory).list()).length, 1, "receipt must precede HTTP");
    relay.calls.push({ name: "submitResult", input });
    throw new Error("server unavailable");
  };
  const loop = new NativeLiveMacDaemonLoop(listenerInstanceId, relay, executor, null, null, null, null, null, null, outbox);
  assert.equal((await loop.runOnce()).outcome, "delivery_unknown");
  relay.submitResult = async (input: unknown) => {
    assert.deepEqual(input, { listenerInstanceId, reservationId: prepareId, result: success() });
    return undefined;
  };
  const restarted = new NativeLiveMacDaemonLoop(crypto.randomUUID(), relay, executor, null, null, null, null, null, null, new NativeLiveMacResultOutbox(directory));
  assert.equal((await restarted.runOnce()).outcome, "completed");
  assert.equal(executor.calls.length, 1);
  assert.deepEqual(await outbox.list(), []);
});


test("idle daemon forks the exact Claude checkpoint and receipts the handoff session", async () => {
  const relay = new FakeRelay();
  relay.reservation = null;
  const handoffId = "88888888-8888-4888-8888-888888888888";
  const sourceSessionId =
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const checkpointId =
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const handoffSessionId =
    "99999999-9999-4999-8999-999999999999";
  const calls: Array<{ name: string; input: unknown }> = [];
  const handoffRelay = Object.assign(relay, {
    async reserveClaudeHandoff(input: unknown) {
      calls.push({ name: "reserveHandoff", input });
      return {
        reservationId: handoffId,
        conversationId,
        expectedHeadMessageId: userMessageId,
        sourceMessageId: userMessageId,
        providerSessionId: sourceSessionId,
        providerCheckpointId: checkpointId,
        effectiveWorkingDirectory: "/Users/test/project",
      };
    },
    async submitClaudeHandoffResult(input: unknown) {
      calls.push({ name: "submitHandoff", input });
    },
  });
  const forkCalls: unknown[] = [];
  const handoffExecutor = {
    async forkSessionAtCheckpoint(
      sessionId: string,
      checkpoint: string,
      workingDirectory: string | null,
    ) {
      forkCalls.push({
        sessionId,
        checkpoint,
        workingDirectory,
      });
      return {
        providerSessionId: handoffSessionId,
      };
    },
  };

  const loop = new NativeLiveMacDaemonLoop(
    listenerInstanceId,
    handoffRelay,
    new FakeExecutor(),
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    handoffExecutor,
  );

  assert.deepEqual(await loop.runOnce(), {
    outcome: "claude_handoff_completed",
    reservationId: handoffId,
    handoffSessionId,
  });
  assert.deepEqual(forkCalls, [{
    sessionId: sourceSessionId,
    checkpoint: checkpointId,
    workingDirectory: "/Users/test/project",
  }]);
  assert.deepEqual(calls, [
    {
      name: "reserveHandoff",
      input: {
        listenerInstanceId,
        dispatchTarget: "claude_code",
      },
    },
    {
      name: "submitHandoff",
      input: {
        listenerInstanceId,
        reservationId: handoffId,
        outcome: {
          status: "success",
          handoffSessionId,
        },
      },
    },
  ]);
});

test("Claude handoff fork failure is receipted without archiving locally", async () => {
  const relay = new FakeRelay();
  relay.reservation = null;
  const handoffId = "88888888-8888-4888-8888-888888888888";
  const receipts: unknown[] = [];
  const handoffRelay = Object.assign(relay, {
    async reserveClaudeHandoff() {
      return {
        reservationId: handoffId,
        conversationId,
        expectedHeadMessageId: userMessageId,
        sourceMessageId: userMessageId,
        providerSessionId:
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        providerCheckpointId:
          "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        effectiveWorkingDirectory: "/Users/test/project",
      };
    },
    async submitClaudeHandoffResult(input: unknown) {
      receipts.push(input);
    },
  });
  const handoffExecutor = {
    async forkSessionAtCheckpoint() {
      throw Object.assign(
        new Error("checkpoint missing"),
        { runtimeCode: "NO_PROVIDER_SESSION" },
      );
    },
  };

  const loop = new NativeLiveMacDaemonLoop(
    listenerInstanceId,
    handoffRelay,
    new FakeExecutor(),
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    handoffExecutor,
  );

  assert.deepEqual(await loop.runOnce(), {
    outcome: "claude_handoff_failed",
    reservationId: handoffId,
  });
  assert.deepEqual(receipts, [{
    listenerInstanceId,
    reservationId: handoffId,
    outcome: {
      status: "failure",
      failureCode: "NO_PROVIDER_SESSION",
    },
  }]);
});
