import postgres from "postgres";
import { resolveRailwayMigrationDatabaseUrl } from "./railway-private-postgres.js";

const EXPECTED_0017_CREATED_AT = 1786590053042;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the pre-deploy ledger probe.");
  }

  const resolvedUrl = resolveRailwayMigrationDatabaseUrl(
    databaseUrl,
    process.env.RAILWAY_ENVIRONMENT_ID,
  );
  const client = postgres(resolvedUrl, { max: 1, prepare: false, ssl: "require" });

  try {
    const relations = await client<{ ledger: string | null; import_runs: string | null }[]>`
      select
        to_regclass('drizzle.__drizzle_migrations')::text as ledger,
        to_regclass('public.data_import_runs')::text as import_runs
    `;
    if (!relations[0]?.ledger || relations[0].import_runs) {
      throw new Error("Production migration state is not the expected pre-0018 shape.");
    }

    const latest = await client<{ created_at: number }[]>`
      select created_at
      from drizzle.__drizzle_migrations
      order by created_at desc
      limit 1
    `;
    if (Number(latest[0]?.created_at) !== EXPECTED_0017_CREATED_AT) {
      throw new Error("Production migration ledger is not at expected 0017.");
    }
  } finally {
    await client.end();
  }
}

main().catch(() => {
  console.error("Pre-deploy migration ledger probe failed.");
  process.exitCode = 1;
});
