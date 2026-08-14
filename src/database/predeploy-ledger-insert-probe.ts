import postgres from "postgres";
import { resolveRailwayMigrationDatabaseUrl } from "./railway-private-postgres.js";

const EXPECTED_0017_CREATED_AT = 1786590053042;
const TEST_0018_CREATED_AT = 1786645516211;
const TEST_HASH = "0".repeat(64);
const ROLLBACK_SIGNAL = Symbol("rollback-ledger-probe");

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the ledger insert probe.");
  }

  const resolvedUrl = resolveRailwayMigrationDatabaseUrl(
    databaseUrl,
    process.env.RAILWAY_ENVIRONMENT_ID,
  );
  const client = postgres(resolvedUrl, { max: 1, prepare: false, ssl: "require" });

  try {
    const before = await client<{ created_at: string | null }[]>`
      select created_at::text
      from drizzle.__drizzle_migrations
      order by created_at desc
      limit 1
    `;
    if (Number(before[0]?.created_at) !== EXPECTED_0017_CREATED_AT) {
      throw new Error("Production migration ledger is not at expected 0017.");
    }

    try {
      await client.begin(async (transaction) => {
        await transaction`
          insert into drizzle.__drizzle_migrations ("hash", "created_at")
          values (${TEST_HASH}, ${TEST_0018_CREATED_AT})
        `;

        const during = await transaction<{ created_at: string | null }[]>`
          select created_at::text
          from drizzle.__drizzle_migrations
          order by created_at desc
          limit 1
        `;
        if (Number(during[0]?.created_at) !== TEST_0018_CREATED_AT) {
          throw new Error("Ledger insert was not visible inside the transaction.");
        }

        throw ROLLBACK_SIGNAL;
      });
      throw new Error("Ledger insert probe unexpectedly committed.");
    } catch (error) {
      if (error !== ROLLBACK_SIGNAL) {
        throw error;
      }
    }

    const after = await client<{ created_at: string | null }[]>`
      select created_at::text
      from drizzle.__drizzle_migrations
      order by created_at desc
      limit 1
    `;
    if (Number(after[0]?.created_at) !== EXPECTED_0017_CREATED_AT) {
      throw new Error("Ledger insert probe left a committed row.");
    }
  } finally {
    await client.end();
  }
}

main().catch(() => {
  console.error("Pre-deploy migration ledger insert probe failed.");
  process.exitCode = 1;
});
