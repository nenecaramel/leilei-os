import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import {
  phase2SeedEnvSchema,
  seedPhase2ValidationData,
} from "../scripts/seed-phase-2.js";

test("Phase 2 seed requires an explicit supported author", () => {
  const base = {
    DATABASE_URL: "postgres://localhost/phase2",
    MCP_USER_ID: randomUUID(),
    SEED_USER_EMAIL: "seed@example.invalid",
    SEED_USER_DISPLAY_NAME: "Seed",
  };
  assert.equal(phase2SeedEnvSchema.safeParse(base).success, false);
  assert.equal(
    phase2SeedEnvSchema.safeParse({ ...base, SEED_CONTENT_AUTHOR: "X" }).success,
    false,
  );
  assert.equal(
    phase2SeedEnvSchema.safeParse({ ...base, SEED_CONTENT_AUTHOR: "L" }).success,
    true,
  );
  assert.equal(
    phase2SeedEnvSchema.safeParse({ ...base, SEED_CONTENT_AUTHOR: "C" }).success,
    true,
  );
});

const databaseUrl = process.env.PHASE_2_SEED_TEST_DATABASE_URL;
const RUN_INTEGRATION =
  process.env.RUN_PHASE_2_SEED_INTEGRATION_TEST === "1" &&
  Boolean(databaseUrl);

class RollbackPhase2SeedTest extends Error {}

test(
  "Phase 2 seed preserves an existing source and labels new rows",
  { skip: !RUN_INTEGRATION },
  async () => {
    const sql = postgres(databaseUrl!, {
      max: 1,
      prepare: false,
      ssl:
        process.env.PHASE_2_SEED_TEST_DATABASE_SSL === "require"
          ? "require"
          : false,
    });

    try {
      await assert.rejects(
        sql.begin(async (transaction) => {
          const userId = randomUUID();

          await transaction`
            insert into users (id, email, display_name, status)
            values (
              ${userId}::uuid,
              ${`phase-2-seed-${userId}@example.invalid`},
              'Phase 2 seed fixture',
              'active'
            )
          `;
          await transaction`
            insert into core_memories (
              user_id,
              category,
              key,
              content,
              visibility,
              source,
              status,
              sort_order
            )
            values (
              ${userId}::uuid,
              'profile'::memory_category,
              'preferred_name',
              'Existing web memory',
              'assistant'::memory_visibility,
              'web',
              'active',
              1
            )
          `;

          await seedPhase2ValidationData(transaction, {
            userId,
            email: `phase-2-seed-${userId}@example.invalid`,
            displayName: "Phase 2 seed fixture",
            author: "G",
          });

          const rows = await transaction<
            { key: string; source: string; author: string }[]
          >`
            select key, source, author
            from core_memories
            where user_id = ${userId}::uuid
              and key in ('preferred_name', 'response_style')
            order by key
          `;

          assert.deepEqual(Array.from(rows), [
            {
              key: "preferred_name",
              source: "web",
              author: "G",
            },
            {
              key: "response_style",
              source: "phase_2_validation",
              author: "G",
            },
          ]);

          throw new RollbackPhase2SeedTest();
        }),
        RollbackPhase2SeedTest,
      );
    } finally {
      await sql.end();
    }
  },
);
