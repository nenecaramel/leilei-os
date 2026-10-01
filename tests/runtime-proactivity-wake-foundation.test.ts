import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateProactivityWakeGate,
  evaluateProactivityWakeGateAt,
  type ProactivityWakeGateInput,
} from "../src/domains/runtime/proactivity-wake-contract.js";

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
  for (const status of [
    "pending",
    "reserved",
    "dispatching",
    "unknown",
  ] as const) {
    assert.deepEqual(
      evaluateProactivityWakeGate(gate({
        outstandingEffectStatus: status,
      })),
      {
        outcome: "blocked",
        reason: "effect_unresolved",
        blockedUntil: null,
      },
    );
  }
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


test("wake gate can be re-evaluated against current backend time without changing the durable offeredAt", () => {
  const snapshot = gate({
    quietUntil: "2026-09-23T10:00:00.000Z",
  });

  assert.equal(
    evaluateProactivityWakeGate(snapshot).outcome,
    "blocked",
  );
  assert.deepEqual(
    evaluateProactivityWakeGateAt(
      snapshot,
      "2026-09-23T10:01:00.000Z",
    ),
    { outcome: "eligible" },
  );
});
