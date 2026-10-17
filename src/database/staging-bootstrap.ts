import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

// One-time empty-database initialization for the isolated PR #1142 Railway
// staging environment. Production MUST continue using migrate.ts exclusively.
// Hard fencing avoids running the legacy bootstrap on a real/other database.
const STAGING_PROJECT = "7e2d02fa-0256-4edd-86af-308e305b1f2c";
const STAGING_ENVIRONMENT = "e4d1f0ac-31bf-466c-ad8b-3e85bc0d2b6b";
const STAGING_SERVICE = "44a396e4-5e62-4929-848c-2abb1e6eae0c";

async function main(): Promise<void> {
  if (process.env.RAILWAY_PROJECT_ID !== STAGING_PROJECT
    || process.env.RAILWAY_ENVIRONMENT_ID !== STAGING_ENVIRONMENT
    || process.env.RAILWAY_SERVICE_ID !== STAGING_SERVICE
    || process.env.RAILWAY_ENVIRONMENT_NAME !== "staging") {
    throw new Error("Refusing non-staging database bootstrap.");
  }
  const url = process.env.DATABASE_URL;
  if (!url || !new URL(url).hostname.endsWith(".railway.internal")) {
    throw new Error("Refusing non-private staging database.");
  }
  const client = postgres(url, {
    max: 1,
    prepare: false,
    ssl: "require",
    connect_timeout: 3,
  });
  try {
    const tables = await client<{count: number}[]>`
      select count(*)::integer as count
      from pg_catalog.pg_tables
      where schemaname = 'public'
    `;
    if (tables[0]?.count !== 0) {
      throw new Error("Refusing nonempty staging database bootstrap.");
    }
    await migrate(drizzle(client), {migrationsFolder: "./drizzle"});
    console.info("Staging fresh-database bootstrap complete.");
  } finally {
    await client.end();
  }
}

main().catch(() => {
  console.error("Staging database bootstrap failed.");
  process.exitCode = 1;
});
