import assert from "node:assert/strict";
import test from "node:test";
import {
  MindRetirementPreviewService,
} from "../src/domains/runtime/mind-retirement-preview.js";
import type {
  MindRetirementCandidate,
  MindRetirementRuntimePort,
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

const NOW = "2026-09-27T00:00:00.000Z";

function candidate(
  stateId: string,
  kind: MindRetirementCandidate["kind"],
  payload: Record<string, unknown> | null,
): MindRetirementCandidate {
  return {
    stateId,
    kind,
    payload,
    updatedAt: "2026-09-27T00:00:00.000Z",
  };
}

class PreviewPort implements Pick<MindRetirementRuntimePort, "listCandidates"> {
  constructor(readonly candidates: MindRetirementCandidate[]) {}

  async listCandidates(input: { limit: number }) {
    return this.candidates.slice(0, input.limit);
  }
}

function findKind(
  result: Awaited<ReturnType<MindRetirementPreviewService["preview"]>>,
  kind: MindRetirementCandidate["kind"],
) {
  const found = result.kinds.find((entry) => entry.kind === kind);
  assert.ok(found);
  return found;
}

test("preview reports aggregate terminal ages and retention windows without state identity", async () => {
  const driveDormantId = "11111111-1111-4111-8111-111111111111";
  const driveActiveId = "22222222-2222-4222-8222-222222222222";
  const thoughtId = "33333333-3333-4333-8333-333333333333";
  const curiosityId = "44444444-4444-4444-8444-444444444444";
  const topicId = "55555555-5555-4555-8555-555555555555";
  const malformedTopicId = "66666666-6666-4666-8666-666666666666";

  const candidates: MindRetirementCandidate[] = [
    candidate(
      driveDormantId,
      "drive",
      writeDriveEvolution(null, {
        phase: "dormant",
        role: "anchor",
        threadKey: "drive-dormant",
        anchorStateId: driveDormantId,
        pressure: 0,
        reinforcementCount: 1,
        reinforcementSources: ["m1"],
        satisfactionTotal: 1,
        lastEvolvedAt: "2026-09-07T00:00:00.000Z",
        lastReinforcedAt: "2026-09-06T00:00:00.000Z",
        lastSatisfiedAt: "2026-09-06T00:00:00.000Z",
        dormantAt: "2026-09-07T00:00:00.000Z",
      }),
    ),
    candidate(
      driveActiveId,
      "drive",
      writeDriveEvolution(null, {
        phase: "active",
        role: "anchor",
        threadKey: "drive-active",
        anchorStateId: driveActiveId,
        pressure: 0.4,
        reinforcementCount: 1,
        reinforcementSources: ["m2"],
        satisfactionTotal: 0,
        lastEvolvedAt: "2026-09-26T00:00:00.000Z",
        lastReinforcedAt: "2026-09-26T00:00:00.000Z",
        lastSatisfiedAt: null,
        dormantAt: null,
      }),
    ),
    candidate(
      thoughtId,
      "thought",
      writeThoughtEvolution(null, {
        phase: "dormant",
        role: "anchor",
        threadKey: "thought-dormant",
        anchorStateId: thoughtId,
        strength: 0.05,
        reinforcementCount: 1,
        reinforcementSources: ["m3"],
        lastEvolvedAt: "2026-08-16T08:00:00.000Z",
        lastReinforcedAt: "2026-08-15T00:00:00.000Z",
        dormantAt: "2026-08-16T08:00:00.000Z",
      }),
    ),
    candidate(
      curiosityId,
      "curiosity",
      writeCuriosityEvolution(null, {
        phase: "resolved",
        role: "anchor",
        threadKey: "curiosity-resolved",
        anchorStateId: curiosityId,
        reinforcementCount: 1,
        reinforcementSources: ["m4"],
        lastEvolvedAt: "2026-09-22T20:00:00.000Z",
        lastReinforcedAt: "2026-09-22T00:00:00.000Z",
        resolvedAt: "2026-09-22T20:00:00.000Z",
        resolutionSourceId: "answer-1",
        dormantAt: null,
      }),
    ),
    candidate(
      topicId,
      "topic",
      writeTopicEvolution(null, {
        phase: "dormant",
        role: "anchor",
        threadKey: "topic-dormant",
        anchorStateId: topicId,
        reinforcementCount: 1,
        reinforcementSources: ["m5"],
        lastEvolvedAt: "2026-03-02T16:00:00.000Z",
        lastReinforcedAt: "2026-03-01T00:00:00.000Z",
        dormantAt: "2026-03-02T16:00:00.000Z",
      }),
    ),
    candidate(
      malformedTopicId,
      "topic",
      { topic_v1: { role: "anchor" } },
    ),
  ];

  const result = await new MindRetirementPreviewService(
    new PreviewPort(candidates),
  ).preview({
    userId: "u1",
    subjectId: "G",
    now: NOW,
  });

  assert.equal(result.scannedAnchors, 6);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.retentionHours, [168, 336, 720, 2160, 4320]);

  const drive = findKind(result, "drive");
  assert.equal(drive.scannedAnchors, 2);
  assert.equal(drive.terminalAnchors, 1);
  assert.equal(drive.nonTerminalAnchors, 1);
  assert.equal(drive.unreadableAnchors, 0);
  assert.deepEqual(drive.terminalAgeHours, {
    min: 480,
    p50: 480,
    p90: 480,
    max: 480,
  });
  assert.deepEqual(
    drive.eligibleByRetention.map((entry) => entry.threads),
    [1, 1, 0, 0, 0],
  );

  const thought = findKind(result, "thought");
  assert.deepEqual(thought.terminalAgeHours, {
    min: 1000,
    p50: 1000,
    p90: 1000,
    max: 1000,
  });
  assert.deepEqual(
    thought.eligibleByRetention.map((entry) => entry.threads),
    [1, 1, 1, 0, 0],
  );

  const curiosity = findKind(result, "curiosity");
  assert.deepEqual(curiosity.terminalAgeHours, {
    min: 100,
    p50: 100,
    p90: 100,
    max: 100,
  });
  assert.deepEqual(
    curiosity.eligibleByRetention.map((entry) => entry.threads),
    [0, 0, 0, 0, 0],
  );

  const topic = findKind(result, "topic");
  assert.equal(topic.scannedAnchors, 2);
  assert.equal(topic.terminalAnchors, 1);
  assert.equal(topic.unreadableAnchors, 1);
  assert.deepEqual(topic.terminalAgeHours, {
    min: 5000,
    p50: 5000,
    p90: 5000,
    max: 5000,
  });
  assert.deepEqual(
    topic.eligibleByRetention.map((entry) => entry.threads),
    [1, 1, 1, 1, 1],
  );

  const serialized = JSON.stringify(result);
  for (const stateId of [
    driveDormantId,
    driveActiveId,
    thoughtId,
    curiosityId,
    topicId,
    malformedTopicId,
  ]) {
    assert.equal(serialized.includes(stateId), false);
  }
  assert.equal(serialized.includes("drive-dormant"), false);
  assert.equal(serialized.includes("curiosity-resolved"), false);
});

test("preview detects a bounded scan without exposing the overflow candidate", async () => {
  const firstId = "77777777-7777-4777-8777-777777777777";
  const secondId = "88888888-8888-4888-8888-888888888888";
  const payload = (id: string, threadKey: string) =>
    writeThoughtEvolution(null, {
      phase: "dormant",
      role: "anchor",
      threadKey,
      anchorStateId: id,
      strength: 0.05,
      reinforcementCount: 1,
      reinforcementSources: ["m"],
      lastEvolvedAt: "2026-09-20T00:00:00.000Z",
      lastReinforcedAt: "2026-09-19T00:00:00.000Z",
      dormantAt: "2026-09-20T00:00:00.000Z",
    });

  const result = await new MindRetirementPreviewService(
    new PreviewPort([
      candidate(firstId, "thought", payload(firstId, "first-thread")),
      candidate(secondId, "thought", payload(secondId, "second-thread")),
    ]),
  ).preview({
    userId: "u1",
    subjectId: "G",
    now: NOW,
    limit: 1,
  });

  assert.equal(result.scannedAnchors, 1);
  assert.equal(result.truncated, true);
  assert.equal(findKind(result, "thought").scannedAnchors, 1);
  assert.equal(JSON.stringify(result).includes(secondId), false);
});

test("preview validates retention horizons and remains read-only", async () => {
  const port = new PreviewPort([]);
  const service = new MindRetirementPreviewService(port);

  await assert.rejects(
    service.preview({
      userId: "u1",
      subjectId: "G",
      now: NOW,
      retentionHours: [168, 0],
    }),
    /retention horizons must be positive/,
  );

  const result = await service.preview({
    userId: "u1",
    subjectId: "G",
    now: NOW,
    retentionHours: [720, 168, 168],
  });
  assert.deepEqual(result.retentionHours, [168, 720]);
  assert.equal(result.scannedAnchors, 0);
});
