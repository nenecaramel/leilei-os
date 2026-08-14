import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { resolveRailwayMigrationDatabaseUrl } from "./railway-private-postgres.js";

const EXPECTED_0017_CREATED_AT = 1786590053042;
const EXPECTED_0018_CREATED_AT = 1786645516211;
const ROLLBACK_SIGNAL = Symbol("rollback-0018-probe");

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the 0018 rollback probe.");
  }

  const migration = readMigrationFiles({ migrationsFolder: "./drizzle" })
    .find((candidate) => candidate.folderMillis === EXPECTED_0018_CREATED_AT);
  if (!migration || migration.sql.length !== 3) {
    throw new Error("Expected 0018 migration metadata was not found.");
  }

  const resolvedUrl = resolveRailwayMigrationDatabaseUrl(
    databaseUrl,
    process.env.RAILWAY_ENVIRONMENT_ID,
  );
  const client = postgres(resolvedUrl, { max: 1, prepare: false, ssl: "require" });

  try {
    const before = await client<{ relation: string | null; created_at: string | null }[]>`
      select
        to_regclass('public.data_import_runs')::text as relation,
        (select created_at::text from drizzle.__drizzle_migrations order by created_at desc limit 1) as created_at
    `;
    if (before[0]?.relation || Number(before[0]?.created_at) !== EXPECTED_0017_CREATED_AT) {
      throw new Error("Production is not at the expected pre-0018 state.");
    }

    try {
      await client.begin(async (transaction) => {
        for (const statement of migration.sql) {
          await transaction.unsafe(statement);
        }

        await transaction`
          insert into drizzle.__drizzle_migrations ("hash", "created_at")
          values (${migration.hash}, ${migration.folderMillis})
        `;

        const during = await transaction<{ relation: string | null; created_at: string | null }[]>`
          select
            to_regclass('public.data_import_runs')::text as relation,
            (select created_at::text from drizzle.__drizzle_migrations order by created_at desc limit 1) as created_at
        `;
        if (!during[0]?.relation || Number(during[0]?.created_at) !== EXPECTED_0018_CREATED_AT) {
          throw new Error("0018 schema or ledger row was not visible inside the transaction.");
        }

        throw ROLLBACK_SIGNAL;
      });
      throw new Error("0018 rollback probe transaction unexpectedly committed.");
    } catch (error) {
      if (error !== ROLLBACK_SIGNAL) {
        throw error;
      }
    }

    const after = await client<{ relation: string | null; created_at: string | null }[]>`
      select
        to_regclass('public.data_import_runs')::text as relation,
        (select created_at::text from drizzle.__drizzle_migrations order by created_at desc limit 1) as created_at
    `;
    if (after[0]?.relation || Number(after[0]?.created_at) !== EXPECTED_0017_CREATED_AT) {
      throw new Error("Rollback probe left a schema or migration-ledger change committed.");
    }
  } finally {
    await client.end();
  }
}

main().catch(() => {
  console.error("0018 rollback probe failed.");
  process.exitCode = 1;
});
