import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversations,
  nativeLiveBackgroundModelJobs,
  nativeLiveRuntimeListenerLeases,
  users,
} from "../src/database/schema.js";
import {
  DrizzleNativeLiveConversationRepository,
} from "../src/domains/conversation/native-live-conversation-repository.js";
import {
  NativeLiveConversationService,
} from "../src/domains/conversation/native-live-conversation-service.js";
import {
  deleteExpiredNativeLiveBackgroundModelJobsBatch,
  DrizzleNativeLiveBackgroundModelQueueRepository,
  NativeLiveBackgroundModelQueueError,
  NativeLiveBackgroundModelQueueService,
} from "../src/domains/bridge/native-live-background-model-queue.js";

const enabled =
  process.env.RUN_NATIVE_LIVE_RELAY_DATABASE_TEST === "1";

test(
  "background model DB queue is user-scoped, lease-owned, idempotent and TTL-cleanable",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");
    const database = createDatabase(databaseUrl, { ssl: false });
    let userId: string | null = null;

    t.after(async () => {
      try {
        if (userId) {
          await database.db
            .delete(nativeLiveBackgroundModelJobs)
            .where(eq(nativeLiveBackgroundModelJobs.userId, userId));
          await database.db
            .delete(nativeLiveRuntimeListenerLeases)
            .where(eq(nativeLiveRuntimeListenerLeases.userId, userId));
          await database.db
            .delete(users)
            .where(eq(users.id, userId));
        }
      } finally {
        await database.close();
      }
    });

    const [user] = await database.db
      .insert(users)
      .values({
        email:
          `native-live-background-${crypto.randomUUID()}@example.com`,
        displayName: "Native Live Background",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const service = new NativeLiveBackgroundModelQueueService(
      new DrizzleNativeLiveBackgroundModelQueueRepository(database.db),
    );
    const taskId = crypto.randomUUID();
    const listenerId = crypto.randomUUID();
    const command = {
      protocol_version: 1 as const,
      task_id: taskId,
      task_kind: "topic_resurface_evaluate" as const,
      prompt_contract_version: "topic-resurface-eval-v1",
      prompt: "evaluate this bounded candidate snapshot",
    };

    const staged = await service.stage({
      userId,
      subjectId: "G",
      command,
    });
    assert.equal(staged.status, "pending");
    assert.deepEqual(
      (await service.stage({
        userId,
        subjectId: "G",
        command,
      })).command,
      command,
    );
    await assert.rejects(
      () => service.stage({
        userId,
        subjectId: "G",
        command: {
          ...command,
          prompt: "conflicting prompt",
        },
      }),
      (error: unknown) =>
        error instanceof NativeLiveBackgroundModelQueueError
        && error.code === "TASK_CONFLICT",
    );

    await database.db
      .insert(nativeLiveRuntimeListenerLeases)
      .values({
        userId,
        dispatchTarget: "claude_code",
        listenerInstanceId: listenerId,
        leaseExpiresAt: new Date(Date.now() + 60_000),
      });

    const reservation = await service.reserveNext({
      userId,
      listenerInstanceId: listenerId,
    });
    assert.deepEqual(reservation, {
      reservationId: taskId,
      command,
    });

    const result = {
      protocol_version: 1 as const,
      task_id: taskId,
      task_kind: "topic_resurface_evaluate" as const,
      status: "success" as const,
      final_text: '{"decision":"quiet"}',
    };
    const completed = await service.submitResult({
      userId,
      listenerInstanceId: listenerId,
      taskId,
      result,
    });
    assert.equal(completed.status, "completed");
    assert.equal(completed.resultText, result.final_text);
    assert.ok(
      completed.consumedAt instanceof Date,
      "generic terminal jobs are immediately consumed for TTL",
    );

    const replay = await service.submitResult({
      userId,
      listenerInstanceId: listenerId,
      taskId,
      result,
    });
    assert.equal(replay.status, "completed");

    const expiredAt = new Date("2026-09-01T00:00:00.000Z");
    await database.db
      .update(nativeLiveBackgroundModelJobs)
      .set({
        completedAt: expiredAt,
        consumedAt: expiredAt,
      })
      .where(eq(nativeLiveBackgroundModelJobs.id, taskId));

    assert.equal(
      await deleteExpiredNativeLiveBackgroundModelJobsBatch(
        database.db,
        new Date("2026-09-08T00:00:00.000Z"),
        100,
      ),
      1,
    );
    assert.equal(
      await new DrizzleNativeLiveBackgroundModelQueueRepository(
        database.db,
      ).get({ userId, taskId }),
      null,
    );
  },
);


test(
  "background model queue pauses conversation workflow while archived and resumes after Restore",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");
    const database = createDatabase(databaseUrl, { ssl: false });
    let userId: string | null = null;

    t.after(async () => {
      try {
        if (userId) {
          await database.db
            .delete(nativeLiveBackgroundModelJobs)
            .where(eq(nativeLiveBackgroundModelJobs.userId, userId));
          await database.db
            .delete(nativeLiveRuntimeListenerLeases)
            .where(eq(nativeLiveRuntimeListenerLeases.userId, userId));
          await database.db
            .delete(conversations)
            .where(eq(conversations.userId, userId));
          await database.db.delete(users).where(eq(users.id, userId));
        }
      } finally {
        await database.close();
      }
    });

    const [user] = await database.db
      .insert(users)
      .values({
        email: `background-archive-${crypto.randomUUID()}@example.com`,
        displayName: "Background Archive Fence",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const conversationService = new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(database.db),
    );
    const conversation = await conversationService.createConversation({
      userId,
      title: "Archive background source",
    });

    const queue = new NativeLiveBackgroundModelQueueService(
      new DrizzleNativeLiveBackgroundModelQueueRepository(database.db),
    );
    const listenerInstanceId = crypto.randomUUID();
    await database.db.insert(nativeLiveRuntimeListenerLeases).values({
      userId,
      dispatchTarget: "claude_code",
      listenerInstanceId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });

    const firstTaskId = crypto.randomUUID();
    const workflow = {
      kind: "distillation" as const,
      runId: crypto.randomUUID(),
      payload: {
        conversation_id: conversation.id,
        source_head_message_id: crypto.randomUUID(),
      },
    };
    await queue.stage({
      userId,
      subjectId: "G",
      workflow,
      command: {
        protocol_version: 1,
        task_id: firstTaskId,
        task_kind: "distillation",
        prompt_contract_version: "archive-fence-v1",
        prompt: "queued before archive",
      },
    });

    assert.equal(
      (await conversationService.archiveConversation({
        userId,
        conversationId: conversation.id,
      })).outcome,
      "archived",
    );

    assert.equal(
      await queue.reserveNext({
        userId,
        listenerInstanceId,
      }),
      null,
      "queued work must remain pending while its source conversation is archived",
    );

    await assert.rejects(
      queue.stage({
        userId,
        subjectId: "G",
        workflow: {
          ...workflow,
          runId: crypto.randomUUID(),
        },
        command: {
          protocol_version: 1,
          task_id: crypto.randomUUID(),
          task_kind: "distillation",
          prompt_contract_version: "archive-fence-v1",
          prompt: "must not stage while archived",
        },
      }),
      /BackgroundWorkflowSourceInactive/,
    );

    assert.equal(
      (await conversationService.restoreConversation({
        userId,
        conversationId: conversation.id,
      })).outcome,
      "restored",
    );

    const resumed = await queue.reserveNext({
      userId,
      listenerInstanceId,
    });
    assert.ok(resumed);
    assert.equal(resumed.reservationId, firstTaskId);
  },
);
