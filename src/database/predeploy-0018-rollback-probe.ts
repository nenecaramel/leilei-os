import { readFileSync } from "node:fs";
import postgres from "postgres";
import { resolveRailwayMigrationDatabaseUrl } from "./railway-private-postgres.js";

const MIGRATION_PATH = "./drizzle/0018_nifty_power_pack.sql";
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the 0018 rollback probe.");
  }

  const resolvedUrl = resolveRailwayMigrationDatabaseUrl(
    databaseUrl,
    process.env.RAILWAY_ENVIRONMENT_ID,
  );
  const client = postgres(resolvedUrl, { max: 1, prepare: false, ssl: "require" });
  let transactionOpen = false;

  try {
    const before = await client<{ relation: string | null }[]>`
      select to_regclass('public.data_import_runs')::text as relation
    `;
    if (before[0]?.relation) {
      throw new Error("data_import_runs already exists before the rollback probe.");
    }

    const statements = readFileSync(MIGRATION_PATH, "utf8")
      .split(STATEMENT_BREAKPOINT)
      .map((statement) => statement.trim())
      .filter(Boolean);
    if (statements.length !== 3) {
      throw new Error("Unexpected 0018 statement count.");
    }

    await client.unsafe("begin");
    transactionOpen = true;
    for (const statement of statements) {
      await client.unsafe(statement);
    }

    const during = await client<{ relation: string | null }[]>`
      select to_regclass('public.data_import_runs')::text as relation
    `;
    if (!during[0]?.relation) {
      throw new Error("0018 did not create data_import_runs inside the transaction.");
    }

    await client.unsafe("rollback");
    transactionOpen = false;

    const after = await client<{ relation: string | null }[]>`
      select to_regclass('public.data_import_runs')::text as relation
    `;
    if (after[0]?.relation) {
      throw new Error("Rollback probe left data_import_runs committed.");
    }
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.unsafe("rollback");
      } catch {
        // Preserve the original failure while still attempting cleanup.
      }
    }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(() => {
  console.error("0018 rollback probe failed.");
  process.exitCode = 1;
});
