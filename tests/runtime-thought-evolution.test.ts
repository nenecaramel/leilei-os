import assert from "node:assert/strict";
import test from "node:test";
import {
  ThoughtEvolutionService,
  readThoughtEvolution,
  thoughtThreadKey,
  type ThoughtEvolutionCandidate,
  type ThoughtEvolutionPolicy,
  type ThoughtEvolutionUpdate,
  writeThoughtEvolution,
} from "../src/domains/runtime/thought-evolution.js";
import type {
  MindSemanticGroupingService,
} from "../src/domains/runtime/mind-semantic-grouping.js";

const policy: ThoughtEvolutionPolicy = {
  halfLifeHours: 168,
  baseStrength: 0.35,
  reinforcementBoost: 0.25,
  dormantBelowStrength: 0.1,
  minEvolutionIntervalHours: 6,
  maxReinforcementSources: 16,
};

function candidate(
  stateId: string,
  text: string,
  sourceId: string,
  createdAt: string,
  payload: Record<string, unknown> | null = null,
): ThoughtEvolutionCandidate {
  return {
    stateId,
    text,
    sourceId,
    createdAt,
    updatedAt: createdAt,
    payload,
  };
}

class Port {
  updates: ThoughtEvolutionUpdate[] = [];

  constructor(
    public candidates: ThoughtEvolutionCandidate[],
  ) {}

  async listCandidates() {
    return this.candidates;
  }

  async applyUpdates(input: {
    updates: readonly ThoughtEvolutionUpdate[];
  }) {
    this.updates = [...input.updates];
    return {
      applied: input.updates.length,
      conflicts: 0,
    };
  }
}

test("a single settled Thought decays by its half-life", async () => {
  const port = new Port([
    candidate(
      "11111111-1111-4111-8111-111111111111",
      "I want to understand this more deeply",
      "source-1",
      "2026-09-22T00:00:00.000Z",
    ),
  ]);
  const service = new ThoughtEvolutionService(port, policy);

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-29T00:00:00.000Z",
  });

  assert.equal(result.initialized, 1);
  assert.equal(port.updates.length, 1);
  const evolution = port.updates[0]?.evolution;
  assert.equal(evolution?.role, "anchor");
  assert.equal(evolution?.reinforcementCount, 1);
  assert.ok(Math.abs((evolution?.strength ?? 0) - 0.175) < 1e-9);
});

test("independent repeats reinforce one Thought thread without promoting a separate stage", async () => {
  const port = new Port([
    candidate(
      "11111111-1111-4111-8111-111111111111",
      "I keep wondering how memory changes identity",
      "message-1",
      "2026-09-22T10:00:00.000Z",
    ),
    candidate(
      "22222222-2222-4222-8222-222222222222",
      "  I keep wondering how memory changes identity  ",
      "message-2",
      "2026-09-22T11:00:00.000Z",
    ),
    candidate(
      "33333333-3333-4333-8333-333333333333",
      "I KEEP WONDERING HOW MEMORY CHANGES IDENTITY",
      "message-3",
      "2026-09-22T12:00:00.000Z",
    ),
  ]);
  const service = new ThoughtEvolutionService(port, policy);

  await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-22T12:00:00.000Z",
  });

  assert.equal(port.updates.length, 3);
  const anchor = port.updates.find(
    (update) => update.stateId === "11111111-1111-4111-8111-111111111111",
  );
  assert.equal(anchor?.evolution.role, "anchor");
  assert.equal(anchor?.evolution.reinforcementCount, 3);
  assert.equal(anchor?.evolution.strength, 0.85);
  assert.equal(
    anchor?.evolution.threadKey,
    thoughtThreadKey("I keep wondering how memory changes identity"),
  );
  assert.equal("stage" in (anchor?.evolution ?? {}), false);

  const reinforcement = port.updates.find(
    (update) => update.stateId === "33333333-3333-4333-8333-333333333333",
  );
  assert.equal(reinforcement?.evolution.role, "reinforcement");
  assert.equal(
    reinforcement?.evolution.anchorStateId,
    "11111111-1111-4111-8111-111111111111",
  );
});

test("duplicate Thought writes from one source count as one reinforcement", async () => {
  const port = new Port([
    candidate(
      "11111111-1111-4111-8111-111111111111",
      "same thought",
      "message-1",
      "2026-09-22T10:00:00.000Z",
    ),
    candidate(
      "22222222-2222-4222-8222-222222222222",
      "same thought",
      "message-1",
      "2026-09-22T10:00:01.000Z",
    ),
    candidate(
      "33333333-3333-4333-8333-333333333333",
      "same thought",
      "message-2",
      "2026-09-22T11:00:00.000Z",
    ),
  ]);
  const service = new ThoughtEvolutionService(port, policy);

  await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-22T11:00:00.000Z",
  });

  assert.equal(port.updates[0]?.evolution.reinforcementCount, 2);
  assert.equal(port.updates[0]?.evolution.strength, 0.6);
});

test("legacy Fixation payload fields are ignored and Thought strength can decay again", async () => {
  const legacyPayload = {
    thought_v1: {
      stage: "fixation",
      role: "anchor",
      threadKey: thoughtThreadKey("sticky thought"),
      anchorStateId: "11111111-1111-4111-8111-111111111111",
      strength: 0.35,
      reinforcementCount: 1,
      reinforcementSources: ["m1"],
      lastEvolvedAt: "2026-09-22T12:00:00.000Z",
      lastReinforcedAt: "2026-09-22T12:00:00.000Z",
      fixationAt: "2026-09-22T12:00:00.000Z",
    },
  };
  const parsed = readThoughtEvolution(legacyPayload);
  assert.ok(parsed);
  assert.equal("stage" in parsed, false);
  assert.equal("fixationAt" in parsed, false);

  const port = new Port([
    candidate(
      "11111111-1111-4111-8111-111111111111",
      "sticky thought",
      "m1",
      "2026-09-22T12:00:00.000Z",
      legacyPayload,
    ),
  ]);
  const service = new ThoughtEvolutionService(port, policy);

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-29T12:00:00.000Z",
  });

  assert.equal(result.decayed, 1);
  assert.equal(port.updates.length, 1);
  assert.ok(Math.abs((port.updates[0]?.evolution.strength ?? 0) - 0.175) < 1e-9);
  assert.equal("stage" in (port.updates[0]?.evolution ?? {}), false);
});


test("active Thought becomes dormant when decay drops strength below the configured threshold", async () => {
  const anchorId = "44444444-4444-4444-8444-444444444444";
  const payload = {
    thought_v1: {
      phase: "active",
      role: "anchor",
      threadKey: thoughtThreadKey("a thought that is fading"),
      anchorStateId: anchorId,
      strength: 0.175,
      reinforcementCount: 1,
      reinforcementSources: ["m1"],
      lastEvolvedAt: "2026-09-29T00:00:00.000Z",
      lastReinforcedAt: "2026-09-22T00:00:00.000Z",
      dormantAt: null,
    },
  };
  const port = new Port([
    candidate(
      anchorId,
      "a thought that is fading",
      "m1",
      "2026-09-22T00:00:00.000Z",
      payload,
    ),
  ]);
  const service = new ThoughtEvolutionService(port, policy);

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-10-06T00:00:01.000Z",
  });

  assert.equal(result.active, 0);
  assert.equal(result.dormant, 1);
  assert.equal(result.dormantTransitions, 1);
  assert.equal(port.updates[0]?.reason, "dormant");
  assert.equal(port.updates[0]?.evolution.phase, "dormant");
  assert.equal(
    port.updates[0]?.evolution.dormantAt,
    "2026-10-06T00:00:01.000Z",
  );
  assert.ok((port.updates[0]?.evolution.strength ?? 1) < 0.1);
});

test("new independent reinforcement reactivates a dormant Thought", async () => {
  const anchorId = "55555555-5555-4555-8555-555555555555";
  const payload = {
    thought_v1: {
      phase: "dormant",
      role: "anchor",
      threadKey: thoughtThreadKey("a thought that can return"),
      anchorStateId: anchorId,
      strength: 0.08,
      reinforcementCount: 1,
      reinforcementSources: ["m1"],
      lastEvolvedAt: "2026-10-06T00:00:00.000Z",
      lastReinforcedAt: "2026-09-22T00:00:00.000Z",
      dormantAt: "2026-10-06T00:00:00.000Z",
    },
  };
  const port = new Port([
    candidate(
      anchorId,
      "a thought that can return",
      "m1",
      "2026-09-22T00:00:00.000Z",
      payload,
    ),
    candidate(
      "66666666-6666-4666-8666-666666666666",
      "a thought that can return",
      "m2",
      "2026-10-07T00:00:00.000Z",
    ),
  ]);
  const service = new ThoughtEvolutionService(port, policy);

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-10-07T00:01:00.000Z",
  });

  assert.equal(result.active, 1);
  assert.equal(result.dormant, 0);
  assert.ok(result.reactivated >= 1);
  const anchor = port.updates.find((update) => update.stateId === anchorId);
  assert.equal(anchor?.reason, "reactivate");
  assert.equal(anchor?.evolution.phase, "active");
  assert.equal(anchor?.evolution.dormantAt, null);
  assert.ok((anchor?.evolution.strength ?? 0) >= 0.1);
});

test("duplicate source cannot reactivate a dormant Thought", async () => {
  const anchorId = "77777777-7777-4777-8777-777777777777";
  const payload = {
    thought_v1: {
      phase: "dormant",
      role: "anchor",
      threadKey: thoughtThreadKey("same source thought"),
      anchorStateId: anchorId,
      strength: 0.08,
      reinforcementCount: 1,
      reinforcementSources: ["m1"],
      lastEvolvedAt: "2026-10-06T00:00:00.000Z",
      lastReinforcedAt: "2026-09-22T00:00:00.000Z",
      dormantAt: "2026-10-06T00:00:00.000Z",
    },
  };
  const port = new Port([
    candidate(
      anchorId,
      "same source thought",
      "m1",
      "2026-09-22T00:00:00.000Z",
      payload,
    ),
    candidate(
      "88888888-8888-4888-8888-888888888888",
      "same source thought",
      "m1",
      "2026-10-07T00:00:00.000Z",
    ),
  ]);
  const service = new ThoughtEvolutionService(port, policy);

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-10-07T00:01:00.000Z",
  });

  assert.equal(result.active, 0);
  assert.equal(result.dormant, 1);
  const anchor = port.updates.find((update) => update.stateId === anchorId);
  assert.notEqual(anchor?.reason, "reactivate");
  assert.equal(anchor?.evolution.phase, "dormant");
  assert.equal(
    anchor?.evolution.dormantAt,
    "2026-10-06T00:00:00.000Z",
  );
});

test("Thought dormancy remains disabled when no threshold is configured", async () => {
  const anchorId = "99999999-9999-4999-8999-999999999999";
  const payload = {
    thought_v1: {
      role: "anchor",
      threadKey: thoughtThreadKey("legacy active thought"),
      anchorStateId: anchorId,
      strength: 0.05,
      reinforcementCount: 1,
      reinforcementSources: ["m1"],
      lastEvolvedAt: "2026-09-29T00:00:00.000Z",
      lastReinforcedAt: "2026-09-22T00:00:00.000Z",
    },
  };
  const parsed = readThoughtEvolution(payload);
  assert.equal(parsed?.phase, "active");
  assert.equal(parsed?.dormantAt, null);

  const port = new Port([
    candidate(
      anchorId,
      "legacy active thought",
      "m1",
      "2026-09-22T00:00:00.000Z",
      payload,
    ),
  ]);
  const service = new ThoughtEvolutionService(port, {
    halfLifeHours: 168,
    baseStrength: 0.35,
    reinforcementBoost: 0.25,
    minEvolutionIntervalHours: 6,
    maxReinforcementSources: 16,
  });

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-10-20T00:00:00.000Z",
  });

  assert.equal(result.active, 1);
  assert.equal(result.dormant, 0);
  assert.equal(port.updates[0]?.evolution.phase, "active");
});

test("Thought dormancy threshold rejects values outside (0, 1]", () => {
  for (const dormantBelowStrength of [0, 1.01]) {
    assert.throws(
      () => new ThoughtEvolutionService(new Port([]), {
        ...policy,
        dormantBelowStrength,
      }),
      /dormant-below strength must be in \(0, 1\]/,
    );
  }
});


test("Thought semantic grouping merges a paraphrase into an older persisted thread", async () => {
  const anchorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const anchorText = "I want to understand how memory changes identity";
  const anchorPayload = writeThoughtEvolution(null, {
    phase: "active",
    role: "anchor",
    threadKey: thoughtThreadKey(anchorText),
    anchorStateId: anchorId,
    strength: 0.35,
    reinforcementCount: 1,
    reinforcementSources: ["source-1"],
    lastEvolvedAt: "2026-09-27T00:00:00.000Z",
    lastReinforcedAt: "2026-09-27T00:00:00.000Z",
    dormantAt: null,
  });
  const paraphraseId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const paraphraseText = "I keep thinking about the way memories reshape who we are";
  const port = new Port([
    candidate(anchorId, anchorText, "source-1", "2026-09-27T00:00:00.000Z", anchorPayload),
    candidate(paraphraseId, paraphraseText, "source-2", "2026-09-27T01:00:00.000Z"),
  ]);
  const semanticGrouping = {
    async reconcile(input: Parameters<MindSemanticGroupingService["reconcile"]>[0]) {
      assert.equal(input.kind, "thought");
      return {
        canonicalThreadKeyByThread: new Map([
          [thoughtThreadKey(anchorText), thoughtThreadKey(anchorText)],
          [thoughtThreadKey(paraphraseText), thoughtThreadKey(anchorText)],
        ]),
        staged: 0,
      };
    },
  };
  const service = new ThoughtEvolutionService(
    port,
    policy,
    semanticGrouping,
  );

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-27T01:00:00.000Z",
  });

  assert.equal(result.threads, 1);
  const anchor = port.updates.find((update) => update.stateId === anchorId);
  const reinforcement = port.updates.find((update) => update.stateId === paraphraseId);
  assert.equal(anchor?.evolution.reinforcementCount, 2);
  assert.equal(reinforcement?.evolution.role, "reinforcement");
  assert.equal(reinforcement?.evolution.anchorStateId, anchorId);
  assert.equal(reinforcement?.evolution.threadKey, thoughtThreadKey(anchorText));
});
