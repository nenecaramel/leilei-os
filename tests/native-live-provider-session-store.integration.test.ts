import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  nativeLiveProviderSessionEntries,
  users,
} from "../src/database/schema.js";
import {
  DrizzleNativeLiveProviderSessionStoreRepository,
  NativeLiveProviderSessionStoreService,
} from "../src/domains/bridge/provider-session/native-live-provider-session-store.js";

const enabled =
  process.env.RUN_NATIVE_LIVE_PROVIDER_SESSION_STORE_DATABASE_TEST === "1";

test(
  "provider SessionStore preserves SDK ordering, tenant isolation, provider-session isolation, and delete semantics",
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

    const service = new NativeLiveProviderSessionStoreService(
      new DrizzleNativeLiveProviderSessionStoreRepository(database.db),
    );
    const main = {
      sessionId: "shared-session",
    };
    const sub = {
      ...main,
      subpath: "subagents/research",
    };

    await service.append({
      userId: userA,
      key: main,
      appendBatchId: crypto.randomUUID(),
      entries: [{ type: "user", n: 1 }],
    });
    await service.append({
      userId: userA,
      key: main,
      appendBatchId: crypto.randomUUID(),
      entries: [
        { type: "assistant", n: 2 },
        { type: "result", n: 3 },
      ],
    });
    await service.append({
      userId: userA,
      key: sub,
      appendBatchId: crypto.randomUUID(),
      entries: [{ type: "subagent", n: 4 }],
    });
    await service.append({
      userId: userA,
      key: {
        sessionId: "other-session",
      },
      appendBatchId: crypto.randomUUID(),
      entries: [{ type: "user", session: "b" }],
    });
    await service.append({
      userId: userB,
      key: main,
      appendBatchId: crypto.randomUUID(),
      entries: [{ type: "user", user: "b" }],
    });

    const retryBatchId = crypto.randomUUID();
    await service.append({
      userId: userA,
      key: main,
      appendBatchId: retryBatchId,
      entries: [{ type: "assistant", retry: true }],
    });
    await service.append({
      userId: userA,
      key: main,
      appendBatchId: retryBatchId,
      entries: [{ type: "assistant", retry: true }],
    });

    assert.deepEqual(
      await service.load({ userId: userA, key: main }),
      [
        { type: "user", n: 1 },
        { type: "assistant", n: 2 },
        { type: "result", n: 3 },
        { type: "assistant", retry: true },
      ],
      "one append batch replay must be idempotent",
    );

    assert.equal(
      await service.getStatus({
        userId: userA,
        sessionId: "shared-session",
      }),
      null,
    );
    await service.markIncomplete({
      userId: userA,
      sessionId: "shared-session",
    });
    assert.equal(
      await service.getStatus({
        userId: userA,
        sessionId: "shared-session",
      }),
      "incomplete",
    );
    await service.markComplete({
      userId: userA,
      sessionId: "shared-session",
    });
    assert.equal(
      await service.getStatus({
        userId: userA,
        sessionId: "shared-session",
      }),
      "complete",
    );
    assert.deepEqual(
      await service.load({ userId: userA, key: sub }),
      [{ type: "subagent", n: 4 }],
    );
    assert.deepEqual(
      await service.load({
        userId: userA,
        key: {
          sessionId: "other-session",
        },
      }),
      [{ type: "user", session: "b" }],
    );
    assert.deepEqual(
      await service.load({ userId: userB, key: main }),
      [{ type: "user", user: "b" }],
    );
    assert.equal(
      await service.load({
        userId: userA,
        key: {
          sessionId: "missing",
        },
      }),
      null,
    );

    const sessions = await service.listSessions({
      userId: userA,
    });
    assert.deepEqual(
      sessions.map((entry) => entry.sessionId).sort(),
      ["other-session", "shared-session"],
      "subagent-only keys must not appear as sessions",
    );
    assert.ok(sessions[0]!.mtime > 1_000_000_000_000);
    assert.deepEqual(
      await service.listSubkeys({
        userId: userA,
        sessionId: "shared-session",
      }),
      ["subagents/research"],
    );

    await service.delete({ userId: userA, key: sub });
    assert.equal(
      await service.load({ userId: userA, key: sub }),
      null,
    );
    assert.deepEqual(
      await service.load({ userId: userA, key: main }),
      [
        { type: "user", n: 1 },
        { type: "assistant", n: 2 },
        { type: "result", n: 3 },
        { type: "assistant", retry: true },
      ],
    );

    await service.append({
      userId: userA,
      key: sub,
      appendBatchId: crypto.randomUUID(),
      entries: [{ type: "subagent", n: 5 }],
    });
    await service.delete({ userId: userA, key: main });
    assert.equal(
      await service.load({ userId: userA, key: main }),
      null,
    );
    assert.equal(
      await service.getStatus({
        userId: userA,
        sessionId: "shared-session",
      }),
      null,
      "main transcript deletion must remove portability status",
    );
    assert.equal(
      await service.load({ userId: userA, key: sub }),
      null,
      "main transcript deletion must cascade all subpaths for the session",
    );
    assert.deepEqual(
      await service.load({
        userId: userA,
        key: {
          sessionId: "other-session",
        },
      }),
      [{ type: "user", session: "b" }],
      "main deletion must not cross provider-session identity",
    );
    assert.deepEqual(
      await service.load({ userId: userB, key: main }),
      [{ type: "user", user: "b" }],
      "main deletion must not cross user identity",
    );
  },
);
