import "dotenv/config";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversations,
  runtimeDistillationWatermarks,
  runtimeSubjectStates,
  users,
} from "../src/database/schema.js";
import { NativeLiveConversationService } from "../src/domains/conversation/native-live-conversation-service.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";
import { ClaudeCodeDistillationModel } from "../src/domains/runtime/claude-code-distillation-model.js";
import { BackgroundLoopOrchestrator } from "../src/domains/runtime/background-loop-orchestrator.js";
import { DistillationBackgroundTrigger } from "../src/domains/runtime/distillation-background-trigger.js";
import { DrizzleDistillationRuntimePort } from "../src/domains/runtime/distillation-runtime-repository.js";
import { DistillationService } from "../src/domains/runtime/distillation.js";

const { HeadlessClaudeTransport } = await import(
  "../tools/claude-bridge/src/headless-claude-transport.mjs"
);

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL is required");
assert.ok(!process.env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY must be unset");

const database = createDatabase(databaseUrl, { ssl: false });
const suffix = crypto.randomUUID();
let userId: string | null = null;
let conversationId: string | null = null;

try {
  const [user] = await database.db
    .insert(users)
    .values({
      email: `runtime-distill-background-${suffix}@example.com`,
      displayName: "Runtime Distillation Background Smoke",
    })
    .returning({ id: users.id });
  assert.ok(user);
  userId = user.id;

  const conversationsService = new NativeLiveConversationService(
    new DrizzleNativeLiveConversationRepository(database.db),
  );
  const conversation = await conversationsService.createConversation({
    userId,
    title: "Distillation background smoke",
  });
  conversationId = conversation.id;

  async function appendTurn(userText: string, assistantText: string, index: number) {
    const stored = await conversationsService.getConversation({
      userId: userId!,
      conversationId: conversationId!,
    });
    assert.ok(stored);

    const userMessage = await conversationsService.appendUserMessage({
      userId: userId!,
      conversationId: conversationId!,
      parentMessageId: stored.currentHeadMessageId,
      blocks: [{ kind: "text", rawType: "text", text: userText }],
    });
    return conversationsService.completeAssistantTurn({
      userId: userId!,
      conversationId: conversationId!,
      parentMessageId: userMessage.id,
      blocks: [{ kind: "text", rawType: "text", text: assistantText }],
      checkpoint: {
        provider: "claude_code",
        providerSessionId: `background-smoke-${suffix}-${index}`,
      },
    });
  }

  await appendTurn(
    "我们今天把 LeileiOS Distillation 接入真实 Claude Code。",
    "这一层只把已经成立的旧对话沉淀成 derived Memory。",
    1,
  );
  const second = await appendTurn(
    "继续，失败时不要推进 watermark。",
    "对，background process 也不能拖垮主聊天。",
    2,
  );
  await appendTurn(
    "现在验证 background trigger。",
    "验证完成后再进入 Decay 和 Memory lifecycle。",
    3,
  );

  const transport = new HeadlessClaudeTransport();
  const model = new ClaudeCodeDistillationModel(transport);
  const distillation = new DistillationService(
    new DrizzleDistillationRuntimePort(database.db, "distill-process-v1"),
    model,
    {
      surfaceLimit: 2,
      maxMemoriesPerRun: 3,
      ruleVersion: "distill-rule-v1",
      processVersion: "distill-process-v1",
      model: {
        provider: "claude_code",
        model: "subscription",
        promptContractVersion: "distill-prompt-v1",
      },
    },
  );

  const observed: unknown[] = [];
  const backgroundLoops = new BackgroundLoopOrchestrator({
    maxRunsPerCycle: 2,
    maxCostPerCycle: 2,
    maxConcurrent: 1,
  });
  const trigger = new DistillationBackgroundTrigger(
    backgroundLoops,
    {
      getConversation: (input) => conversationsService.getConversation(input),
    },
    distillation,
    "G",
    {
      priority: "consolidation",
      cost: 1,
    },
    (event) => observed.push(event),
  );

  trigger.schedule({ userId, conversationId });
  await trigger.drain();

  const [watermark] = await database.db
    .select({
      lastSourceMessageId: runtimeDistillationWatermarks.lastSourceMessageId,
    })
    .from(runtimeDistillationWatermarks)
    .where(
      and(
        eq(runtimeDistillationWatermarks.userId, userId),
        eq(runtimeDistillationWatermarks.subjectId, "G"),
        eq(runtimeDistillationWatermarks.conversationId, conversationId),
      ),
    )
    .limit(1);

  assert.equal(
    watermark?.lastSourceMessageId,
    second.message.id,
    "background trigger must advance to the latest settled assistant outside Surface",
  );

  const memories = await database.db
    .select({
      id: runtimeSubjectStates.id,
      text: runtimeSubjectStates.text,
      envelope: runtimeSubjectStates.envelope,
    })
    .from(runtimeSubjectStates)
    .where(
      and(
        eq(runtimeSubjectStates.userId, userId),
        eq(runtimeSubjectStates.subjectId, "G"),
        eq(runtimeSubjectStates.kind, "memory"),
      ),
    );

  process.stdout.write(
    JSON.stringify({
      status: "accepted",
      conversationId,
      watermark: watermark?.lastSourceMessageId ?? null,
      memoryCount: memories.length,
      memories: memories.map((memory) => memory.text),
      observed,
    }, null, 2) + "\n",
  );
} finally {
  if (userId) {
    await database.db
      .delete(runtimeSubjectStates)
      .where(eq(runtimeSubjectStates.userId, userId));
    await database.db
      .delete(runtimeDistillationWatermarks)
      .where(eq(runtimeDistillationWatermarks.userId, userId));
  }
  if (conversationId) {
    await database.db
      .delete(conversations)
      .where(eq(conversations.id, conversationId));
  }
  if (userId) {
    await database.db.delete(users).where(eq(users.id, userId));
  }
  await database.close();
}
