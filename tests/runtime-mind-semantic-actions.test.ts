import assert from "node:assert/strict";
import test from "node:test";
import {
  parseMindSemanticActions,
} from "../src/domains/runtime/mind/mind-semantic-action.js";
import {
  NativeLiveMindSemanticActionExecutor,
} from "../src/domains/bridge/mind/native-live-mind-semantic-action.js";
import type {
  InitialContextManifest,
} from "../src/domains/runtime/context/context-invocation-contract.js";
import type {
  ThoughtDropResult,
} from "../src/domains/runtime/thought/thought-runtime-repository.js";

const userId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const assistantMessageId = "33333333-3333-4333-8333-333333333333";
const prepareId = "44444444-4444-4444-8444-444444444444";
const thoughtOne = "55555555-5555-4555-8555-555555555555";
const thoughtTwo = "66666666-6666-4666-8666-666666666666";

function manifest(): InitialContextManifest {
  const base = {
    type: "thought",
    authority: "data" as const,
    trustBoundary: "subject_state_data" as const,
    text: "t",
  };
  return {
    manifestId: prepareId,
    userId,
    subjectId: "G",
    conversationId,
    pathHeadMessageId: null,
    snapshotSequence: 0,
    assemblyVersion: "assembly-v2",
    promptContractVersion: "prompt-v5",
    createdAt: "2026-09-30T00:00:00.000Z",
    budget: {
      maxItems: 16,
      maxChars: 8000,
      usedItems: 2,
      usedChars: 2,
      overflowPolicy: "drop_lowest_rank",
    },
    items: [
      {
        ...base,
        id: `subject-state:${thoughtOne}`,
        sourceId: thoughtOne,
        alias: "T1",
        selection: { reason: "active_thought", rank: 150, truncated: false },
      },
      {
        ...base,
        id: `subject-state:${thoughtTwo}`,
        sourceId: thoughtTwo,
        alias: "T2",
        selection: { reason: "active_thought", rank: 151, truncated: false },
      },
    ],
  };
}

const action = (ref: string) => ({
  kind: "thought_drop" as const,
  ref,
  sourceStart: 0,
  sourceEnd: 1,
  raw: "x",
});

test("thought_drop parser extracts strict directives and leaves malformed ones visible", () => {
  const parsed = parseMindSemanticActions([
    "正文。",
    '<thought_drop ref="T1" />',
    '<thought_drop ref="t2"/>',
    '<thought_drop ref="X1" />',
    '<thought_drop ref="T0" />',
    '<thought_drop state_id="55555555-5555-4555-8555-555555555555" />',
    '<mind_satisfy state_id="55555555-5555-4555-8555-555555555555" level="full" />',
  ].join("\n"));

  assert.deepEqual(parsed.actions.map((item) => item.ref), ["T1", "T2"]);
  assert.equal(parsed.visibleText.includes('ref="T1"'), false);
  assert.equal(parsed.visibleText.includes('ref="t2"'), false);
  assert.equal(parsed.visibleText.includes('ref="X1"'), true);
  assert.equal(parsed.visibleText.includes('ref="T0"'), true);
  assert.equal(parsed.visibleText.includes("state_id"), true);
});

test("thought_drop resolves a turn-local label through the manifest, never through the model", async () => {
  const drops: unknown[] = [];
  const executor = new NativeLiveMindSemanticActionExecutor(
    { loadContextManifest: async () => manifest() },
    {
      async dropThought(input): Promise<ThoughtDropResult> {
        drops.push(input);
        return { outcome: "applied" };
      },
    },
    "G",
    () => "2026-09-30T01:00:00.000Z",
  );

  const receipt = await executor.execute({
    userId,
    conversationId,
    assistantMessageId,
    prepareId,
    actionIndex: 0,
    action: action("T2"),
  });

  assert.deepEqual(receipt, {
    actionIndex: 0,
    kind: "thought_drop",
    ref: "T2",
    stateId: thoughtTwo,
    outcome: "applied",
  });
  assert.deepEqual(drops, [{
    userId,
    subjectId: "G",
    stateId: thoughtTwo,
    droppedAt: "2026-09-30T01:00:00.000Z",
    droppedByMessageId: assistantMessageId,
  }]);
});

test("thought_drop keeps resolving the latest lineage alias when thoughts are not reinjected", async () => {
  const drops: unknown[] = [];
  const current = manifest();
  current.items = [];
  current.budget.usedItems = 0;
  current.budget.usedChars = 0;
  current.lineage = {
    epoch: 0,
    thoughtRevision: 4,
    thoughtFingerprint: "a".repeat(64),
    thoughtSnapshotEmitted: false,
    activeThoughtCount: 2,
    thoughtRefs: [
      { alias: "T1", stateId: thoughtOne },
      { alias: "T2", stateId: thoughtTwo },
    ],
  };

  const executor = new NativeLiveMindSemanticActionExecutor(
    { loadContextManifest: async () => current },
    {
      async dropThought(input): Promise<ThoughtDropResult> {
        drops.push(input);
        return { outcome: "applied" };
      },
    },
    "G",
    () => "2026-09-30T01:00:00.000Z",
  );

  const receipt = await executor.execute({
    userId,
    conversationId,
    assistantMessageId,
    prepareId,
    actionIndex: 0,
    action: action("T1"),
  });

  assert.equal(receipt.outcome, "applied");
  assert.equal(receipt.stateId, thoughtOne);
  assert.equal(
    (drops[0] as { stateId: string }).stateId,
    thoughtOne,
  );
});

test("thought_drop rejects a label that was not in front of the model that turn", async () => {
  let dropped = false;
  const executor = new NativeLiveMindSemanticActionExecutor(
    { loadContextManifest: async () => manifest() },
    {
      async dropThought(): Promise<ThoughtDropResult> {
        dropped = true;
        return { outcome: "applied" };
      },
    },
    "G",
  );

  const receipt = await executor.execute({
    userId,
    conversationId,
    assistantMessageId,
    prepareId,
    actionIndex: 0,
    action: action("T3"),
  });

  assert.equal(receipt.outcome, "rejected");
  assert.equal(receipt.code, "THOUGHT_REF_UNKNOWN");
  assert.equal(receipt.stateId, null);
  assert.equal(dropped, false);
});

test("thought_drop rejects when the manifest is missing or belongs to another conversation", async () => {
  const missing = new NativeLiveMindSemanticActionExecutor(
    { loadContextManifest: async () => null },
    { dropThought: async () => ({ outcome: "applied" }) },
    "G",
  );
  const foreign = new NativeLiveMindSemanticActionExecutor(
    {
      loadContextManifest: async () => ({
        ...manifest(),
        conversationId: "77777777-7777-4777-8777-777777777777",
      }),
    },
    { dropThought: async () => ({ outcome: "applied" }) },
    "G",
  );

  for (const executor of [missing, foreign]) {
    const receipt = await executor.execute({
      userId,
      conversationId,
      assistantMessageId,
      prepareId,
      actionIndex: 0,
      action: action("T1"),
    });
    assert.equal(receipt.outcome, "rejected");
    assert.equal(receipt.code, "MANIFEST_NOT_FOUND");
  }
});

test("thought_drop passes through repository rejections and idempotent replays", async () => {
  const outcomes: ThoughtDropResult[] = [
    { outcome: "idempotent" },
    { outcome: "rejected", code: "THOUGHT_NOT_SETTLED" },
  ];
  const executor = new NativeLiveMindSemanticActionExecutor(
    { loadContextManifest: async () => manifest() },
    { dropThought: async () => outcomes.shift()! },
    "G",
  );

  const replay = await executor.execute({
    userId, conversationId, assistantMessageId, prepareId,
    actionIndex: 0, action: action("T1"),
  });
  const rejected = await executor.execute({
    userId, conversationId, assistantMessageId, prepareId,
    actionIndex: 1, action: action("T1"),
  });

  assert.equal(replay.outcome, "idempotent");
  assert.equal(replay.stateId, thoughtOne);
  assert.equal(rejected.outcome, "rejected");
  assert.equal(rejected.code, "THOUGHT_NOT_SETTLED");
});


test("complete retired wrappers protect thought_drop directives", () => {
  for (const tag of ["drive", "curiosity", "topic", "dream"]) {
    const source = `<${tag}><thought_drop ref="T1" /></${tag}>`;
    const parsed = parseMindSemanticActions(source);
    assert.deepEqual(parsed.actions, [], source);
    assert.equal(parsed.visibleText, source);
  }
});

test("only thought_drop directives outside retired wrappers are extracted", () => {
  const wrapper = '<topic><curiosity><thought_drop ref="T1" /></curiosity><thought_drop ref="T2" /></topic>';
  const source = `${wrapper}<thought_drop ref="T3" />`;
  const parsed = parseMindSemanticActions(source);
  assert.deepEqual(parsed.actions.map(({ ref }) => ref), ["T3"]);
  assert.equal(parsed.actions[0]?.sourceStart, wrapper.length);
  assert.equal(parsed.visibleText, wrapper);
});
