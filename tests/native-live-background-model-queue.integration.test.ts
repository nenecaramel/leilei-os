import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  nativeLiveBackgroundModelJobs,
  nativeLiveRuntimeListenerLeases,
  users,
} from "../src/database/schema.js";
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
