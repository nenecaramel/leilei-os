import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { resolveRailwayMigrationDatabaseUrl } from "./railway-private-postgres.js";

const EXPECTED_0018_CREATED_AT = 1786645516211;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the migration state probe.");
  }

  const migration = readMigrationFiles({ migrationsFolder: "./drizzle" })
    .find((candidate) => candidate.folderMillis === EXPECTED_0018_CREATED_AT);
  if (!migration) {
    throw new Error("Expected 0018 migration metadata was not found.");
  }

  const resolvedUrl = resolveRailwayMigrationDatabaseUrl(
    databaseUrl,
    process.env.RAILWAY_ENVIRONMENT_ID,
  );
  const client = postgres(resolvedUrl, { max: 1, prepare: false, ssl: "require" });

  try {
    const relations = await client<{
      import_runs: string | null;
      custom_ledger: string | null;
    }[]>`
      select
        to_regclass('public.data_import_runs')::text as import_runs,
        to_regclass('public.leilei_schema_migrations')::text as custom_ledger
    `;
    if (!relations[0]?.import_runs || !relations[0]?.custom_ledger) {
      throw new Error("Expected post-migration relations are not both present.");
    }

    const rows = await client<{ hash: string; created_at: string }[]>`
      select hash, created_at::text as created_at
      from public.leilei_schema_migrations
      order by created_at desc
      limit 1
    `;
    const latest = rows[0];
    if (
      !latest
      || Number(latest.created_at) !== EXPECTED_0018_CREATED_AT
      || latest.hash !== migration.hash
    ) {
      throw new Error("Compatible migration ledger is not at 0018.");
    }
  } finally {
    await client.end();
  }
}

main().catch(() => {
  console.error("Migration state probe failed.");
  process.exitCode = 1;
});
