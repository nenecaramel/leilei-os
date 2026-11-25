import assert from "node:assert/strict";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users } from "../src/database/schema.js";
import { DrizzleNativeLiveProviderSessionStoreRepository } from "../src/domains/bridge/provider-session/native-live-provider-session-store.js";
import { providerSessionUnreferenced } from "../src/domains/bridge/provider-session/native-live-provider-session-references.js";

const enabled = process.env.RUN_ROLLBACK_PRESERVATION_DATABASE_TEST === "1";

test("rollback preserves externally owned native sessions and blocks their cleanup", { skip: !enabled }, async () => {
  const rawUrl = process.env.DATABASE_URL;
  assert.ok(rawUrl, "A dedicated local test DATABASE_URL is required");
  const url = new URL(rawUrl);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "Refusing a non-local database");
  assert.equal(url.pathname, "/leileios_native_session_test", "Refusing a non-disposable database");
  assert.notEqual(process.env.NODE_ENV, "production", "Refusing production");
  const database = createDatabase(rawUrl, { ssl: false });
  const [owner] = await database.db.insert(users).values({
    email: `rollback-preserved-${crypto.randomUUID()}@example.com`,
    displayName: "Rollback preservation regression",
  }).returning({ id: users.id });
  assert.ok(owner);
  try {
    const sessionId = crypto.randomUUID();
    const store = new DrizzleNativeLiveProviderSessionStoreRepository(database.db);
    const main = { sessionId };
    const sub = { sessionId, subpath: "subagents/test" };
    const mainEntry = { type: "user", marker: "preserved" };
    const subEntry = { type: "assistant", marker: "subagent" };
    await store.append({ userId: owner.id, key: main, appendBatchId: crypto.randomUUID(), entries: [mainEntry] });
    await store.append({ userId: owner.id, key: sub, appendBatchId: crypto.randomUUID(), entries: [subEntry] });
    await store.setStatus({ userId: owner.id, sessionId, state: "complete" });
    await database.db.execute(sql`
      UPDATE native_live_provider_session_store_status
      SET preserve_external_session = true
      WHERE user_id = ${owner.id}::uuid AND provider_session_id = ${sessionId}
    `);
    await store.setStatus({ userId: owner.id, sessionId, state: "incomplete" });
    await store.setStatus({ userId: owner.id, sessionId, state: "complete" });
    const [status] = await database.db.execute<{ is_preserved: boolean }>(sql`
      SELECT preserve_external_session AS is_preserved
      FROM native_live_provider_session_store_status
      WHERE user_id = ${owner.id}::uuid AND provider_session_id = ${sessionId}
    `);
    assert.equal(status?.is_preserved, true, "status changes must keep the sticky marker");
    assert.deepEqual(await store.load({ userId: owner.id, key: main }), [mainEntry]);
    assert.deepEqual(await store.load({ userId: owner.id, key: sub }), [subEntry]);
    const [candidate] = await database.db.execute<{ eligible: boolean }>(sql`
      SELECT ${providerSessionUnreferenced({ userId: owner.id, providerSessionId: sessionId })} AS eligible
    `);
    assert.equal(candidate?.eligible, false, "cleanup must refuse a preserved provider UUID");
  } finally {
    try {
      await database.db.delete(users).where(eq(users.id, owner.id));
    } finally {
      await database.close();
    }
  }
});
