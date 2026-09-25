import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { conversations, users } from "../src/database/schema.js";
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
      ssl: "require",
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

    const database = createDatabase(databaseUrl, {
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

    const deleted = await service.deleteConversation({
      userId: userA,
      conversationId: newer.id,
    });
    assert.equal(deleted.outcome, "deleted");

    const repeated = await service.deleteConversation({
      userId: userA,
      conversationId: newer.id,
    });
    assert.equal(repeated.outcome, "already_deleted");

    const listedAfterDelete = await service.listConversations({
      userId: userA,
      limit: 10,
    });
    assert.deepEqual(
      listedAfterDelete.map((conversation) => conversation.id),
      [older.id],
    );

    const storedDeleted = await service.getConversation({
      userId: userA,
      conversationId: newer.id,
    });
    assert.equal(storedDeleted?.lifecycleStatus, "deleted");

    assert.equal(
      await currentPathReader.readCurrentPath({
        userId: userA,
        conversationId: newer.id,
        limit: 100,
      }),
      null,
    );

    await assert.rejects(
      service.appendUserMessage({
        userId: userA,
        conversationId: newer.id,
        parentMessageId: null,
        blocks: [{ kind: "text", text: "must not revive deleted chat" }],
      }),
      /not found/i,
    );

    const crossTenantDelete = await service.deleteConversation({
      userId: userB,
      conversationId: older.id,
    });
    assert.equal(crossTenantDelete.outcome, "not_found");
  },
);
