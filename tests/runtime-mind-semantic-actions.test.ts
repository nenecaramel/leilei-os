import assert from "node:assert/strict";
import test from "node:test";
import {
  parseMindSemanticActions,
} from "../src/domains/runtime/mind-semantic-action.js";
import {
  NativeLiveMindSemanticActionExecutor,
  nativeLiveMindSemanticActionIdempotencyKey,
} from "../src/domains/bridge/native-live-mind-semantic-action.js";
import {
  DriveSatisfactionService,
} from "../src/domains/runtime/drive-satisfaction-runtime-repository.js";

const userId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const assistantMessageId = "33333333-3333-4333-8333-333333333333";
const prepareId = "44444444-4444-4444-8444-444444444444";
const driveStateId = "55555555-5555-4555-8555-555555555555";
const curiosityStateId = "66666666-6666-4666-8666-666666666666";

test("semantic Mind parser extracts only strict branch-safe actions and leaves malformed directives visible", () => {
  const parsed = parseMindSemanticActions([
    "正文。",
    `<mind_satisfy state_id="${driveStateId}" level="partial" />`,
    `<mind_satisfy state_id="${driveStateId}" level="full" />`,
    `<mind_resolve state_id="${curiosityStateId}" />`,
    '<mind_satisfy state_id="not-a-uuid" level="full" />',
    `<mind_satisfy state_id="${driveStateId}" level="half" />`,
  ].join("\n"));

  assert.deepEqual(
    parsed.actions.map((action) =>
      action.kind === "mind_satisfy"
        ? [action.kind, action.stateId, action.level]
        : [action.kind, action.stateId]
    ),
    [
      ["mind_satisfy", driveStateId, "partial"],
      ["mind_satisfy", driveStateId, "full"],
      ["mind_resolve", curiosityStateId],
    ],
  );
  assert.equal(
    parsed.visibleText.includes(
      `<mind_satisfy state_id="${driveStateId}" level="partial" />`,
    ),
    false,
  );
  assert.equal(
    parsed.visibleText.includes(
      `<mind_satisfy state_id="${driveStateId}" level="full" />`,
    ),
    false,
  );
  assert.equal(parsed.visibleText.includes("not-a-uuid"), true);
  assert.equal(parsed.visibleText.includes("level=\"half\""), true);
});

test("semantic action executor maps meaning to Runtime-owned numbers and returns durable receipts", async () => {
  const driveCalls: unknown[] = [];
  const curiosityCalls: unknown[] = [];
  const executor = new NativeLiveMindSemanticActionExecutor(
    {
      async satisfySemantic(input) {
        driveCalls.push(input);
        return {
          outcome: "applied" as const,
          driveStateId: input.driveStateId,
          pressure: input.level === "partial" ? 0.2 : 0,
          phase: input.level === "partial" ? "active" as const : "satisfied" as const,
          satisfactionTotal: input.level === "partial" ? 0.2 : 1,
        };
      },
    },
    {
      async resolve(input) {
        curiosityCalls.push(input);
        return {
          outcome: "applied" as const,
          curiosityStateId: input.curiosityStateId,
          resolvedAt: input.now,
          resolutionSourceId: input.resolutionSourceId,
          updatedStates: 1,
        };
      },
    },
    "G",
    () => "2026-09-27T00:30:00.000Z",
  );

  const satisfy = await executor.execute({
    userId,
    conversationId,
    assistantMessageId,
    prepareId,
    actionIndex: 0,
    action: {
      kind: "mind_satisfy",
      stateId: driveStateId,
      level: "partial",
      sourceStart: 0,
      sourceEnd: 1,
      raw: "x",
    },
  });
  const resolve = await executor.execute({
    userId,
    conversationId,
    assistantMessageId,
    prepareId,
    actionIndex: 1,
    action: {
      kind: "mind_resolve",
      stateId: curiosityStateId,
      sourceStart: 2,
      sourceEnd: 3,
      raw: "y",
    },
  });

  assert.equal(satisfy.outcome, "applied");
  assert.equal(resolve.outcome, "applied");
  assert.deepEqual(driveCalls, [{
    userId,
    subjectId: "G",
    driveStateId,
    level: "partial",
    idempotencyKey: nativeLiveMindSemanticActionIdempotencyKey(prepareId, 0),
    evidence: {
      kind: "assistant_message",
      conversationId,
      messageId: assistantMessageId,
    },
    now: "2026-09-27T00:30:00.000Z",
  }]);
  assert.deepEqual(curiosityCalls, [{
    userId,
    subjectId: "G",
    curiosityStateId,
    conversationId,
    resolutionSourceId: assistantMessageId,
    idempotencyKey: nativeLiveMindSemanticActionIdempotencyKey(prepareId, 1),
    now: "2026-09-27T00:30:00.000Z",
  }]);
});

test("deterministic semantic action rejection is a receipt, not an endlessly retried exception", async () => {
  const executor = new NativeLiveMindSemanticActionExecutor(
    {
      async satisfySemantic() {
        return { outcome: "rejected" as const, code: "DRIVE_NOT_ELIGIBLE" as const };
      },
    },
    {
      async resolve() {
        return { outcome: "rejected" as const, code: "CURIOSITY_NOT_ACTIVE" as const };
      },
    },
    "G",
    () => "2026-09-27T00:30:00.000Z",
  );

  const receipt = await executor.execute({
    userId,
    conversationId,
    assistantMessageId,
    prepareId,
    actionIndex: 0,
    action: {
      kind: "mind_satisfy",
      stateId: driveStateId,
      level: "full",
      sourceStart: 0,
      sourceEnd: 1,
      raw: "x",
    },
  });
  assert.deepEqual(receipt, {
    actionIndex: 0,
    kind: "mind_satisfy",
    stateId: driveStateId,
    outcome: "rejected",
    code: "DRIVE_NOT_ELIGIBLE",
  });
});


test("Drive semantic satisfaction maps partial/full meaning through Runtime policy instead of model-authored numbers", async () => {
  const amounts: number[] = [];
  const evolutionPort = {
    async listCandidates() {
      return [];
    },
    async applyUpdates() {
      return { applied: 0, conflicts: 0 };
    },
  };
  const satisfactionPort = {
    async applySatisfaction(input: { amount: number; driveStateId: string }) {
      amounts.push(input.amount);
      return {
        outcome: "applied" as const,
        driveStateId: input.driveStateId,
        pressure: 0,
        phase: "satisfied" as const,
        satisfactionTotal: input.amount,
      };
    },
  };
  const service = new DriveSatisfactionService(
    evolutionPort,
    satisfactionPort,
    {
      basePressure: 0.4,
      reinforcementBoost: 0.2,
      activeThreshold: 0.1,
      dormantAfterSatisfiedHours: 168,
      minEvolutionIntervalHours: 6,
      maxReinforcementSources: 16,
    },
  );
  const base = {
    userId,
    subjectId: "G",
    driveStateId,
    evidence: {
      kind: "assistant_message" as const,
      conversationId,
      messageId: assistantMessageId,
    },
    now: "2026-09-27T00:30:00.000Z",
  };

  await service.satisfySemantic({
    ...base,
    level: "partial",
    idempotencyKey: "semantic-partial-0001",
  });
  await service.satisfySemantic({
    ...base,
    level: "full",
    idempotencyKey: "semantic-full-0000001",
  });

  assert.deepEqual(amounts, [0.2, 1]);
});


test("durable Drive satisfaction stays applied when derived post-projection refresh fails", async () => {
  let evolutionRuns = 0;
  const service = new DriveSatisfactionService(
    {
      async listCandidates() {
        evolutionRuns += 1;
        if (evolutionRuns > 1) {
          throw new Error("derived refresh unavailable");
        }
        return [];
      },
      async applyUpdates() {
        return { applied: 0, conflicts: 0 };
      },
    },
    {
      async applySatisfaction(input) {
        return {
          outcome: "applied" as const,
          driveStateId: input.driveStateId,
          pressure: 0,
          phase: "satisfied" as const,
          satisfactionTotal: input.amount,
        };
      },
    },
    {
      basePressure: 0.4,
      reinforcementBoost: 0.2,
      activeThreshold: 0.1,
      dormantAfterSatisfiedHours: 168,
      minEvolutionIntervalHours: 6,
      maxReinforcementSources: 16,
    },
  );

  const result = await service.satisfySemantic({
    userId,
    subjectId: "G",
    driveStateId,
    level: "full",
    idempotencyKey: "semantic-refresh-0001",
    evidence: {
      kind: "assistant_message",
      conversationId,
      messageId: assistantMessageId,
    },
    now: "2026-09-27T00:30:00.000Z",
  });

  assert.equal(result.outcome, "applied");
  assert.equal(evolutionRuns, 2);
});
