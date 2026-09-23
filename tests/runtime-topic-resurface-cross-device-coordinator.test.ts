import assert from "node:assert/strict";
import test from "node:test";
import {
  TopicResurfaceCrossDeviceCoordinator,
} from "../src/domains/runtime/topic-resurface-cross-device-coordinator.js";

const candidate = {
  stateId: "11111111-1111-4111-8111-111111111111",
  text: "继续想这个边界",
  threadKey: "topic-thread",
  reinforcementCount: 2,
  lastReinforcedAt: "2026-09-20T00:00:00.000Z",
  dormantAt: "2026-09-23T00:00:00.000Z",
};

test("cross-device coordinator stages and consumes evaluate -> deliberate -> retention -> materialize", async () => {
  const jobs: any[] = [];
  const queue = {
    async stage(input: any) {
      const existing = jobs.find((job) => job.id === input.command.task_id);
      if (existing) return existing;
      const job = {
        id: input.command.task_id,
        userId: input.userId,
        subjectId: input.subjectId,
        workflow: input.workflow ?? null,
        command: input.command,
        status: "pending",
        reservedBy: null,
        resultText: null,
        errorCode: null,
        consumedAt: null,
      };
      jobs.push(job);
      return job;
    },
    async findOpenTopicResurface() {
      return jobs.find((job) =>
        job.workflow
        && (
          job.status === "pending"
          || job.status === "reserved"
          || job.consumedAt === null
        )
      ) ?? null;
    },
    async findNextUnconsumedTerminal() {
      return jobs.find((job) =>
        job.workflow
        && (job.status === "completed" || job.status === "failed")
        && job.consumedAt === null
      ) ?? null;
    },
    async markConsumed(input: any) {
      const job = jobs.find((item) => item.id === input.taskId);
      if (job) job.consumedAt = new Date();
    },
  };
  const materializeCalls: any[] = [];
  const coordinator = new TopicResurfaceCrossDeviceCoordinator(
    queue,
    {
      async list() {
        return { candidates: [candidate] };
      },
    },
    {
      async materialize(input) {
        materializeCalls.push(input);
        return {
          outcome: "materialized" as const,
          stateId: "22222222-2222-4222-8222-222222222222",
        };
      },
    },
    {
      ruleVersion: "topic-resurface-thought-v1",
      processVersion: "topic-resurface-thought-materialization-v1",
      deliberationPromptContractVersion:
        "topic-resurface-deliberation-v1",
      retentionPromptContractVersion:
        "topic-resurface-retention-v1",
      model: {
        provider: "claude_code",
        model: "runtime-selected",
        configVersion: "cross-device-v1",
        promptContractVersion: "topic-resurface-v1",
      },
    },
  );

  const started = await coordinator.start({
    userId: "user-1",
    subjectId: "G",
    now: "2026-09-23T03:00:00.000Z",
    candidateLimit: 5,
  });
  assert.equal(started.outcome, "staged_evaluation");
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].command.task_kind, "topic_resurface_evaluate");

  jobs[0].status = "completed";
  jobs[0].resultText = JSON.stringify({
    decision: "consider",
    state_id: candidate.stateId,
  });
  assert.equal(
    (await coordinator.advanceNextForUser({ userId: "user-1" })).outcome,
    "staged_deliberation",
  );
  assert.equal(jobs.length, 2);
  assert.ok(jobs[0].consumedAt);
  assert.equal(jobs[1].command.task_kind, "topic_resurface_deliberate");

  jobs[1].status = "completed";
  jobs[1].resultText = JSON.stringify({
    decision: "reflect",
    reflection: "内部思考与外部行动应该继续分层。",
  });
  assert.equal(
    (await coordinator.advanceNextForUser({ userId: "user-1" })).outcome,
    "staged_retention",
  );
  assert.equal(jobs.length, 3);
  assert.ok(jobs[1].consumedAt);

  jobs[2].status = "completed";
  jobs[2].resultText = JSON.stringify({
    decision: "retain_as_thought_seed",
  });
  const final = await coordinator.advanceNextForUser({
    userId: "user-1",
  });
  assert.deepEqual(final, {
    outcome: "materialized",
    runId: (started as any).runId,
    stateId: "22222222-2222-4222-8222-222222222222",
  });
  assert.equal(materializeCalls.length, 1);
  assert.ok(jobs[2].consumedAt);
});

test("cross-device coordinator leaves materialization failure unconsumed for recovery", async () => {
  const job: any = {
    id: "33333333-3333-4333-8333-333333333333",
    userId: "user-1",
    subjectId: "G",
    workflow: {
      kind: "topic_resurface",
      runId: "44444444-4444-4444-8444-444444444444",
      payload: {
        version: 1,
        stage: "retention",
        evaluated_at: "2026-09-23T03:00:00.000Z",
        candidate_count: 1,
        candidate,
        reflection: "值得保留",
      },
    },
    command: {
      protocol_version: 1,
      task_id: "33333333-3333-4333-8333-333333333333",
      task_kind: "topic_resurface_retention",
      prompt_contract_version: "topic-resurface-retention-v1",
      prompt: "retain?",
    },
    status: "completed",
    resultText: '{"decision":"retain_as_thought_seed"}',
    errorCode: null,
    consumedAt: null,
  };
  let consumed = false;
  const coordinator = new TopicResurfaceCrossDeviceCoordinator(
    {
      async stage() { return job; },
      async findOpenTopicResurface() { return job; },
      async findNextUnconsumedTerminal() { return job; },
      async markConsumed() { consumed = true; },
    },
    { async list() { return { candidates: [] }; } },
    { async materialize() { throw new Error("db unavailable"); } },
    {
      ruleVersion: "v1",
      processVersion: "v1",
      deliberationPromptContractVersion: "d1",
      retentionPromptContractVersion: "r1",
      model: { provider: "claude_code", model: "runtime-selected" },
    },
  );

  assert.equal(
    (await coordinator.advanceNextForUser({ userId: "user-1" })).outcome,
    "materialization_failed",
  );
  assert.equal(consumed, false);
});


test("cross-device coordinator never consumes a completed stage when staging the next job fails", async () => {
  const completed: any = {
    id: "55555555-5555-4555-8555-555555555555",
    userId: "user-1",
    subjectId: "G",
    workflow: {
      kind: "topic_resurface",
      runId: "66666666-6666-4666-8666-666666666666",
      payload: {
        version: 1,
        stage: "evaluation",
        evaluated_at: "2026-09-23T03:00:00.000Z",
        candidate_count: 1,
        candidates: [candidate],
      },
    },
    command: {
      protocol_version: 1,
      task_id: "55555555-5555-4555-8555-555555555555",
      task_kind: "topic_resurface_evaluate",
      prompt_contract_version: "topic-resurface-eval-v1",
      prompt: "evaluate",
    },
    status: "completed",
    resultText: JSON.stringify({
      decision: "consider",
      state_id: candidate.stateId,
    }),
    errorCode: null,
    consumedAt: null,
  };
  let consumed = false;
  const coordinator = new TopicResurfaceCrossDeviceCoordinator(
    {
      async stage() {
        throw new Error("database unavailable");
      },
      async findOpenTopicResurface() { return completed; },
      async findNextUnconsumedTerminal() { return completed; },
      async markConsumed() { consumed = true; },
    },
    { async list() { return { candidates: [candidate] }; } },
    {
      async materialize() {
        return { outcome: "source_ineligible" as const };
      },
    },
    {
      ruleVersion: "v1",
      processVersion: "v1",
      deliberationPromptContractVersion: "d1",
      retentionPromptContractVersion: "r1",
      model: { provider: "claude_code", model: "runtime-selected" },
    },
  );

  await assert.rejects(
    () => coordinator.advanceNextForUser({ userId: "user-1" }),
    /database unavailable/,
  );
  assert.equal(consumed, false);
});
