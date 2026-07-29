import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { seedPhase2ValidationData } from "../scripts/seed-phase-2.js";

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
          });

          const rows = await transaction<
            { key: string; source: string }[]
          >`
            select key, source
            from core_memories
            where user_id = ${userId}::uuid
              and key in ('preferred_name', 'response_style')
            order by key
          `;

          assert.deepEqual(Array.from(rows), [
            {
              key: "preferred_name",
              source: "web",
            },
            {
              key: "response_style",
              source: "phase_2_validation",
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
