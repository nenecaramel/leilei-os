import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversations,
  nativeLiveTurnPreparations,
  users,
} from "../src/database/schema.js";
import {
  DrizzleNativeLiveConversationRepository,
} from "../src/domains/conversation/native-live-conversation-repository.js";
import {
  NativeLiveConversationService,
} from "../src/domains/conversation/native-live-conversation-service.js";
import {
  DrizzleNativeLiveCurrentPathReader,
} from "../src/domains/conversation/native-live-current-path-read-repository.js";

const enabled =
  process.env.RUN_NATIVE_LIVE_BOOTSTRAP_DATABASE_TEST === "1";

function hasConnectionEndedCode(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (
      typeof current === "object"
      && current !== null
      && "code" in current
      && current.code === "CONNECTION_ENDED"
    ) {
      return true;
    }
    current = (
      typeof current === "object"
      && current !== null
      && "cause" in current
    )
      ? current.cause
      : null;
  }
  return false;
}

async function cleanupUsers(
  databaseUrl: string,
  userIds: readonly string[],
): Promise<void> {
  const backoffMs = [250, 500, 1_000, 2_000, 4_000];
  let lastError: unknown;

  for (let attempt = 0; attempt <= backoffMs.length; attempt += 1) {
    const sql = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      ssl: false,
      connect_timeout: 15,
      idle_timeout: 5,
    });

    try {
      for (const userId of userIds) {
        await sql`delete from conversations where user_id = ${userId}`;
        await sql`delete from users where id = ${userId}`;
      }
      await sql.end();
      return;
    } catch (error) {
      await sql.end({ timeout: 0 }).catch(() => undefined);
      if (!hasConnectionEndedCode(error)) throw error;
      lastError = error;
      if (attempt === backoffMs.length) break;
      await new Promise((resolve) =>
        setTimeout(resolve, backoffMs[attempt]),
      );
    }
  }

  throw lastError;
}

test(
  "native live bootstrap lists only active owner conversations newest first",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");

    const { isolatedPostgresTarget, verifyIsolatedPostgresTarget } = await import("../scripts/isolated-postgres-target.mjs");
    await verifyIsolatedPostgresTarget(isolatedPostgresTarget(databaseUrl));

    const database = createDatabase(databaseUrl, {
      ssl: false,
      createClient: (url, maxConnections, ssl) =>
        postgres(url, {
          max: maxConnections,
          prepare: false,
          ssl,
          connect_timeout: 15,
          idle_timeout: 60,
        }),
    });
    t.after(async () => database.close());

    const suffix = crypto.randomUUID();
    const createdUsers = await database.db
      .insert(users)
      .values([
        {
          email: `native-live-bootstrap-a-${suffix}@example.com`,
          displayName: "Native Live Bootstrap A",
        },
        {
          email: `native-live-bootstrap-b-${suffix}@example.com`,
          displayName: "Native Live Bootstrap B",
        },
      ])
      .returning({ id: users.id });

    assert.equal(createdUsers.length, 2);
    const userA = createdUsers[0]!.id;
    const userB = createdUsers[1]!.id;

    t.after(async () => {
      await cleanupUsers(databaseUrl, [userA, userB]);
    });

    const service = new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(database.db),
    );
    const currentPathReader =
      new DrizzleNativeLiveCurrentPathReader(database.db);

    const older = await service.createConversation({
      userId: userA,
      title: "Older active",
    });
    const newer = await service.createConversation({
      userId: userA,
      title: "Newer active",
    });
    const archived = await service.createConversation({
      userId: userA,
      title: "Archived",
    });
    const otherTenant = await service.createConversation({
      userId: userB,
      title: "Other tenant",
    });

    await database.db
      .update(conversations)
      .set({ updatedAt: new Date("2026-09-23T10:00:00.000Z") })
      .where(eq(conversations.id, older.id));
    await database.db
      .update(conversations)
      .set({ updatedAt: new Date("2026-09-23T11:00:00.000Z") })
      .where(eq(conversations.id, newer.id));
    await database.db
      .update(conversations)
      .set({
        lifecycleStatus: "archived",
        archivedAt: new Date("2026-09-23T12:00:00.000Z"),
        updatedAt: new Date("2026-09-23T12:00:00.000Z"),
      })
      .where(eq(conversations.id, archived.id));

    const listedA = await service.listConversations({
      userId: userA,
      limit: 10,
    });
    assert.deepEqual(
      listedA.map((conversation) => conversation.id),
      [newer.id, older.id],
    );
    assert.equal(
      listedA.some((conversation) => conversation.id === archived.id),
      false,
    );
    assert.equal(
      listedA.some((conversation) => conversation.id === otherTenant.id),
      false,
    );

    const limitedA = await service.listConversations({
      userId: userA,
      limit: 1,
    });
    assert.deepEqual(
      limitedA.map((conversation) => conversation.id),
      [newer.id],
    );

    const listedB = await service.listConversations({
      userId: userB,
      limit: 10,
    });
    assert.deepEqual(
      listedB.map((conversation) => conversation.id),
      [otherTenant.id],
    );

    const renamed = await service.renameConversation({
      userId: userA,
      conversationId: newer.id,
      title: "Renamed newer",
    });
    assert.equal(renamed?.title, "Renamed newer");

    const listedAfterRename = await service.listConversations({
      userId: userA,
      limit: 10,
    });
    assert.equal(listedAfterRename[0]?.id, newer.id);
    assert.equal(listedAfterRename[0]?.title, "Renamed newer");

    const crossTenantRename = await service.renameConversation({
      userId: userB,
      conversationId: newer.id,
      title: "Must not rename",
    });
    assert.equal(crossTenantRename, null);

    const archivedNewer = await service.archiveConversation({
      userId: userA,
      conversationId: newer.id,
    });
    assert.equal(archivedNewer.outcome, "archived");

    const repeatedArchive = await service.archiveConversation({
      userId: userA,
      conversationId: newer.id,
    });
    assert.equal(repeatedArchive.outcome, "already_archived");

    const renameAfterArchive = await service.renameConversation({
      userId: userA,
      conversationId: newer.id,
      title: "Must stay archived",
    });
    assert.equal(renameAfterArchive, null);

    const listedAfterArchive = await service.listConversations({
      userId: userA,
      limit: 10,
    });
    assert.deepEqual(
      listedAfterArchive.map((conversation) => conversation.id),
      [older.id],
    );

    const archivedPage = await service.listConversations({
      userId: userA,
      limit: 10,
      scope: "archived",
    });
    assert.deepEqual(
      archivedPage.map((conversation) => conversation.id),
      [newer.id, archived.id],
    );

    const storedArchived = await service.getConversation({
      userId: userA,
      conversationId: newer.id,
    });
    assert.equal(storedArchived?.lifecycleStatus, "archived");

    await assert.rejects(
      service.appendUserMessage({
        userId: userA,
        conversationId: newer.id,
        parentMessageId: null,
        blocks: [{ kind: "text", text: "must not write archived chat" }],
      }),
      /not found/i,
    );

    const restored = await service.restoreConversation({
      userId: userA,
      conversationId: newer.id,
    });
    assert.equal(restored.outcome, "restored");
    assert.equal(
      (await service.restoreConversation({
        userId: userA,
        conversationId: newer.id,
      })).outcome,
      "already_active",
    );

    const deleted = await service.deleteConversation({
      userId: userA,
      conversationId: newer.id,
    });
    assert.equal(deleted.outcome, "deleted");

    const repeatedDelete = await service.deleteConversation({
      userId: userA,
      conversationId: newer.id,
    });
    assert.equal(repeatedDelete.outcome, "not_found");

    assert.equal(
      await service.getConversation({
        userId: userA,
        conversationId: newer.id,
      }),
      null,
    );

    assert.equal(
      await currentPathReader.readCurrentPath({
        userId: userA,
        conversationId: newer.id,
        limit: 100,
      }),
      null,
    );

    const busyConversation = await service.createConversation({
      userId: userA,
      title: "Busy",
    });
    const busyUserMessage = await service.appendUserMessage({
      userId: userA,
      conversationId: busyConversation.id,
      parentMessageId: null,
      blocks: [{ kind: "text", text: "in flight" }],
    });
    const busyPrepareId = crypto.randomUUID();
    await database.db.insert(nativeLiveTurnPreparations).values({
      id: busyPrepareId,
      userId: userA,
      requestId: crypto.randomUUID(),
      conversationId: busyConversation.id,
      operation: "send",
      requestHash: "a".repeat(64),
      canonicalUserMessageId: busyUserMessage.id,
      runtimeMode: "new",
      parentProviderSessionId: null,
      prompt: "in flight",
      status: "prepared",
      dispatchStatus: "staged",
    });

    const busyDelete = await service.deleteConversation({
      userId: userA,
      conversationId: busyConversation.id,
    });
    assert.equal(busyDelete.outcome, "busy");

    await database.db
      .update(nativeLiveTurnPreparations)
      .set({ dispatchStatus: "rejected" })
      .where(eq(nativeLiveTurnPreparations.id, busyPrepareId));

    const deleteAfterTerminal = await service.deleteConversation({
      userId: userA,
      conversationId: busyConversation.id,
    });
    assert.equal(deleteAfterTerminal.outcome, "deleted");

    const crossTenantDelete = await service.deleteConversation({
      userId: userB,
      conversationId: older.id,
    });
    assert.equal(crossTenantDelete.outcome, "not_found");
  },
);
