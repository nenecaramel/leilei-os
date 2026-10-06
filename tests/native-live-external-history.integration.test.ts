import assert from "node:assert/strict";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversationMessages,
  conversations,
  users,
} from "../src/database/schema.js";
import {
  NativeLiveExternalSessionBridgeService,
} from "../src/domains/bridge/provider-session/native-live-external-session-bridge.js";

const enabled =
  process.env.RUN_NATIVE_LIVE_EXTERNAL_HISTORY_DATABASE_TEST === "1";

test(
  "external Claude history snapshot stays read-only and separate from canonical messages",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");

    const database = createDatabase(databaseUrl, { ssl: false });
    const suffix = crypto.randomUUID();
    const createdUsers = await database.db
      .insert(users)
      .values([
        {
          email: `external-history-a-${suffix}@example.com`,
          displayName: "External History A",
        },
        {
          email: `external-history-b-${suffix}@example.com`,
          displayName: "External History B",
        },
      ])
      .returning({ id: users.id });
    const userA = createdUsers[0]!.id;
    const userB = createdUsers[1]!.id;

    t.after(async () => {
      try {
        await database.db.delete(users).where(eq(users.id, userA));
        await database.db.delete(users).where(eq(users.id, userB));
      } finally {
        await database.close();
      }
    });

    const requestId = crypto.randomUUID();
    const sourceSessionId =
      "3c9137a0-34db-4389-bdd5-07888afc8a07";
    await database.db.execute(sql`
      INSERT INTO native_live_external_session_requests (
        id,
        user_id,
        status,
        expires_at,
        result,
        completed_at
      ) VALUES (
        ${requestId}::uuid,
        ${userA}::uuid,
        'completed',
        now() + interval '1 hour',
        ${JSON.stringify([{
          sessionId: sourceSessionId,
          summary: "Current Claude window",
          customTitle: null,
          firstPrompt: "Claude.",
          gitBranch: "main",
          lastModified: 1790710000000,
          createdAt: 1790200000000,
          workingDirectory: "/Users/leilei/Projects/leilei-os",
        }])}::jsonb,
        now()
      )
    `);

    const service = new NativeLiveExternalSessionBridgeService(
      database.db,
    );
    const history = {
      sourceLabel: "claude-main-branch（9.24-9.29）.jsonl",
      timeZone: "Asia/Shanghai",
      messages: [
        {
          role: "user" as const,
          time: "2026-09-24T14:30:03.856+08:00",
          content: "Claude.",
        },
        {
          role: "assistant" as const,
          time: "2026-09-24T14:30:09.069+08:00",
          content: "Hello! How can I help you today?",
        },
        {
          role: "user" as const,
          time: "2026-09-24T14:33:07.314+08:00",
          content: "kiss me.",
        },
      ],
    };

    const conversation = await service.createConversationFromSession({
      userId: userA,
      requestId,
      sourceSessionId,
      historySnapshot: history,
    });
    assert.equal(conversation.currentHeadMessageId, null);

    const canonicalRows = await database.db
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversation.id));
    assert.deepEqual(
      canonicalRows,
      [],
      "history snapshot must not create canonical messages",
    );

    const snapshot = await service.readConversationHistorySnapshot({
      userId: userA,
      conversationId: conversation.id,
    });
    assert.ok(snapshot);
    assert.equal(snapshot.sourceProviderSessionId, sourceSessionId);
    assert.equal(snapshot.sourceLabel, history.sourceLabel);
    assert.equal(snapshot.timeZone, "Asia/Shanghai");
    assert.equal(snapshot.messageCount, 3);
    assert.deepEqual(
      snapshot.messages.map(({ ordinal, role, time, content }) => ({
        ordinal,
        role,
        time,
        content,
      })),
      history.messages.map((message, ordinal) => ({
        ordinal,
        ...message,
      })),
    );

    assert.equal(
      await service.readConversationHistorySnapshot({
        userId: userB,
        conversationId: conversation.id,
      }),
      null,
      "another user must not read the snapshot",
    );

    await database.db
      .delete(conversations)
      .where(eq(conversations.id, conversation.id));
    const afterDelete = await database.db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM native_live_conversation_history_snapshots
      WHERE conversation_id = ${conversation.id}::uuid
    `);
    assert.equal(afterDelete[0]?.count, 0);
  },
);
