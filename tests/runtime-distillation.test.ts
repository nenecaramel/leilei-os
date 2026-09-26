import assert from "node:assert/strict";
import test from "node:test";
import type {
  NativeLiveContentBlock,
  NativeLiveConversation,
  NativeLiveMessage,
} from "../src/domains/conversation/native-live-conversation-types.js";
import {
  DistillationService,
  planDistillationWindow,
  type DistillationModel,
  type DistillationRuntimePort,
} from "../src/domains/runtime/distillation.js";
import { recallBreath } from "../src/domains/runtime/breath-recall.js";
import type { SubjectStateWrite } from "../src/domains/runtime/subject-state-contract.js";

const now = "2026-09-22T09:00:00.000Z";

function block(id: string, text: string): NativeLiveContentBlock {
  return {
    id,
    ordinal: 0,
    kind: "text",
    rawType: "text",
    text,
    payload: null,
    createdAt: now,
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
    conversationId: "c1",
    parentMessageId,
    role,
    status: "completed",
    createdAt: now,
    completedAt: now,
    blocks: [block(`b-${id}`, text)],
  };
}

function conversation(
  messages: NativeLiveMessage[],
  currentHeadMessageId: string,
): NativeLiveConversation {
  return {
    id: "c1",
    userId: "u1",
    title: null,
    lifecycleStatus: "active",
    currentHeadMessageId,
    createdAt: now,
    updatedAt: now,
    messages,
  };
}

function linearConversation(): NativeLiveConversation {
  const u1 = message("u1", "user", null, "第一次聊 Runtime");
  const a1 = message("a1", "assistant", "u1", "第一轮");
  const u2 = message("u2", "user", "a1", "继续聊 Memory");
  const a2 = message("a2", "assistant", "u2", "第二轮");
  const u3 = message("u3", "user", "a2", "现在聊 Breath");
  const a3 = message("a3", "assistant", "u3", "第三轮");
  return conversation([u1, a1, u2, a2, u3, a3], "a3");
}

class MemoryPort implements DistillationRuntimePort {
  watermark: string | null = null;
  states: SubjectStateWrite[] = [];
  commits = 0;

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
    this.commits += 1;
    this.states.push(...input.states);
    this.watermark = input.nextWatermarkMessageId;
    return "committed";
  }
}

function model(
  calls: Array<{ ids: string[] }>,
  memories: string[] = ["我们把 Runtime 的 Memory 闭环逐步接起来了"],
): DistillationModel {
  return {
    async distill(input) {
      calls.push({ ids: input.transcript.map((message) => message.messageId) });
      return { memories: memories.map((text) => ({ text })) };
    },
  };
}

function service(
  port: DistillationRuntimePort,
  distillationModel: DistillationModel,
): DistillationService {
  let nextState = 0;
  return new DistillationService(port, distillationModel, {
    surfaceLimit: 2,
    maxMemoriesPerRun: 3,
    ruleVersion: "distill-rule-v1",
    processVersion: "distill-process-v1",
    model: {
      provider: "claude_code",
      model: "subscription",
      promptContractVersion: "distill-prompt-v1",
    },
    createRunId: () => "run-1",
    createStateId: () => `distilled-${++nextState}`,
  });
}

test("Distillation plans only settled turns that have fallen outside Surface", () => {
  const planned = planDistillationWindow({
    conversation: linearConversation(),
    surfaceLimit: 2,
    previousWatermarkMessageId: null,
  });

  assert.ok(planned);
  assert.deepEqual(
    planned.transcript.map((message) => message.messageId),
    ["u1", "a1", "u2", "a2"],
  );
  assert.equal(planned.sourceHeadMessageId, "a2");
});

test("Distillation waits for an explicit source batch instead of running every turn", () => {
  const base = linearConversation();
  const tooSmall = planDistillationWindow({
    conversation: base,
    surfaceLimit: 2,
    minSourceMessages: 6,
    previousWatermarkMessageId: null,
  });
  assert.equal(tooSmall, null);

  const u4 = message("u4", "user", "a3", "第四轮继续");
  const a4 = message("a4", "assistant", "u4", "第四轮回答");
  const batched = planDistillationWindow({
    conversation: conversation(
      [...base.messages, u4, a4],
      "a4",
    ),
    surfaceLimit: 2,
    minSourceMessages: 6,
    previousWatermarkMessageId: null,
  });

  assert.ok(batched);
  assert.deepEqual(
    batched.transcript.map((message) => message.messageId),
    ["u1", "a1", "u2", "a2", "u3", "a3"],
  );
  assert.equal(batched.sourceHeadMessageId, "a3");
});

test("Distillation excludes abandoned Retry siblings from its source transcript", () => {
  const u1 = message("u1", "user", null, "root");
  const a1 = message("a1", "assistant", "u1", "first");
  const u2 = message("u2", "user", "a1", "retry this");
  const abandoned = message("a-old", "assistant", "u2", "abandoned secret");
  const selected = message("a-new", "assistant", "u2", "selected answer");
  const u3 = message("u3", "user", "a-new", "continue selected");
  const a3 = message("a3", "assistant", "u3", "latest");

  const planned = planDistillationWindow({
    conversation: conversation(
      [u1, a1, u2, abandoned, selected, u3, a3],
      "a3",
    ),
    surfaceLimit: 2,
    previousWatermarkMessageId: null,
  });

  assert.ok(planned);
  assert.equal(
    planned.transcript.some((item) => item.messageId === "a-old"),
    false,
  );
  assert.equal(
    planned.transcript.some((item) => item.text.includes("abandoned secret")),
    false,
  );
  assert.equal(
    planned.transcript.some((item) => item.messageId === "a-new"),
    true,
  );
});

test("successful Distillation commits path-scoped settled Memory with exact message provenance and advances watermark", async () => {
  const port = new MemoryPort();
  const calls: Array<{ ids: string[] }> = [];
  const result = await service(port, model(calls)).runOnce({
    userId: "u1",
    subjectId: "G",
    conversation: linearConversation(),
  });

  assert.deepEqual(result, {
    outcome: "committed",
    sourceHeadMessageId: "a2",
    createdStateIds: ["distilled-1"],
    resetFromSupersededWatermark: false,
  });
  assert.deepEqual(calls, [{ ids: ["u1", "a1", "u2", "a2"] }]);
  assert.equal(port.watermark, "a2");
  assert.equal(port.states.length, 1);

  const state = port.states[0]!;
  assert.equal(state.kind, "memory");
  assert.equal(state.envelope.authority, "derived");
  assert.equal(state.envelope.semanticActor.kind, "process");
  assert.equal(state.envelope.scope.applicability, "path");
  assert.equal(state.envelope.scope.pathHeadMessageId, "a2");
  assert.equal(state.envelope.status.settlementStatus, "settled");
  assert.deepEqual(
    state.envelope.provenance.sources.map((source) => source.id),
    ["u1", "a1", "u2", "a2"],
  );

  const currentPathHits = recallBreath(
    "Runtime Memory",
    port.states,
    {
      userId: "u1",
      subjectId: "G",
      conversationId: "c1",
      currentPathMessageIds: new Set(["u1", "a1", "u2", "a2", "u3", "a3"]),
      limit: 3,
    },
  );
  assert.deepEqual(currentPathHits.map((hit) => hit.state.id), ["distilled-1"]);

  const branchWithoutSourceHits = recallBreath(
    "Runtime Memory",
    port.states,
    {
      userId: "u1",
      subjectId: "G",
      conversationId: "c1",
      currentPathMessageIds: new Set(["u1", "a1", "u-other", "a-other"]),
      limit: 3,
    },
  );
  assert.deepEqual(branchWithoutSourceHits, []);
});

test("model failure never advances the Distillation watermark", async () => {
  const port = new MemoryPort();
  const failing: DistillationModel = {
    async distill() {
      throw new Error("offline");
    },
  };

  const result = await service(port, failing).runOnce({
    userId: "u1",
    subjectId: "G",
    conversation: linearConversation(),
  });

  assert.deepEqual(result, {
    outcome: "model_failed",
    sourceHeadMessageId: "a2",
  });
  assert.equal(port.watermark, null);
  assert.equal(port.states.length, 0);
  assert.equal(port.commits, 0);
});

test("successful no-op Distillation still advances watermark so the same old Surface is not reprocessed", async () => {
  const port = new MemoryPort();
  const calls: Array<{ ids: string[] }> = [];
  const distill = service(port, model(calls, []));

  const first = await distill.runOnce({
    userId: "u1",
    subjectId: "G",
    conversation: linearConversation(),
  });
  const second = await distill.runOnce({
    userId: "u1",
    subjectId: "G",
    conversation: linearConversation(),
  });

  assert.equal(first.outcome, "committed");
  assert.equal(port.watermark, "a2");
  assert.equal(port.states.length, 0);
  assert.deepEqual(second, { outcome: "idle" });
  assert.equal(calls.length, 1);
});

test("Retry before the old watermark resets planning onto the newly selected branch", () => {
  const u1 = message("u1", "user", null, "root");
  const oldA1 = message("a-old", "assistant", "u1", "old branch");
  const oldU2 = message("u-old", "user", "a-old", "old continuation");
  const oldA2 = message("a-old-2", "assistant", "u-old", "old later");
  const newA1 = message("a-new", "assistant", "u1", "new branch");
  const newU2 = message("u-new", "user", "a-new", "new continuation");
  const newA2 = message("a-new-2", "assistant", "u-new", "new later");
  const newU3 = message("u-new-3", "user", "a-new-2", "latest");
  const newA3 = message("a-new-3", "assistant", "u-new-3", "latest reply");

  const planned = planDistillationWindow({
    conversation: conversation(
      [u1, oldA1, oldU2, oldA2, newA1, newU2, newA2, newU3, newA3],
      "a-new-3",
    ),
    surfaceLimit: 2,
    previousWatermarkMessageId: "a-old-2",
  });

  assert.ok(planned);
  assert.equal(planned.resetFromSupersededWatermark, true);
  assert.equal(
    planned.transcript.some((message) => message.id === "a-old"),
    false,
  );
  assert.deepEqual(
    planned.transcript.map((message) => message.messageId),
    ["u1", "a-new", "u-new", "a-new-2"],
  );
});
