import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { users } from "../src/database/schema.js";
import {
  ActiveUserAuthorizationError,
} from "../src/domains/require-active-user.js";
import {
  requireActiveUserInTransaction,
} from "../src/domains/require-active-user-transaction.js";

const RUN_INTEGRATION =
  process.env.RUN_ACTIVE_USER_DATABASE_INTEGRATION_TEST === "1" &&
  Boolean(process.env.DATABASE_URL);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForScheduling(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 75));
}

test(
  "real PostgreSQL active-user share lock serializes disable against durable mutations",
  { skip: !RUN_INTEGRATION },
  async () => {
    const databaseUrl = process.env.DATABASE_URL!;
    const schemaName = `active_user_atomicity_${randomBytes(8).toString("hex")}`;
    const localDatabase = ["127.0.0.1", "localhost"].includes(
      new URL(databaseUrl).hostname,
    );
    const ssl = localDatabase ? false : "require";
    const admin = postgres(databaseUrl, { max: 1, prepare: false, ssl });

    try {
      await admin.unsafe(`CREATE SCHEMA "${schemaName}"`);
      await admin.unsafe(`
        CREATE TABLE "${schemaName}".users (
          id uuid PRIMARY KEY,
          status varchar(16) NOT NULL DEFAULT 'active'
        );
      `);

      const makeClient = () => postgres(databaseUrl, {
        max: 1,
        prepare: false,
        ssl,
        connection: { search_path: schemaName },
      });
      const appClient = makeClient();
      const disableClient = makeClient();
      const blockerClient = makeClient();
      const db = drizzle(appClient, { schema: { users } });

      try {
        const mutationUser = randomUUID();
        const disabledBeforeGuardUser = randomUUID();
        await appClient`
          INSERT INTO users (id, status)
          VALUES
            (${mutationUser}::uuid, 'active'),
            (${disabledBeforeGuardUser}::uuid, 'active')
        `;

        const mutationLockReady = deferred();
        const releaseMutation = deferred();
        const mutation = db.transaction(async (transaction) => {
          await requireActiveUserInTransaction(transaction as never, mutationUser);
          mutationLockReady.resolve();
          await releaseMutation.promise;
        });
        await mutationLockReady.promise;

        let disableSettled = false;
        const disable = disableClient`
          UPDATE users
          SET status = 'disabled'
          WHERE id = ${mutationUser}::uuid
        `.finally(() => {
          disableSettled = true;
        });

        await waitForScheduling();
        assert.equal(
          disableSettled,
          false,
          "disabling must wait while the mutation transaction holds FOR SHARE",
        );

        releaseMutation.resolve();
        await mutation;
        await disable;
        const [disabledAfterMutation] = await appClient`
          SELECT status FROM users WHERE id = ${mutationUser}::uuid
        `;
        assert.equal(disabledAfterMutation?.status, "disabled");

        const blockerReady = deferred();
        const releaseBlocker = deferred();
        const blocker = blockerClient.begin(async (transaction) => {
          await transaction`
            SELECT id
            FROM users
            WHERE id = ${disabledBeforeGuardUser}::uuid
            FOR UPDATE
          `;
          await transaction`
            UPDATE users
            SET status = 'disabled'
            WHERE id = ${disabledBeforeGuardUser}::uuid
          `;
          blockerReady.resolve();
          await releaseBlocker.promise;
        });
        await blockerReady.promise;

        let guardSettled = false;
        const guardedMutation = db.transaction(async (transaction) =>
          requireActiveUserInTransaction(
            transaction as never,
            disabledBeforeGuardUser,
          ),
        ).finally(() => {
          guardSettled = true;
        });

        await waitForScheduling();
        assert.equal(
          guardSettled,
          false,
          "active-user guard must wait for a concurrent user-row update",
        );

        releaseBlocker.resolve();
        await blocker;
        await assert.rejects(
          guardedMutation,
          (error: unknown) =>
            error instanceof ActiveUserAuthorizationError &&
            error.code === "USER_DISABLED",
        );
      } finally {
        await Promise.all([
          appClient.end(),
          disableClient.end(),
          blockerClient.end(),
        ]);
      }
    } finally {
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.end();
    }
  },
);
