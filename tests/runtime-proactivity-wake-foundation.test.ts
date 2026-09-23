import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProactivityEffectDispatchAllowed,
  evaluateProactivityWakeGate,
  hashProactivityMessagePayload,
  type ProactivityWakeGateInput,
} from "../src/domains/runtime/proactivity-wake-contract.js";
import {
  ProactivityWakeService,
} from "../src/domains/runtime/proactivity-wake-service.js";
import type {
  DurableEffect,
} from "../src/domains/runtime/effect-protocol.js";

const offeredAt = "2026-09-23T09:30:00.000Z";

function gate(
  overrides: Partial<ProactivityWakeGateInput> = {},
): ProactivityWakeGateInput {
  return {
    wakeId: "wake-1",
    userId: "user-1",
    subjectId: "G",
    offeredAt,
    mode: "live",
    enabled: true,
    foregroundActive: false,
    outstandingEffectStatus: null,
    quietUntil: null,
    nextEligibleAt: null,
    ...overrides,
  };
}

test("wake gate is deterministic and foreground-first", () => {
  assert.deepEqual(
    evaluateProactivityWakeGate(gate({ mode: "replay" })),
    {
      outcome: "blocked",
      reason: "replay",
      blockedUntil: null,
    },
  );
  assert.deepEqual(
    evaluateProactivityWakeGate(gate({ enabled: false })),
    {
      outcome: "blocked",
      reason: "disabled",
      blockedUntil: null,
    },
  );
  assert.deepEqual(
    evaluateProactivityWakeGate(gate({ foregroundActive: true })),
    {
      outcome: "blocked",
      reason: "foreground_active",
      blockedUntil: null,
    },
  );
  assert.deepEqual(
    evaluateProactivityWakeGate(gate({
      outstandingEffectStatus: "unknown",
    })),
    {
      outcome: "blocked",
      reason: "effect_unresolved",
      blockedUntil: null,
    },
  );
  assert.deepEqual(
    evaluateProactivityWakeGate(gate({
      quietUntil: "2026-09-23T10:00:00.000Z",
    })),
    {
      outcome: "blocked",
      reason: "quiet_window",
      blockedUntil: "2026-09-23T10:00:00.000Z",
    },
  );
  assert.deepEqual(
    evaluateProactivityWakeGate(gate({
      nextEligibleAt: "2026-09-23T09:45:00.000Z",
    })),
    {
      outcome: "blocked",
      reason: "cooldown",
      blockedUntil: "2026-09-23T09:45:00.000Z",
    },
  );
  assert.deepEqual(
    evaluateProactivityWakeGate(gate()),
    { outcome: "eligible" },
  );
});

test("blocked wake never calls deliberation and returns an effect-silent quiet decision", async () => {
  let calls = 0;
  const service = new ProactivityWakeService(
    {
      async decide() {
        calls += 1;
        return {
          outcome: "contact_candidate",
          text: "should never run",
        };
      },
    },
    () => "2026-09-23T09:30:01.000Z",
    () => "decision-1",
  );

  const decision = await service.run({
    gate: gate({ foregroundActive: true }),
    contactTarget: "conversation:c1",
  });

  assert.equal(calls, 0);
  assert.deepEqual(decision, {
    decisionId: "decision-1",
    wakeId: "wake-1",
    userId: "user-1",
    subjectId: "G",
    offeredAt,
    decidedAt: "2026-09-23T09:30:01.000Z",
    outcome: "quiet",
    reasonCode: "gate_foreground_active",
    contactText: null,
    effectIntent: null,
  });
});

test("eligible wake may stay quiet or request internal reflection without external effect intent", async () => {
  for (const outcome of ["quiet", "reflect"] as const) {
    const service = new ProactivityWakeService(
      {
        async decide() {
          return { outcome };
        },
      },
      () => "2026-09-23T09:30:01.000Z",
      () => "decision-" + outcome,
    );

    const decision = await service.run({
      gate: gate(),
      contactTarget: "conversation:c1",
    });

    assert.equal(decision.outcome, outcome);
    assert.equal(decision.effectIntent, null);
    assert.equal(decision.contactText, null);
  }
});

test("contact candidate binds backend-owned target and payload hash but does not dispatch", async () => {
  const service = new ProactivityWakeService(
    {
      async decide() {
        return {
          outcome: "contact_candidate",
          text: "  想起一件事。  ",
        };
      },
    },
    () => "2026-09-23T09:30:01.000Z",
    () => "decision-contact",
  );

  const decision = await service.run({
    gate: gate(),
    contactTarget: "conversation:c1",
  });

  assert.equal(decision.outcome, "contact_candidate");
  assert.equal(decision.contactText, "想起一件事。");
  assert.deepEqual(decision.effectIntent, {
    effectType: "message_send",
    target: "conversation:c1",
    payloadHash: hashProactivityMessagePayload("想起一件事。"),
  });

  const effect: DurableEffect = {
    effectId: "effect-1",
    userId: "user-1",
    subjectId: "G",
    decisionId: "decision-contact",
    idempotencyKey: "effect-1:send",
    effectType: "message_send",
    target: "conversation:c1",
    payloadHash: hashProactivityMessagePayload("想起一件事。"),
    status: "pending",
    attempt: 0,
    retryable: true,
    createdAt: "2026-09-23T09:30:02.000Z",
    updatedAt: "2026-09-23T09:30:02.000Z",
  };

  assert.doesNotThrow(() =>
    assertProactivityEffectDispatchAllowed({
      mode: "live",
      decision,
      effect,
    }),
  );
  assert.throws(() =>
    assertProactivityEffectDispatchAllowed({
      mode: "replay",
      decision,
      effect,
    }),
    /Replay is effect-silent/,
  );
  assert.throws(() =>
    assertProactivityEffectDispatchAllowed({
      mode: "live",
      decision,
      effect: {
        ...effect,
        target: "conversation:other",
      },
    }),
    /does not match/,
  );

  assert.throws(() =>
    assertProactivityEffectDispatchAllowed({
      mode: "live",
      decision: {
        ...decision,
        contactText: "tampered",
      },
      effect,
    }),
    /payload binding is invalid/,
  );
});

test("contact candidate without backend target fails closed to quiet", async () => {
  const service = new ProactivityWakeService(
    {
      async decide() {
        return {
          outcome: "contact_candidate",
          text: "hello",
        };
      },
    },
    () => "2026-09-23T09:30:01.000Z",
    () => "decision-no-target",
  );

  const decision = await service.run({
    gate: gate(),
    contactTarget: null,
  });

  assert.equal(decision.outcome, "quiet");
  assert.equal(
    decision.reasonCode,
    "contact_target_unavailable",
  );
  assert.equal(decision.effectIntent, null);
});

test("deliberation failure and invalid contact output fail soft to quiet", async () => {
  const failed = new ProactivityWakeService(
    {
      async decide() {
        throw new Error("model unavailable");
      },
    },
    () => "2026-09-23T09:30:01.000Z",
    () => "decision-failed",
  );
  assert.equal(
    (await failed.run({
      gate: gate(),
      contactTarget: "conversation:c1",
    })).reasonCode,
    "deliberation_failed",
  );

  const invalid = new ProactivityWakeService(
    {
      async decide() {
        return {
          outcome: "contact_candidate",
          text: "   ",
        };
      },
    },
    () => "2026-09-23T09:30:01.000Z",
    () => "decision-invalid",
  );
  assert.equal(
    (await invalid.run({
      gate: gate(),
      contactTarget: "conversation:c1",
    })).reasonCode,
    "invalid_deliberation_output",
  );
});
