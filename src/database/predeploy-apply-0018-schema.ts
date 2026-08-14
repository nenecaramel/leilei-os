import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import type { MigrationFile } from "./migration-plan.js";
import { resolveRailwayMigrationDatabaseUrl } from "./railway-private-postgres.js";

const EXPECTED_0017_CREATED_AT = 1786590053042;
const EXPECTED_0018_CREATED_AT = 1786645516211;
const MIGRATION_LOCK_KEY = "leilei-os-schema-migrations";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the one-time 0018 schema apply.");
  }

  const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" }) as MigrationFile[];
  const expected0017 = migrations.find((migration) => migration.folderMillis === EXPECTED_0017_CREATED_AT);
  const expected0018 = migrations.find((migration) => migration.folderMillis === EXPECTED_0018_CREATED_AT);
  if (!expected0017 || !expected0018) {
    throw new Error("Checked-in 0017/0018 migration metadata is missing.");
  }

  const resolvedUrl = resolveRailwayMigrationDatabaseUrl(
    databaseUrl,
    process.env.RAILWAY_ENVIRONMENT_ID,
  );
  const client = postgres(resolvedUrl, { max: 1, prepare: false, ssl: "require" });

  try {
    await client.begin(async (transaction) => {
      await transaction`
        select pg_advisory_xact_lock(hashtext(${MIGRATION_LOCK_KEY}))
      `;

      const ledgerRows = await transaction<{ hash: string; created_at: string }[]>`
        select hash, created_at::text as created_at
        from public.leilei_schema_migrations
        order by created_at asc
      `;
      const latest = ledgerRows.at(-1);
      if (
        ledgerRows.length !== 1
        || Number(latest?.created_at) !== EXPECTED_0017_CREATED_AT
        || latest?.hash !== expected0017.hash
      ) {
        throw new Error("Compatible migration ledger is not exactly at validated 0017.");
      }

      const before = await transaction<{ relation: string | null }[]>`
        select to_regclass('public.data_import_runs')::text as relation
      `;
      if (before[0]?.relation) {
        throw new Error("data_import_runs already exists before one-time 0018 schema apply.");
      }

      for (const statement of expected0018.sql) {
        await transaction.unsafe(statement);
      }

      const after = await transaction<{ relation: string | null }[]>`
        select to_regclass('public.data_import_runs')::text as relation
      `;
      if (!after[0]?.relation) {
        throw new Error("0018 schema was not visible before commit.");
      }
    });
  } finally {
    await client.end();
  }
}

main().catch(() => {
  console.error("One-time 0018 schema apply failed.");
  process.exitCode = 1;
});
