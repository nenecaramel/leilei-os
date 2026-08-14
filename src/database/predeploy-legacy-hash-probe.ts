import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { resolveRailwayMigrationDatabaseUrl } from "./railway-private-postgres.js";

const EXPECTED_0017_CREATED_AT = 1786590053042;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the legacy migration hash probe.");
  }

  const migration = readMigrationFiles({ migrationsFolder: "./drizzle" })
    .find((candidate) => candidate.folderMillis === EXPECTED_0017_CREATED_AT);
  if (!migration) {
    throw new Error("Expected 0017 migration metadata was not found.");
  }

  const resolvedUrl = resolveRailwayMigrationDatabaseUrl(
    databaseUrl,
    process.env.RAILWAY_ENVIRONMENT_ID,
  );
  const client = postgres(resolvedUrl, { max: 1, prepare: false, ssl: "require" });

  try {
    const rows = await client<{ hash: string; created_at: string }[]>`
      select hash, created_at::text as created_at
      from drizzle.__drizzle_migrations
      order by created_at desc
      limit 1
    `;
    const latest = rows[0];
    if (!latest || Number(latest.created_at) !== EXPECTED_0017_CREATED_AT) {
      throw new Error("Legacy migration ledger is not at expected 0017 state.");
    }
    if (latest.hash !== migration.hash) {
      throw new Error("Legacy migration hash differs from current 0017 hash.");
    }
  } finally {
    await client.end();
  }
}

main().catch(() => {
  console.error("Legacy migration hash probe failed.");
  process.exitCode = 1;
});
