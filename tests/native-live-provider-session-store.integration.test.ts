import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  nativeLiveProviderSessionEntries,
  users,
} from "../src/database/schema.js";
import { DrizzleNativeLiveProviderSessionStoreRepository } from "../src/domains/bridge/provider-session/native-live-provider-session-store.js";


const enabled =
  process.env.RUN_NATIVE_LIVE_PROVIDER_SESSION_STORE_DATABASE_TEST === "1";

test(
  "stored provider transcripts keep order, replay idempotently and stay isolated by tenant and session",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");
    const database = createDatabase(databaseUrl, { ssl: false });

    const suffix = crypto.randomUUID();
    const created = await database.db
      .insert(users)
      .values([
        {
          email: "session-store-a-" + suffix + "@example.com",
          displayName: "Session Store A",
        },
        {
          email: "session-store-b-" + suffix + "@example.com",
          displayName: "Session Store B",
        },
      ])
      .returning({ id: users.id });
    assert.equal(created.length, 2);
    const userA = created[0]!.id;
    const userB = created[1]!.id;

    t.after(async () => {
      try {
        await database.db
          .delete(nativeLiveProviderSessionEntries)
          .where(eq(nativeLiveProviderSessionEntries.userId, userA));
        await database.db
          .delete(nativeLiveProviderSessionEntries)
          .where(eq(nativeLiveProviderSessionEntries.userId, userB));
        await database.db.delete(users).where(eq(users.id, userA));
        await database.db.delete(users).where(eq(users.id, userB));
      } finally {
        await database.close();
      }
    });

    const store = new DrizzleNativeLiveProviderSessionStoreRepository(database.db);
    const main = {
      sessionId: "shared-session",
    };
    const sub = {
      ...main,
      subpath: "subagents/research",
    };

    await store.append({
      userId: userA,
      key: main,
      appendBatchId: crypto.randomUUID(),
      entries: [{ type: "user", n: 1 }],
    });
    await store.append({
      userId: userA,
      key: main,
      appendBatchId: crypto.randomUUID(),
      entries: [
        { type: "assistant", n: 2 },
        { type: "result", n: 3 },
      ],
    });
    await store.append({
      userId: userA,
      key: sub,
      appendBatchId: crypto.randomUUID(),
      entries: [{ type: "subagent", n: 4 }],
    });
    await store.append({
      userId: userA,
      key: {
        sessionId: "other-session",
      },
      appendBatchId: crypto.randomUUID(),
      entries: [{ type: "user", session: "b" }],
    });
    await store.append({
      userId: userB,
      key: main,
      appendBatchId: crypto.randomUUID(),
      entries: [{ type: "user", user: "b" }],
    });

    const retryBatchId = crypto.randomUUID();
    await store.append({
      userId: userA,
      key: main,
      appendBatchId: retryBatchId,
      entries: [{ type: "assistant", retry: true }],
    });
    await store.append({
      userId: userA,
      key: main,
      appendBatchId: retryBatchId,
      entries: [{ type: "assistant", retry: true }],
    });

    assert.deepEqual(
      await store.load({ userId: userA, key: main }),
      [
        { type: "user", n: 1 },
        { type: "assistant", n: 2 },
        { type: "result", n: 3 },
        { type: "assistant", retry: true },
      ],
      "one append batch replay must be idempotent",
    );

    assert.equal(
      await store.getStatus({
        userId: userA,
        sessionId: "shared-session",
      }),
      null,
    );
    await store.setStatus({
      userId: userA,
      sessionId: "shared-session",
      state: "incomplete",
    });
    assert.equal(
      await store.getStatus({
        userId: userA,
        sessionId: "shared-session",
      }),
      "incomplete",
    );
    await store.setStatus({
      userId: userA,
      sessionId: "shared-session",
      state: "complete",
    });
    assert.equal(
      await store.getStatus({
        userId: userA,
        sessionId: "shared-session",
      }),
      "complete",
    );
    assert.deepEqual(
      await store.load({ userId: userA, key: sub }),
      [{ type: "subagent", n: 4 }],
    );
    assert.deepEqual(
      await store.load({
        userId: userA,
        key: {
          sessionId: "other-session",
        },
      }),
      [{ type: "user", session: "b" }],
    );
    assert.deepEqual(
      await store.load({ userId: userB, key: main }),
      [{ type: "user", user: "b" }],
    );
    assert.equal(
      await store.load({
        userId: userA,
        key: {
          sessionId: "missing",
        },
      }),
      null,
    );
  },
);
