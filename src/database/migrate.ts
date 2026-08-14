import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database migrations.");
  }

  const client = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    ssl: "require",
  });

  try {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "./drizzle" });
  } finally {
    await client.end();
  }
}

main().catch(() => {
  console.error("Database migration failed.");
  process.exitCode = 1;
});
