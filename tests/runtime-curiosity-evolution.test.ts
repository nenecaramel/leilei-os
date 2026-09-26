import assert from "node:assert/strict";
import test from "node:test";
import {
  CuriosityEvolutionService,
  curiosityThreadKey,
  readCuriosityEvolution,
  resolveCuriosityEvolution,
  writeCuriosityEvolution,
  type CuriosityEvolutionCandidate,
  type CuriosityEvolutionPolicy,
  type CuriosityEvolutionUpdate,
} from "../src/domains/runtime/curiosity-evolution.js";

const policy: CuriosityEvolutionPolicy = {
  maxReinforcementSources: 16,
  dormantAfterHours: 168,
};

function candidate(
  stateId: string,
  text: string,
  sourceId: string,
  createdAt: string,
  payload: Record<string, unknown> | null = null,
): CuriosityEvolutionCandidate {
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
  updates: CuriosityEvolutionUpdate[] = [];

  constructor(public candidates: CuriosityEvolutionCandidate[]) {}

  async listCandidates() {
    return this.candidates;
  }

  async applyUpdates(input: {
    updates: readonly CuriosityEvolutionUpdate[];
  }) {
    this.updates = [...input.updates];
    return {
      applied: input.updates.length,
      conflicts: 0,
    };
  }
}

test("new Curiosity initializes as one active exact-text thread", async () => {
  const port = new Port([
    candidate(
      "11111111-1111-4111-8111-111111111111",
      "为什么这个机制会重新活跃",
      "m1",
      "2026-09-26T12:00:00.000Z",
    ),
    candidate(
      "22222222-2222-4222-8222-222222222222",
      "  为什么这个机制会重新活跃  ",
      "m2",
      "2026-09-26T13:00:00.000Z",
    ),
  ]);
  const service = new CuriosityEvolutionService(port, policy);

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-26T13:01:00.000Z",
  });

  assert.equal(result.threads, 1);
  assert.equal(result.active, 1);
  assert.equal(result.initialized, 2);
  const anchor = port.updates.find(
    (update) => update.stateId === "11111111-1111-4111-8111-111111111111",
  );
  assert.equal(anchor?.evolution.phase, "active");
  assert.equal(anchor?.evolution.role, "anchor");
  assert.equal(anchor?.evolution.reinforcementCount, 2);
  assert.equal(anchor?.evolution.dormantAt, null);
  assert.equal(anchor?.evolution.resolvedAt, null);
  assert.equal(anchor?.evolution.resolutionSourceId, null);
});

test("active Curiosity becomes dormant after the configured inactivity window", async () => {
  const anchorId = "33333333-3333-4333-8333-333333333333";
  const payload = writeCuriosityEvolution(null, {
    phase: "active",
    role: "anchor",
    threadKey: curiosityThreadKey("why is this stale"),
    anchorStateId: anchorId,
    reinforcementCount: 1,
    reinforcementSources: ["m1"],
    lastEvolvedAt: "2026-09-26T12:00:00.000Z",
    lastReinforcedAt: "2026-09-26T12:00:00.000Z",
    resolvedAt: null,
    resolutionSourceId: null,
    dormantAt: null,
  });
  const port = new Port([
    candidate(
      anchorId,
      "why is this stale",
      "m1",
      "2026-09-26T12:00:00.000Z",
      payload,
    ),
  ]);
  const service = new CuriosityEvolutionService(port, policy);

  const before = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-10-03T11:59:59.000Z",
  });
  assert.equal(before.active, 1);
  assert.equal(before.dormant, 0);

  port.updates = [];
  const after = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-10-03T12:00:00.000Z",
  });
  assert.equal(after.active, 0);
  assert.equal(after.dormant, 1);
  assert.equal(after.dormantTransitions, 1);
  assert.equal(port.updates[0]?.reason, "dormant");
  assert.equal(port.updates[0]?.evolution.phase, "dormant");
  assert.equal(
    port.updates[0]?.evolution.dormantAt,
    "2026-10-03T12:00:00.000Z",
  );
});

test("new independent evidence reactivates a dormant Curiosity", async () => {
  const anchorId = "44444444-4444-4444-8444-444444444444";
  const payload = writeCuriosityEvolution(null, {
    phase: "dormant",
    role: "anchor",
    threadKey: curiosityThreadKey("why does it return"),
    anchorStateId: anchorId,
    reinforcementCount: 1,
    reinforcementSources: ["m1"],
    lastEvolvedAt: "2026-10-03T12:00:00.000Z",
    lastReinforcedAt: "2026-09-26T12:00:00.000Z",
    resolvedAt: null,
    resolutionSourceId: null,
    dormantAt: "2026-10-03T12:00:00.000Z",
  });
  const port = new Port([
    candidate(
      anchorId,
      "why does it return",
      "m1",
      "2026-09-26T12:00:00.000Z",
      payload,
    ),
    candidate(
      "55555555-5555-4555-8555-555555555555",
      "why does it return",
      "m2",
      "2026-10-04T12:00:00.000Z",
    ),
  ]);
  const service = new CuriosityEvolutionService(port, policy);

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-10-04T12:01:00.000Z",
  });

  assert.equal(result.active, 1);
  assert.equal(result.reactivated, 2);
  assert.equal(port.updates[0]?.evolution.phase, "active");
  assert.equal(port.updates[0]?.evolution.dormantAt, null);
  assert.equal(port.updates[0]?.evolution.reinforcementCount, 2);
});

test("duplicate source cannot reactivate a dormant Curiosity", async () => {
  const anchorId = "66666666-6666-4666-8666-666666666666";
  const payload = writeCuriosityEvolution(null, {
    phase: "dormant",
    role: "anchor",
    threadKey: curiosityThreadKey("same source curiosity"),
    anchorStateId: anchorId,
    reinforcementCount: 1,
    reinforcementSources: ["m1"],
    lastEvolvedAt: "2026-10-03T12:00:00.000Z",
    lastReinforcedAt: "2026-09-26T12:00:00.000Z",
    resolvedAt: null,
    resolutionSourceId: null,
    dormantAt: "2026-10-03T12:00:00.000Z",
  });
  const port = new Port([
    candidate(
      anchorId,
      "same source curiosity",
      "m1",
      "2026-09-26T12:00:00.000Z",
      payload,
    ),
    candidate(
      "77777777-7777-4777-8777-777777777777",
      "same source curiosity",
      "m1",
      "2026-10-04T12:00:00.000Z",
    ),
  ]);
  const service = new CuriosityEvolutionService(port, policy);

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-10-04T12:01:00.000Z",
  });

  assert.equal(result.active, 0);
  assert.equal(result.dormant, 1);
  assert.equal(result.reactivated, 0);
  const anchor = port.updates.find((update) => update.stateId === anchorId);
  assert.equal(anchor, undefined);
});

test("explicit resolution is the only path into resolved state", () => {
  const current = readCuriosityEvolution(writeCuriosityEvolution(null, {
    phase: "active",
    role: "anchor",
    threadKey: curiosityThreadKey("what closes this"),
    anchorStateId: "88888888-8888-4888-8888-888888888888",
    reinforcementCount: 1,
    reinforcementSources: ["m1"],
    lastEvolvedAt: "2026-09-26T12:00:00.000Z",
    lastReinforcedAt: "2026-09-26T12:00:00.000Z",
    resolvedAt: null,
    resolutionSourceId: null,
    dormantAt: null,
  }));
  assert.ok(current);

  const resolved = resolveCuriosityEvolution(current, {
    now: "2026-09-27T12:00:00.000Z",
    resolutionSourceId: "answer-message-1",
  });

  assert.equal(resolved.phase, "resolved");
  assert.equal(resolved.resolvedAt, "2026-09-27T12:00:00.000Z");
  assert.equal(resolved.resolutionSourceId, "answer-message-1");
  assert.equal(resolved.dormantAt, null);
});

test("resolved Curiosity later cools into dormant without losing resolution provenance", async () => {
  const anchorId = "99999999-9999-4999-8999-999999999999";
  const payload = writeCuriosityEvolution(null, {
    phase: "resolved",
    role: "anchor",
    threadKey: curiosityThreadKey("resolved curiosity"),
    anchorStateId: anchorId,
    reinforcementCount: 1,
    reinforcementSources: ["m1"],
    lastEvolvedAt: "2026-09-27T12:00:00.000Z",
    lastReinforcedAt: "2026-09-26T12:00:00.000Z",
    resolvedAt: "2026-09-27T12:00:00.000Z",
    resolutionSourceId: "answer-message-1",
    dormantAt: null,
  });
  const port = new Port([
    candidate(
      anchorId,
      "resolved curiosity",
      "m1",
      "2026-09-26T12:00:00.000Z",
      payload,
    ),
  ]);
  const service = new CuriosityEvolutionService(port, policy);

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-10-04T12:00:00.000Z",
  });

  assert.equal(result.resolved, 0);
  assert.equal(result.dormant, 1);
  assert.equal(port.updates[0]?.evolution.phase, "dormant");
  assert.equal(
    port.updates[0]?.evolution.resolutionSourceId,
    "answer-message-1",
  );
  assert.equal(
    port.updates[0]?.evolution.resolvedAt,
    "2026-09-27T12:00:00.000Z",
  );
});

test("new independent evidence can reopen a resolved Curiosity", async () => {
  const anchorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const payload = writeCuriosityEvolution(null, {
    phase: "resolved",
    role: "anchor",
    threadKey: curiosityThreadKey("resolved can reopen"),
    anchorStateId: anchorId,
    reinforcementCount: 1,
    reinforcementSources: ["m1"],
    lastEvolvedAt: "2026-09-27T12:00:00.000Z",
    lastReinforcedAt: "2026-09-26T12:00:00.000Z",
    resolvedAt: "2026-09-27T12:00:00.000Z",
    resolutionSourceId: "answer-message-1",
    dormantAt: null,
  });
  const port = new Port([
    candidate(
      anchorId,
      "resolved can reopen",
      "m1",
      "2026-09-26T12:00:00.000Z",
      payload,
    ),
    candidate(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "resolved can reopen",
      "m2",
      "2026-09-28T12:00:00.000Z",
    ),
  ]);
  const service = new CuriosityEvolutionService(port, policy);

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-28T12:01:00.000Z",
  });

  assert.equal(result.active, 1);
  assert.equal(result.reactivated, 2);
  const anchor = port.updates.find((update) => update.stateId === anchorId);
  assert.equal(anchor?.evolution.phase, "active");
  assert.equal(anchor?.evolution.resolvedAt, null);
  assert.equal(anchor?.evolution.resolutionSourceId, null);
});

test("settlement catch-up initializes and reactivates Curiosity but never performs time-only dormancy", async () => {
  const anchorId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const payload = writeCuriosityEvolution(null, {
    phase: "active",
    role: "anchor",
    threadKey: curiosityThreadKey("old active curiosity"),
    anchorStateId: anchorId,
    reinforcementCount: 1,
    reinforcementSources: ["m1"],
    lastEvolvedAt: "2026-09-20T12:00:00.000Z",
    lastReinforcedAt: "2026-09-20T12:00:00.000Z",
    resolvedAt: null,
    resolutionSourceId: null,
    dormantAt: null,
  });
  const port = new Port([
    candidate(
      anchorId,
      "old active curiosity",
      "m1",
      "2026-09-20T12:00:00.000Z",
      payload,
    ),
    candidate(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      "fresh curiosity",
      "m2",
      "2026-10-20T12:00:00.000Z",
    ),
  ]);
  const service = new CuriosityEvolutionService(port, policy);

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-10-20T12:00:00.000Z",
    mode: "settlement_catch_up",
  });

  assert.equal(result.dormantTransitions, 0);
  assert.deepEqual(
    port.updates.map((update) => [update.stateId, update.reason]),
    [["dddddddd-dddd-4ddd-8ddd-dddddddddddd", "initialize"]],
  );
});
