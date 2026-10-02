import assert from "node:assert/strict";
import test from "node:test";
import {
  ProactivityEffectMaterializer,
} from "../src/domains/runtime/effects/proactivity-effect-materializer.js";
import {
  hashProactivityMessagePayload,
  type ProactivityWakeDecision,
} from "../src/domains/runtime/proactivity/proactivity-wake-contract.js";
import type {
  ProactivityWakeRecord,
} from "../src/domains/runtime/proactivity/proactivity-wake-state.js";
import type {
  RuntimeEffectCreate,
  RuntimeEffectPort,
  RuntimeEffectRecord,
} from "../src/domains/runtime/effects/runtime-effect-repository.js";

const userId = "22222222-2222-4222-8222-222222222222";
const wakeId = "11111111-1111-4111-8111-111111111111";

function contactDecision(
  overrides: Partial<ProactivityWakeDecision> = {},
): ProactivityWakeDecision {
  const text = "想起你之前提过的一件事。";
  return {
    decisionId: "decision-1",
    wakeId,
    userId,
    subjectId: "G",
    offeredAt: "2026-09-23T09:30:00.000Z",
    decidedAt: "2026-09-23T09:31:00.000Z",
    outcome: "contact_candidate",
    reasonCode: "model_contact_candidate",
    contactText: text,
    effectIntent: {
      effectType: "message_send",
      target: "conversation:c1",
      payloadHash: hashProactivityMessagePayload(text),
    },
    ...overrides,
  };
}

function decidedWake(
  decision: ProactivityWakeDecision = contactDecision(),
): ProactivityWakeRecord {
  return {
    id: wakeId,
    userId,
    subjectId: "G",
    gate: {
      wakeId,
      userId,
      subjectId: "G",
      offeredAt: "2026-09-23T09:30:00.000Z",
      mode: "live",
      enabled: true,
      foregroundActive: false,
      outstandingEffectStatus: null,
      quietUntil: null,
      nextEligibleAt: null,
    },
    contactTarget: "conversation:c1",
    context: {
      version: 1,
      contextManifestId: null,
      capsule: "{}",
    },
    status: "decided",
    modelTaskId: null,
    decision,
    createdAt: "2026-09-23T09:30:00.000Z",
    updatedAt: "2026-09-23T09:31:00.000Z",
    decidedAt: "2026-09-23T09:31:00.000Z",
  };
}

class EffectMemory implements Pick<
  RuntimeEffectPort,
  "createOrGet" | "getBySourceWake"
> {
  record: RuntimeEffectRecord | null = null;
  calls: RuntimeEffectCreate[] = [];

  async createOrGet(
    input: RuntimeEffectCreate,
  ): Promise<RuntimeEffectRecord> {
    this.calls.push(input);
    if (!this.record) {
      this.record = {
        ...input.effect,
        sourceWakeId: input.sourceWakeId,
        payload: input.payload,
      };
    }
    return this.record;
  }

  async getBySourceWake() {
    return this.record;
  }
}

test("contact candidate materializes exactly one effect identity with opaque durable payload", async () => {
  const effects = new EffectMemory();
  let nowCalls = 0;
  const materializer = new ProactivityEffectMaterializer(
    effects,
    () => {
      nowCalls += 1;
      return nowCalls === 1
        ? "2026-09-23T09:32:00.000Z"
        : "2026-09-23T09:40:00.000Z";
    },
  );

  const first = await materializer.materialize(decidedWake());
  const second = await materializer.materialize(decidedWake());

  assert.ok(first);
  assert.ok(second);
  assert.equal(first.effectId, second.effectId);
  assert.equal(first.idempotencyKey, second.idempotencyKey);
  assert.equal(first.status, "pending");
  assert.equal(first.attempt, 0);
  assert.equal(first.retryable, true);
  assert.equal(first.effectType, "message_send");
  assert.equal(first.target, "conversation:c1");
  assert.deepEqual(first.payload, {
    text: "想起你之前提过的一件事。",
  });
  assert.equal(effects.calls.length, 2);
  assert.equal(
    effects.calls[0]?.effect.effectId,
    effects.calls[1]?.effect.effectId,
  );
  assert.equal(
    effects.calls[0]?.effect.idempotencyKey,
    effects.calls[1]?.effect.idempotencyKey,
  );
});

test("quiet and reflect decisions remain effect-silent", async () => {
  const effects = new EffectMemory();
  const materializer =
    new ProactivityEffectMaterializer(effects);

  for (const outcome of ["quiet", "reflect"] as const) {
    const decision: ProactivityWakeDecision = {
      ...contactDecision(),
      outcome,
      reasonCode:
        outcome === "quiet"
          ? "model_quiet"
          : "model_reflect",
      contactText: null,
      effectIntent: null,
    };
    assert.equal(
      await materializer.materialize(decidedWake(decision)),
      null,
    );
  }
  assert.equal(effects.calls.length, 0);
});

test("materializer rejects replay, backend-target drift, and payload tampering", async () => {
  const effects = new EffectMemory();
  const materializer =
    new ProactivityEffectMaterializer(effects);

  const replay = decidedWake();
  replay.gate = {
    ...replay.gate,
    mode: "replay",
  };
  await assert.rejects(
    () => materializer.materialize(replay),
    /Replay proactivity wake is effect-silent/,
  );

  const targetDrift = decidedWake();
  targetDrift.contactTarget = "conversation:other";
  await assert.rejects(
    () => materializer.materialize(targetDrift),
    /backend-owned wake target/,
  );

  const tampered = decidedWake({
    ...contactDecision(),
    contactText: "tampered",
  });
  await assert.rejects(
    () => materializer.materialize(tampered),
    /payload hash does not match/,
  );
});
