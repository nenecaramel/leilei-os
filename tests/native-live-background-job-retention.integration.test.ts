import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { nativeLiveBackgroundModelJobs, users } from "../src/database/schema.js";
import { DrizzleNativeLiveWorkAvailability } from "../src/domains/bridge/relay/native-live-work-wake.js";
import { deleteExpiredNativeLiveBackgroundModelJobsBatch } from "../src/domains/retention/native-live-background-job-retention.js";

const enabled = process.env.RUN_NATIVE_LIVE_RELAY_DATABASE_TEST === "1";

test("stored background jobs never count as work and consumed ones expire", { skip: !enabled }, async (t) => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required");
  const database = createDatabase(databaseUrl, { ssl: false });
  const [user] = await database.db.insert(users).values({
    email: `background-retention-${crypto.randomUUID()}@example.com`,
    displayName: "Background Retention",
  }).returning({ id: users.id });
  assert.ok(user);
  t.after(async () => {
    try {
      await database.db.delete(nativeLiveBackgroundModelJobs).where(eq(nativeLiveBackgroundModelJobs.userId, user.id));
      await database.db.delete(users).where(eq(users.id, user.id));
    } finally {
      await database.close();
    }
  });

  const job = {
    userId: user.id,
    subjectId: "G",
    taskKind: "proactivity_deliberate",
    promptContractVersion: "retention-test-v1",
    prompt: "synthetic",
  };
  const pending = crypto.randomUUID(), unconsumed = crypto.randomUUID();
  const recent = crypto.randomUUID(), expired = crypto.randomUUID();
  const old = new Date("2026-09-01T00:00:00.000Z");
  const cutoff = new Date("2026-09-08T00:00:00.000Z");
  const done = { status: "completed" as const, resultText: "{}" };
  await database.db.insert(nativeLiveBackgroundModelJobs).values([
    { ...job, id: pending, status: "pending" },
    { ...job, ...done, id: unconsumed, workflowKind: "proactivity_wake", workflowRunId: crypto.randomUUID(),
      workflowPayload: { version: 1 }, completedAt: old, consumedAt: null },
    { ...job, ...done, id: recent, completedAt: cutoff, consumedAt: cutoff },
    { ...job, ...done, id: expired, completedAt: old, consumedAt: old },
  ]);

  assert.equal(await new DrizzleNativeLiveWorkAvailability(database.db).hasWork({ userId: user.id }), false);

  assert.equal(await deleteExpiredNativeLiveBackgroundModelJobsBatch(database.db, cutoff, 100), 1);
  const left = await database.db.select({ id: nativeLiveBackgroundModelJobs.id })
    .from(nativeLiveBackgroundModelJobs).where(eq(nativeLiveBackgroundModelJobs.userId, user.id));
  assert.deepEqual(left.map((row) => row.id).sort(), [pending, unconsumed, recent].sort());
  await assert.rejects(deleteExpiredNativeLiveBackgroundModelJobsBatch(database.db, cutoff, 0), RangeError);
});
