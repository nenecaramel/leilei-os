import assert from "node:assert/strict";
import test from "node:test";
import type {
  NativeLiveContentBlock,
  NativeLiveConversation,
  NativeLiveMessage,
} from "../src/domains/conversation/native-live-conversation-types.js";
import type {
  NativeLiveBackgroundModelJob,
  NativeLiveBackgroundModelWorkflow,
} from "../src/domains/bridge/native-live-background-model-queue.js";
import {
  DistillationCrossDeviceCoordinator,
} from "../src/domains/runtime/distillation-cross-device-coordinator.js";
import type {
  DistillationConfig,
  DistillationRuntimePort,
} from "../src/domains/runtime/distillation.js";
import type {
  SubjectStateWrite,
} from "../src/domains/runtime/subject-state-contract.js";

const at = "2026-09-23T08:05:00.000Z";
const conversationId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

function block(id: string, text: string): NativeLiveContentBlock {
  return {
    id,
    ordinal: 0,
    kind: "text",
    rawType: "text",
    text,
    payload: null,
    createdAt: at,
  };
}

function message(
  id: string,
  role: "user" | "assistant",
  parentMessageId: string | null,
  text: string,
): NativeLiveMessage {
  return {
    id,
    conversationId,
    parentMessageId,
    role,
    status: "completed",
    createdAt: at,
    completedAt: at,
    blocks: [block("block-" + id, text)],
  };
}

function conversation(
  messages: NativeLiveMessage[],
  currentHeadMessageId: string,
): NativeLiveConversation {
  return {
    id: conversationId,
    userId,
    title: null,
    lifecycleStatus: "active",
    currentHeadMessageId,
    createdAt: at,
    updatedAt: at,
    messages,
  };
}

function linearConversation(): NativeLiveConversation {
  const u1 = message("u1", "user", null, "第一轮");
  const a1 = message("a1", "assistant", "u1", "第一轮回答");
  const u2 = message("u2", "user", "a1", "第二轮");
  const a2 = message("a2", "assistant", "u2", "第二轮回答");
  const u3 = message("u3", "user", "a2", "第三轮");
  const a3 = message("a3", "assistant", "u3", "第三轮回答");
  return conversation([u1, a1, u2, a2, u3, a3], "a3");
}

class MemoryPort implements DistillationRuntimePort {
  watermark: string | null = null;
  states: SubjectStateWrite[] = [];

  async getWatermark(): Promise<string | null> {
    return this.watermark;
  }

  async commitSuccess(input: {
    expectedPreviousWatermarkMessageId: string | null;
    nextWatermarkMessageId: string;
    states: readonly SubjectStateWrite[];
  }): Promise<"committed" | "conflict"> {
    if (this.watermark !== input.expectedPreviousWatermarkMessageId) {
      return "conflict";
    }
    this.watermark = input.nextWatermarkMessageId;
    this.states.push(...input.states);
    return "committed";
  }
}

class Queue {
  jobs: NativeLiveBackgroundModelJob[] = [];

  async stage(input: {
    userId: string;
    subjectId: string;
    command: NativeLiveBackgroundModelJob["command"];
    workflow?: NativeLiveBackgroundModelWorkflow;
  }): Promise<NativeLiveBackgroundModelJob> {
    const job: NativeLiveBackgroundModelJob = {
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
    this.jobs.push(job);
    return job;
  }

  async findOpenDistillation(input: {
    userId: string;
    subjectId: string;
    conversationId: string;
  }): Promise<NativeLiveBackgroundModelJob | null> {
    return this.jobs.find((job) =>
      job.userId === input.userId
      && job.subjectId === input.subjectId
      && job.workflow?.kind === "distillation"
      && job.workflow.payload.conversation_id === input.conversationId
      && job.consumedAt === null
    ) ?? null;
  }

  async findNextUnconsumedTerminalForWorkflow(input: {
    userId: string;
    workflowKind: "topic_resurface" | "distillation";
  }): Promise<NativeLiveBackgroundModelJob | null> {
    return this.jobs.find((job) =>
      job.userId === input.userId
      && job.workflow?.kind === input.workflowKind
      && job.consumedAt === null
      && (job.status === "completed" || job.status === "failed")
    ) ?? null;
  }

  async markConsumed(input: {
    userId: string;
    taskId: string;
  }): Promise<void> {
    const job = this.jobs.find((candidate) =>
      candidate.userId === input.userId
      && candidate.id === input.taskId
    );
    if (job) job.consumedAt = new Date(at);
  }
}

function config(): DistillationConfig {
  let state = 0;
  return {
    surfaceLimit: 2,
    maxMemoriesPerRun: 3,
    ruleVersion: "distill-rule-v1",
    processVersion: "distill-process-v1",
    model: {
      provider: "claude_code",
      model: "runtime-selected",
      configVersion: "cross-device-v1",
      promptContractVersion: "distill-prompt-v1",
    },
    createRunId: () => "33333333-3333-4333-8333-333333333333",
    createStateId: () => `distilled-${++state}`,
  };
}

test("cross-device Distillation stages one pure background-model task for the current settled window", async () => {
  const queue = new Queue();
  const port = new MemoryPort();
  const current = linearConversation();
  const coordinator = new DistillationCrossDeviceCoordinator(
    queue,
    {
      async getConversation() {
        return current;
      },
    },
    port,
    config(),
  );

  const result = await coordinator.start({
    userId,
    subjectId: "G",
    conversationId,
  });

  assert.equal(result.outcome, "staged");
  assert.equal(queue.jobs.length, 1);
  const job = queue.jobs[0]!;
  assert.equal(job.command.task_kind, "distillation");
  assert.equal(job.workflow?.kind, "distillation");
  assert.equal(job.workflow?.payload.conversation_id, conversationId);
  assert.equal(job.workflow?.payload.source_head_message_id, "a2");
  assert.match(job.command.prompt, /BEGIN_UNTRUSTED_TRANSCRIPT_JSON/);

  const repeated = await coordinator.start({
    userId,
    subjectId: "G",
    conversationId,
  });
  assert.deepEqual(repeated, {
    outcome: "waiting",
    taskId: job.id,
  });
  assert.equal(queue.jobs.length, 1);
});

test("terminal Distillation result is revalidated against the current branch before commit", async () => {
  const queue = new Queue();
  const port = new MemoryPort();
  let current = linearConversation();
  const coordinator = new DistillationCrossDeviceCoordinator(
    queue,
    {
      async getConversation() {
        return current;
      },
    },
    port,
    config(),
  );

  await coordinator.start({
    userId,
    subjectId: "G",
    conversationId,
  });
  const job = queue.jobs[0]!;
  job.status = "completed";
  job.resultText =
    '{"memories":[{"text":"我记得我们完成了前两轮。"}]}';

  const result = await coordinator.advanceNextForUser({ userId });
  assert.equal(result.outcome, "committed");
  if (result.outcome !== "committed") return;
  assert.equal(result.sourceHeadMessageId, "a2");
  assert.deepEqual(result.createdStateIds, ["distilled-1"]);
  assert.equal(port.watermark, "a2");
  assert.equal(port.states[0]?.text, "我记得我们完成了前两轮。");
  assert.equal(
    port.states[0]?.envelope.provenance.processRunId,
    result.runId,
  );
  assert.ok(job.consumedAt);

  // A later branch change cannot retroactively alter the committed window.
  current = linearConversation();
});

test("cross-device Distillation discards a model result when its staged canonical source was superseded in flight", async () => {
  const queue = new Queue();
  const port = new MemoryPort();
  let current = linearConversation();
  const coordinator = new DistillationCrossDeviceCoordinator(
    queue,
    {
      async getConversation() {
        return current;
      },
    },
    port,
    config(),
  );

  await coordinator.start({
    userId,
    subjectId: "G",
    conversationId,
  });
  const job = queue.jobs[0]!;
  job.status = "completed";
  job.resultText =
    '{"memories":[{"text":"这条来自已经废弃的路径。"}]}';

  const u1 = message("u1", "user", null, "第一轮");
  const aNew = message("a-new", "assistant", "u1", "Retry 后的新回答");
  const uNew = message("u-new", "user", "a-new", "继续新分支");
  const aNew2 = message("a-new-2", "assistant", "u-new", "新分支第二轮");
  const uNew2 = message("u-new-2", "user", "a-new-2", "继续");
  const aNew3 = message("a-new-3", "assistant", "u-new-2", "最新");
  current = conversation(
    [u1, aNew, uNew, aNew2, uNew2, aNew3],
    "a-new-3",
  );

  const result = await coordinator.advanceNextForUser({ userId });
  assert.equal(result.outcome, "source_superseded");
  assert.equal(port.watermark, null);
  assert.deepEqual(port.states, []);
  assert.ok(job.consumedAt);
});


test("cross-device Distillation treats a deleted native live conversation as unavailable", async () => {
  const queue = new Queue();
  const port = new MemoryPort();
  const deleted = {
    ...linearConversation(),
    lifecycleStatus: "deleted" as const,
  };
  const coordinator = new DistillationCrossDeviceCoordinator(
    queue,
    {
      async getConversation() {
        return deleted;
      },
    },
    port,
    config(),
  );

  const start = await coordinator.start({
    userId,
    subjectId: "G",
    conversationId,
  });
  assert.equal(start.outcome, "idle");
  assert.equal(queue.jobs.length, 0);
});
