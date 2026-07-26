import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { toyCommands } from "../src/database/schema.js";
import { DrizzleToyCommandRepository } from "../src/domains/toy/toy-command-repository.js";

const RUN_INTEGRATION =
  process.env.RUN_TOY_DATABASE_INTEGRATION_TEST === "1" &&
  Boolean(process.env.DATABASE_URL);

test(
  "real PostgreSQL queue atomically claims with SKIP LOCKED and enforces priority, replacement and ownership",
  { skip: !RUN_INTEGRATION },
  async () => {
    const databaseUrl = process.env.DATABASE_URL!;
    const schemaName = `toy_queue_test_${randomBytes(8).toString("hex")}`;
    const admin = postgres(databaseUrl, { max: 1, prepare: false, ssl: "require" });

    try {
      await admin.unsafe(`CREATE SCHEMA "${schemaName}"`);
      await admin.unsafe(`
        CREATE TYPE "${schemaName}".toy_command_action AS ENUM ('set', 'stop');
        CREATE TYPE "${schemaName}".toy_command_status AS ENUM
          ('pending', 'claimed', 'completed', 'failed', 'expired');
        CREATE TABLE "${schemaName}".users (
          id uuid PRIMARY KEY,
          email varchar(320) NOT NULL UNIQUE
        );
        CREATE TABLE "${schemaName}".toy_commands (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL,
          action "${schemaName}".toy_command_action NOT NULL,
          percent integer,
          status "${schemaName}".toy_command_status NOT NULL DEFAULT 'pending',
          created_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz NOT NULL,
          claimed_at timestamptz,
          completed_at timestamptz,
          expired_at timestamptz,
          error varchar(500),
          CONSTRAINT toy_user_fk FOREIGN KEY (user_id)
            REFERENCES "${schemaName}".users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
          CONSTRAINT action_allowed CHECK (action IN ('set', 'stop')),
          CONSTRAINT status_allowed CHECK (status IN ('pending', 'claimed', 'completed', 'failed', 'expired')),
          CONSTRAINT action_percent CHECK (
            (action = 'set' AND percent IS NOT NULL AND percent BETWEEN 1 AND 40)
            OR (action = 'stop' AND percent IS NULL)
          ),
          CONSTRAINT expiry_after_creation CHECK (expires_at > created_at),
          CONSTRAINT error_length CHECK (error IS NULL OR char_length(error) <= 500)
        );
        CREATE INDEX toy_claim_idx ON "${schemaName}".toy_commands
          (user_id, status, expires_at, action, created_at, id);
      `);

      const makeClient = () => postgres(databaseUrl, {
        max: 1,
        prepare: false,
        ssl: "require",
        connection: { search_path: schemaName },
      });
      const clientA = makeClient();
      const clientB = makeClient();
      const lockClient = makeClient();
      const dbA = drizzle(clientA, { schema: { toyCommands } });
      const dbB = drizzle(clientB, { schema: { toyCommands } });
      const repositoryA = new DrizzleToyCommandRepository(dbA as never);
      const repositoryB = new DrizzleToyCommandRepository(dbB as never);
      const owner = randomUUID();
      const other = randomUUID();

      try {
        await clientA`
          INSERT INTO users (id, email)
          VALUES
            (${owner}::uuid, ${`toy-owner-${owner}@example.invalid`}),
            (${other}::uuid, ${`toy-other-${other}@example.invalid`})
        `;
        const invalidBase = {
          userId: owner,
          createdAt: new Date("2026-07-26T10:00:00Z"),
          expiresAt: new Date("2026-07-26T10:00:10Z"),
        };
        await assert.rejects(dbA.insert(toyCommands).values({
          ...invalidBase,
          action: "set",
          percent: null,
        }));
        await assert.rejects(dbA.insert(toyCommands).values({
          ...invalidBase,
          action: "set",
          percent: 41,
        }));
        await assert.rejects(dbA.insert(toyCommands).values({
          ...invalidBase,
          action: "stop",
          percent: 1,
        }));
        await assert.rejects(dbA.insert(toyCommands).values({
          ...invalidBase,
          action: "stop",
          percent: null,
          expiresAt: invalidBase.createdAt,
        }));
        await assert.rejects(dbA.insert(toyCommands).values({
          ...invalidBase,
          action: "stop",
          percent: null,
          error: "x".repeat(501),
        }));

        const first = await repositoryA.create(owner, { action: "set", percent: 10 });
        await assert.rejects(
          repositoryA.create(owner, { action: "set", percent: 41 }),
        );
        assert.equal(
          (await dbA.select().from(toyCommands)).find(({ id }) => id === first.id)?.status,
          "pending",
        );
        const replacement = await repositoryA.create(owner, { action: "set", percent: 20 });
        const rowsAfterReplacement = await dbA.select().from(toyCommands);
        assert.equal(rowsAfterReplacement.find(({ id }) => id === first.id)?.status, "expired");
        assert.equal(rowsAfterReplacement.find(({ id }) => id === replacement.id)?.status, "pending");

        const concurrentSets = await Promise.all([
          repositoryA.create(owner, { action: "set", percent: 21 }),
          repositoryB.create(owner, { action: "set", percent: 22 }),
        ]);
        const rowsAfterConcurrentSets = await dbA.select().from(toyCommands);
        const liveConcurrentSets = rowsAfterConcurrentSets.filter(
          ({ id, status }) =>
            concurrentSets.some((command) => command.id === id) &&
            status === "pending",
        );
        assert.equal(liveConcurrentSets.length, 1);

        const otherCommand = await repositoryA.create(other, { action: "set", percent: 30 });
        const stop = await repositoryA.create(owner, { action: "stop" });
        const rowsAfterStop = await dbA.select().from(toyCommands);
        assert.equal(rowsAfterStop.find(({ id }) => id === replacement.id)?.status, "expired");
        assert.equal(rowsAfterStop.find(({ id }) => id === otherCommand.id)?.status, "pending");

        const setAfterStop = await repositoryA.create(owner, { action: "set", percent: 25 });
        const expiredPendingId = randomUUID();
        await dbA.insert(toyCommands).values({
          id: expiredPendingId,
          userId: owner,
          action: "stop",
          status: "pending",
          createdAt: new Date(Date.now() - 20_000),
          expiresAt: new Date(Date.now() - 10_000),
        });
        assert.equal(
          (await dbA.select().from(toyCommands)).find(({ id }) => id === stop.id)?.status,
          "pending",
        );
        const claimedStop = await repositoryA.claim(owner);
        assert.equal(claimedStop?.id, stop.id);
        assert.equal(claimedStop?.claimedAt instanceof Date, true);
        assert.equal(
          (await dbA.select().from(toyCommands))
            .find(({ id }) => id === expiredPendingId)?.status,
          "expired",
        );
        assert.equal((await repositoryA.claim(owner))?.id, setAfterStop.id);
        assert.equal(await repositoryA.claim(owner), null);

        const lockedFirstId = randomUUID();
        const skippedSecondId = randomUUID();
        const lockFixtureNow = Date.now();
        await dbA.insert(toyCommands).values([
          {
            id: lockedFirstId,
            userId: owner,
            action: "stop",
            status: "pending",
            createdAt: new Date(lockFixtureNow),
            expiresAt: new Date(lockFixtureNow + 300_000),
          },
          {
            id: skippedSecondId,
            userId: owner,
            action: "stop",
            status: "pending",
            createdAt: new Date(lockFixtureNow + 1_000),
            expiresAt: new Date(lockFixtureNow + 300_000),
          },
        ]);
        let releaseLock!: () => void;
        let lockAcquired!: () => void;
        const release = new Promise<void>((resolve) => { releaseLock = resolve; });
        const acquired = new Promise<void>((resolve) => { lockAcquired = resolve; });
        const heldLock = lockClient.begin(async (transaction) => {
          await transaction`
            SELECT id
            FROM toy_commands
            WHERE id = ${lockedFirstId}::uuid
              AND user_id = ${owner}::uuid
              AND status = 'pending'
            FOR UPDATE
          `;
          lockAcquired();
          await release;
        });
        await acquired;
        let skippedLockedRow;
        try {
          skippedLockedRow = await repositoryB.claim(owner);
        } finally {
          releaseLock();
          await heldLock;
        }
        assert.equal(skippedLockedRow?.id, skippedSecondId);
        assert.equal((await repositoryA.claim(owner))?.id, lockedFirstId);

        const concurrent = await repositoryA.create(owner, { action: "set", percent: 40 });
        const [claimA, claimB] = await Promise.all([
          repositoryA.claim(owner),
          repositoryB.claim(owner),
        ]);
        assert.deepEqual(
          [claimA?.id, claimB?.id].filter(Boolean),
          [concurrent.id],
        );
        assert.equal((await repositoryB.claim(other))?.id, otherCommand.id);

        const claimed = claimA ?? claimB;
        assert.ok(claimed);
        const completed = await repositoryA.ack(owner, claimed.id, { status: "completed" });
        assert.equal(completed.kind, "updated");
        const completedAt = completed.kind === "updated"
          ? completed.command.completedAt?.toISOString()
          : undefined;
        const repeated = await repositoryA.ack(owner, claimed.id, { status: "completed" });
        assert.equal(repeated.kind, "idempotent");
        assert.equal(
          repeated.kind === "idempotent"
            ? repeated.command.completedAt?.toISOString()
            : undefined,
          completedAt,
        );
        assert.equal(
          (await repositoryA.ack(owner, claimed.id, {
            status: "failed",
            error: "safe bridge failure",
          })).kind,
          "conflict",
        );

        const failedCommand = await repositoryA.create(owner, { action: "set", percent: 35 });
        const claimedFailed = await repositoryA.claim(owner);
        assert.equal(claimedFailed?.id, failedCommand.id);
        const failed = await repositoryA.ack(owner, failedCommand.id, {
          status: "failed",
          error: "safe bridge failure",
        });
        assert.equal(failed.kind, "updated");
        const failedAt = failed.kind === "updated"
          ? failed.command.completedAt?.toISOString()
          : undefined;
        const failedReplay = await repositoryA.ack(owner, failedCommand.id, {
          status: "failed",
          error: "safe bridge failure",
        });
        assert.equal(failedReplay.kind, "idempotent");
        assert.equal(
          failedReplay.kind === "idempotent"
            ? failedReplay.command.completedAt?.toISOString()
            : undefined,
          failedAt,
        );
        assert.equal(
          (await repositoryA.ack(owner, failedCommand.id, {
            status: "failed",
            error: "different safe failure",
          })).kind,
          "conflict",
        );
        assert.equal(
          (await repositoryA.ack(owner, failedCommand.id, {
            status: "completed",
          })).kind,
          "conflict",
        );

        const pending = await repositoryA.create(owner, { action: "stop" });
        assert.equal(
          (await repositoryA.ack(owner, pending.id, { status: "completed" })).kind,
          "conflict",
        );
        assert.equal(
          (await repositoryA.ack(other, pending.id, { status: "completed" })).kind,
          "not_found",
        );

        const expiredId = randomUUID();
        await dbA.insert(toyCommands).values({
          id: expiredId,
          userId: owner,
          action: "stop",
          status: "claimed",
          createdAt: new Date(Date.now() - 20_000),
          expiresAt: new Date(Date.now() - 10_000),
          claimedAt: new Date(Date.now() - 15_000),
        });
        assert.equal(
          (await repositoryA.ack(owner, expiredId, { status: "completed" })).kind,
          "expired",
        );
        assert.equal(
          (await dbA.select().from(toyCommands)).find(({ id }) => id === expiredId)?.status,
          "expired",
        );
      } finally {
        await Promise.all([clientA.end(), clientB.end(), lockClient.end()]);
      }
    } finally {
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.end();
    }
  },
);
