import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversations as conversationRows,
  runtimeDistillationWatermarks,
  runtimeSubjectStates,
  users,
} from "../src/database/schema.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";
import { NativeLiveConversationService } from "../src/domains/conversation/native-live-conversation-service.js";
import {
  DistillationService,
  type DistillationModel,
} from "../src/domains/runtime/distillation.js";
import { DrizzleDistillationRuntimePort } from "../src/domains/runtime/distillation-runtime-repository.js";

const enabled = process.env.RUN_RUNTIME_DISTILLATION_DATABASE_TEST === "1";

test(
  "Distillation V1 persists derived Memory and advances its watermark atomically",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");

    const database = createDatabase(databaseUrl, { ssl: false });
    let cleanupUserId: string | null = null;

    t.after(async () => {
      try {
        if (cleanupUserId) {
          await database.db
            .delete(runtimeSubjectStates)
            .where(eq(runtimeSubjectStates.userId, cleanupUserId));
          await database.db
            .delete(conversationRows)
            .where(eq(conversationRows.userId, cleanupUserId));
          await database.db
            .delete(users)
            .where(eq(users.id, cleanupUserId));
        }
      } finally {
        await database.close();
      }
    });

    const suffix = crypto.randomUUID();
    const [user] = await database.db
      .insert(users)
      .values({
        email: `runtime-distill-${suffix}@example.com`,
        displayName: "Runtime Distillation DB Test",
      })
      .returning({ id: users.id });
    assert.ok(user);
    cleanupUserId = user.id;

    const conversations = new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(database.db),
    );
    const conversation = await conversations.createConversation({
      userId: user.id,
      title: "Distillation persistence",
    });

    const u1 = await conversations.appendUserMessage({
      userId: user.id,
      conversationId: conversation.id,
      parentMessageId: null,
      blocks: [{ kind: "text", rawType: "text", text: "第一轮 Runtime" }],
    });
    const a1 = await conversations.completeAssistantTurn({
      userId: user.id,
      conversationId: conversation.id,
      parentMessageId: u1.id,
      blocks: [{ kind: "text", rawType: "text", text: "第一轮回复" }],
      checkpoint: {
        provider: "claude_code",
        providerSessionId: `distill-${suffix}-1`,
      },
    });

    const u2 = await conversations.appendUserMessage({
      userId: user.id,
      conversationId: conversation.id,
      parentMessageId: a1.message.id,
      blocks: [{ kind: "text", rawType: "text", text: "第二轮 Memory" }],
    });
    const a2 = await conversations.completeAssistantTurn({
      userId: user.id,
      conversationId: conversation.id,
      parentMessageId: u2.id,
      blocks: [{ kind: "text", rawType: "text", text: "第二轮回复" }],
      checkpoint: {
        provider: "claude_code",
        providerSessionId: `distill-${suffix}-2`,
      },
    });

    const u3 = await conversations.appendUserMessage({
      userId: user.id,
      conversationId: conversation.id,
      parentMessageId: a2.message.id,
      blocks: [{ kind: "text", rawType: "text", text: "第三轮 Breath" }],
    });
    await conversations.completeAssistantTurn({
      userId: user.id,
      conversationId: conversation.id,
      parentMessageId: u3.id,
      blocks: [{ kind: "text", rawType: "text", text: "第三轮回复" }],
      checkpoint: {
        provider: "claude_code",
        providerSessionId: `distill-${suffix}-3`,
      },
    });

    const stored = await conversations.getConversation({
      userId: user.id,
      conversationId: conversation.id,
    });
    assert.ok(stored);

    const modelCalls: string[][] = [];
    const model: DistillationModel = {
      async distill(input) {
        modelCalls.push(input.transcript.map((message) => message.messageId));
        return {
          memories: [{
            text: "我们连续讨论了 Runtime、Memory 与 Breath 的实现。",
          }],
        };
      },
    };

    let stateCounter = 0;
    const distillation = new DistillationService(
      new DrizzleDistillationRuntimePort(
        database.db,
        "distill-process-v1",
      ),
      model,
      {
        settlementLagMessages: 2,
        maxMemoriesPerRun: 3,
        ruleVersion: "distill-rule-v1",
        processVersion: "distill-process-v1",
        model: {
          provider: "claude_code",
          model: "subscription",
          promptContractVersion: "distill-prompt-v1",
        },
        createRunId: () => "11111111-1111-4111-8111-111111111111",
        createStateId: () =>
          `00000000-0000-4000-8000-${String(++stateCounter).padStart(12, "0")}`,
      },
    );

    const first = await distillation.runOnce({
      userId: user.id,
      subjectId: "G",
      conversation: stored,
    });
    assert.equal(first.outcome, "committed");
    if (first.outcome !== "committed") throw new Error("expected commit");
    assert.equal(first.sourceHeadMessageId, a2.message.id);
    assert.equal(first.createdStateIds.length, 1);
    assert.deepEqual(modelCalls, [[
      u1.id,
      a1.message.id,
      u2.id,
      a2.message.id,
    ]]);

    const [watermark] = await database.db
      .select({
        lastSourceMessageId:
          runtimeDistillationWatermarks.lastSourceMessageId,
        processVersion: runtimeDistillationWatermarks.processVersion,
      })
      .from(runtimeDistillationWatermarks)
      .where(
        and(
          eq(runtimeDistillationWatermarks.userId, user.id),
          eq(runtimeDistillationWatermarks.subjectId, "G"),
          eq(
            runtimeDistillationWatermarks.conversationId,
            conversation.id,
          ),
        ),
      );
    assert.deepEqual(watermark, {
      lastSourceMessageId: a2.message.id,
      processVersion: "distill-process-v1",
    });

    const [memory] = await database.db
      .select({
        kind: runtimeSubjectStates.kind,
        text: runtimeSubjectStates.text,
        scopeApplicability:
          runtimeSubjectStates.scopeApplicability,
        scopeConversationId:
          runtimeSubjectStates.scopeConversationId,
        scopePathHeadMessageId:
          runtimeSubjectStates.scopePathHeadMessageId,
        settlementStatus:
          runtimeSubjectStates.settlementStatus,
        validityStatus:
          runtimeSubjectStates.validityStatus,
        envelope: runtimeSubjectStates.envelope,
      })
      .from(runtimeSubjectStates)
      .where(
        and(
          eq(runtimeSubjectStates.userId, user.id),
          eq(runtimeSubjectStates.subjectId, "G"),
        ),
      );
    assert.ok(memory);
    assert.equal(memory.kind, "memory");
    assert.equal(memory.scopeApplicability, "path");
    assert.equal(memory.scopeConversationId, conversation.id);
    assert.equal(memory.scopePathHeadMessageId, a2.message.id);
    assert.equal(memory.settlementStatus, "settled");
    assert.equal(memory.validityStatus, "valid");

    const envelope = memory.envelope as {
      authority?: string;
      provenance?: { sources?: Array<{ id?: string }> };
    };
    assert.equal(envelope.authority, "derived");
    assert.deepEqual(
      envelope.provenance?.sources?.map((source) => source.id),
      [u1.id, a1.message.id, u2.id, a2.message.id],
    );

    const second = await distillation.runOnce({
      userId: user.id,
      subjectId: "G",
      conversation: stored,
    });
    assert.deepEqual(second, { outcome: "idle" });
    assert.equal(modelCalls.length, 1);

    const u4 = await conversations.appendUserMessage({
      userId: user.id,
      conversationId: conversation.id,
      parentMessageId: (
        await conversations.getConversation({
          userId: user.id,
          conversationId: conversation.id,
        })
      )?.currentHeadMessageId ?? null,
      blocks: [{ kind: "text", rawType: "text", text: "第四轮 Archive fence" }],
    });
    await conversations.completeAssistantTurn({
      userId: user.id,
      conversationId: conversation.id,
      parentMessageId: u4.id,
      blocks: [{ kind: "text", rawType: "text", text: "第四轮回复" }],
      checkpoint: {
        provider: "claude_code",
        providerSessionId: `distill-${suffix}-4`,
      },
    });

    const beforeArchive = await conversations.getConversation({
      userId: user.id,
      conversationId: conversation.id,
    });
    assert.ok(beforeArchive);
    assert.equal(
      (await conversations.archiveConversation({
        userId: user.id,
        conversationId: conversation.id,
      })).outcome,
      "archived",
    );

    const blocked = await distillation.runOnce({
      userId: user.id,
      subjectId: "G",
      conversation: beforeArchive,
    });
    assert.equal(blocked.outcome, "conflict");

    const [watermarkAfterArchive] = await database.db
      .select({
        lastSourceMessageId:
          runtimeDistillationWatermarks.lastSourceMessageId,
      })
      .from(runtimeDistillationWatermarks)
      .where(and(
        eq(runtimeDistillationWatermarks.userId, user.id),
        eq(runtimeDistillationWatermarks.subjectId, "G"),
        eq(
          runtimeDistillationWatermarks.conversationId,
          conversation.id,
        ),
      ));
    assert.equal(
      watermarkAfterArchive?.lastSourceMessageId,
      a2.message.id,
      "Archive must block the stale snapshot from advancing Distillation",
    );
  },
);
