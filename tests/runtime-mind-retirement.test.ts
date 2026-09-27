import assert from "node:assert/strict";
import test from "node:test";
import {
  MindRetirementService,
  planMindRetirement,
  selectRetirableThreadMembers,
  type MindRetirementCandidate,
  type MindRetirementPlan,
  type MindRetirementRuntimePort,
} from "../src/domains/runtime/mind-retirement.js";
import {
  writeDriveEvolution,
} from "../src/domains/runtime/drive-evolution.js";
import {
  writeThoughtEvolution,
} from "../src/domains/runtime/thought-evolution.js";
import {
  writeCuriosityEvolution,
} from "../src/domains/runtime/curiosity-evolution.js";
import {
  writeTopicEvolution,
} from "../src/domains/runtime/topic-evolution.js";

function candidate(
  stateId: string,
  kind: MindRetirementCandidate["kind"],
  payload: Record<string, unknown>,
  updatedAt = "2026-09-20T00:00:00.000Z",
): MindRetirementCandidate {
  return { stateId, kind, payload, updatedAt };
}

const driveAnchorId = "11111111-1111-4111-8111-111111111111";
const driveThreadKey = "drive-thread";
const dormantDrive = writeDriveEvolution(null, {
  phase: "dormant",
  role: "anchor",
  threadKey: driveThreadKey,
  anchorStateId: driveAnchorId,
  pressure: 0,
  reinforcementCount: 1,
  reinforcementSources: ["m1"],
  satisfactionTotal: 1,
  lastEvolvedAt: "2026-09-20T00:00:00.000Z",
  lastReinforcedAt: "2026-09-19T00:00:00.000Z",
  lastSatisfiedAt: "2026-09-19T00:00:00.000Z",
  dormantAt: "2026-09-20T00:00:00.000Z",
});

test("retirement remains disabled for a kind without an explicit retention rule", () => {
  assert.equal(
    planMindRetirement(
      candidate(driveAnchorId, "drive", dormantDrive),
      "2026-10-20T00:00:00.000Z",
      {},
    ),
    null,
  );
});

test("dormant Drive becomes eligible only at the exact configured retention boundary", () => {
  const policy = { drive: { retentionHours: 168 } };
  assert.equal(
    planMindRetirement(
      candidate(driveAnchorId, "drive", dormantDrive),
      "2026-09-26T23:59:59.999Z",
      policy,
    ),
    null,
  );
  const plan = planMindRetirement(
    candidate(driveAnchorId, "drive", dormantDrive),
    "2026-09-27T00:00:00.000Z",
    policy,
  );
  assert.deepEqual(plan, {
    kind: "drive",
    anchorStateId: driveAnchorId,
    threadKey: driveThreadKey,
    terminalAt: "2026-09-20T00:00:00.000Z",
    retentionHours: 168,
    expectedUpdatedAt: "2026-09-20T00:00:00.000Z",
  });
});

test("reinforcement copies and non-terminal phases can never initiate retirement", () => {
  const reinforcement = writeDriveEvolution(null, {
    ...dormantDrive.drive_v1 as any,
    role: "reinforcement",
  });
  assert.equal(
    planMindRetirement(
      candidate(
        "22222222-2222-4222-8222-222222222222",
        "drive",
        reinforcement,
      ),
      "2026-10-01T00:00:00.000Z",
      { drive: { retentionHours: 24 } },
    ),
    null,
  );

  const activeThought = writeThoughtEvolution(null, {
    phase: "active",
    role: "anchor",
    threadKey: "thought-thread",
    anchorStateId: "33333333-3333-4333-8333-333333333333",
    strength: 0.2,
    reinforcementCount: 1,
    reinforcementSources: ["m1"],
    lastEvolvedAt: "2026-09-01T00:00:00.000Z",
    lastReinforcedAt: "2026-09-01T00:00:00.000Z",
    dormantAt: null,
  });
  assert.equal(
    planMindRetirement(
      candidate(
        "33333333-3333-4333-8333-333333333333",
        "thought",
        activeThought,
      ),
      "2026-10-01T00:00:00.000Z",
      { thought: { retentionHours: 24 } },
    ),
    null,
  );
});

test("Curiosity uses resolvedAt while resolved and dormantAt after dormancy", () => {
  const id = "44444444-4444-4444-8444-444444444444";
  const resolved = writeCuriosityEvolution(null, {
    phase: "resolved",
    role: "anchor",
    threadKey: "curiosity-thread",
    anchorStateId: id,
    reinforcementCount: 1,
    reinforcementSources: ["m1"],
    lastEvolvedAt: "2026-09-20T00:00:00.000Z",
    lastReinforcedAt: "2026-09-19T00:00:00.000Z",
    resolvedAt: "2026-09-20T00:00:00.000Z",
    resolutionSourceId: "answer-1",
    dormantAt: null,
  });
  const dormant = writeCuriosityEvolution(null, {
    ...(resolved.curiosity_v1 as any),
    phase: "dormant",
    dormantAt: "2026-09-27T00:00:00.000Z",
  });

  assert.equal(
    planMindRetirement(
      candidate(id, "curiosity", resolved),
      "2026-09-21T00:00:00.000Z",
      { curiosity: { retentionHours: 24 } },
    )?.terminalAt,
    "2026-09-20T00:00:00.000Z",
  );
  assert.equal(
    planMindRetirement(
      candidate(id, "curiosity", dormant),
      "2026-09-28T00:00:00.000Z",
      { curiosity: { retentionHours: 24 } },
    )?.terminalAt,
    "2026-09-27T00:00:00.000Z",
  );
});

test("thread retirement is all-or-nothing when any current member is no longer terminal", () => {
  const reinforcementId = "55555555-5555-4555-8555-555555555555";
  const dormantReinforcement = writeDriveEvolution(null, {
    ...(dormantDrive.drive_v1 as any),
    role: "reinforcement",
  });
  const activeReinforcement = writeDriveEvolution(null, {
    ...(dormantDrive.drive_v1 as any),
    role: "reinforcement",
    phase: "active",
    pressure: 0.4,
    dormantAt: null,
  });
  const plan: MindRetirementPlan = {
    kind: "drive",
    anchorStateId: driveAnchorId,
    threadKey: driveThreadKey,
    terminalAt: "2026-09-20T00:00:00.000Z",
    retentionHours: 168,
    expectedUpdatedAt: "2026-09-20T00:00:00.000Z",
  };

  assert.deepEqual(
    selectRetirableThreadMembers(
      [
        candidate(driveAnchorId, "drive", dormantDrive),
        candidate(reinforcementId, "drive", dormantReinforcement),
      ],
      plan,
      "2026-09-27T00:00:00.000Z",
    ),
    [driveAnchorId, reinforcementId],
  );

  assert.equal(
    selectRetirableThreadMembers(
      [
        candidate(driveAnchorId, "drive", dormantDrive),
        candidate(reinforcementId, "drive", activeReinforcement),
      ],
      plan,
      "2026-09-27T00:00:00.000Z",
    ),
    null,
  );
});

class Port implements MindRetirementRuntimePort {
  retired: MindRetirementPlan[] = [];

  constructor(
    readonly candidates: MindRetirementCandidate[],
    readonly outcome: "retired" | "conflict" = "retired",
  ) {}

  async listCandidates() {
    return this.candidates;
  }

  async retireThread(input: MindRetirementPlan) {
    this.retired.push(input);
    return this.outcome === "retired"
      ? { outcome: "retired" as const, deleted: 2 }
      : { outcome: "conflict" as const, deleted: 0 };
  }
}

test("retirement runner is deterministic, bounded, and reports conflicts without retrying in-process", async () => {
  const port = new Port([
    candidate(driveAnchorId, "drive", dormantDrive),
  ]);
  const service = new MindRetirementService(port, {
    drive: { retentionHours: 168 },
  });
  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-27T00:00:00.000Z",
    limit: 10,
  });

  assert.deepEqual(result, {
    scanned: 1,
    eligible: 1,
    retiredThreads: 1,
    deletedStates: 2,
    conflicts: 0,
  });
  assert.equal(port.retired.length, 1);
});

test("Thought Topic terminal timestamps are respected", () => {
  const thoughtId = "66666666-6666-4666-8666-666666666666";
  const topicId = "77777777-7777-4777-8777-777777777777";
  const thought = writeThoughtEvolution(null, {
    phase: "dormant",
    role: "anchor",
    threadKey: "thought-thread",
    anchorStateId: thoughtId,
    strength: 0.05,
    reinforcementCount: 1,
    reinforcementSources: ["m1"],
    lastEvolvedAt: "2026-09-20T00:00:00.000Z",
    lastReinforcedAt: "2026-09-18T00:00:00.000Z",
    dormantAt: "2026-09-20T00:00:00.000Z",
  });
  const topic = writeTopicEvolution(null, {
    phase: "dormant",
    role: "anchor",
    threadKey: "topic-thread",
    anchorStateId: topicId,
    reinforcementCount: 1,
    reinforcementSources: ["m1"],
    lastEvolvedAt: "2026-09-20T00:00:00.000Z",
    lastReinforcedAt: "2026-09-18T00:00:00.000Z",
    dormantAt: "2026-09-20T00:00:00.000Z",
  });

  assert.ok(
    planMindRetirement(
      candidate(thoughtId, "thought", thought),
      "2026-09-21T00:00:00.000Z",
      { thought: { retentionHours: 24 } },
    ),
  );
  assert.ok(
    planMindRetirement(
      candidate(topicId, "topic", topic),
      "2026-09-21T00:00:00.000Z",
      { topic: { retentionHours: 24 } },
    ),
  );
});
