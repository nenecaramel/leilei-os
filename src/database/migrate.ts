import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { resolveRailwayMigrationDatabaseUrl } from "./railway-private-postgres.js";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database migrations.");
  }

  const migrationDatabaseUrl = resolveRailwayMigrationDatabaseUrl(
    databaseUrl,
    process.env.RAILWAY_ENVIRONMENT_ID,
  );

  const client = postgres(migrationDatabaseUrl, {
    max: 1,
    prepare: false,
    ssl: "require",
  });

  try {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "./drizzle" });

    const rows = await client<{ relation: string | null }[]>`
      select to_regclass('public.data_import_runs')::text as relation
    `;
    if (!rows[0]?.relation) {
      throw new Error("Expected data_import_runs table after migrations.");
    }
  } finally {
    await client.end();
  }
}

main().catch(() => {
  console.error("Database migration failed.");
  process.exitCode = 1;
});
