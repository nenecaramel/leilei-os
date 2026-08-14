import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import type { MigrationFile } from "./migration-plan.js";
import { resolveRailwayMigrationDatabaseUrl } from "./railway-private-postgres.js";

const MIGRATIONS_FOLDER = "./drizzle";
const MIGRATION_LOCK_KEY = "leilei-os-schema-migrations";
const EXPECTED_0017_CREATED_AT = 1786590053042;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for migration-ledger bootstrap.");
  }

  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }) as MigrationFile[];
  const expected0017 = migrations.find(
    (migration) => migration.folderMillis === EXPECTED_0017_CREATED_AT,
  );
  if (!expected0017) {
    throw new Error("Checked-in 0017 migration metadata is missing.");
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
    await client.begin(async (transaction) => {
      await transaction`
        select pg_advisory_xact_lock(hashtext(${MIGRATION_LOCK_KEY}))
      `;

      await transaction.unsafe(`
        create table if not exists public.leilei_schema_migrations (
          created_at bigint primary key,
          hash text not null,
          applied_at timestamp with time zone not null default now()
        )
      `);

      const existing = await transaction<{ hash: string; created_at: string }[]>`
        select hash, created_at::text as created_at
        from public.leilei_schema_migrations
        order by created_at asc
      `;

      if (existing.length > 0) {
        const latest = existing.at(-1);
        if (
          existing.length !== 1
          || Number(latest?.created_at) !== EXPECTED_0017_CREATED_AT
          || latest?.hash !== expected0017.hash
        ) {
          throw new Error("Existing compatible migration ledger is not the expected 0017 bootstrap state.");
        }
        return;
      }

      const legacyRows = await transaction<{ hash: string; created_at: string }[]>`
        select hash, created_at::text as created_at
        from drizzle.__drizzle_migrations
        order by created_at desc
        limit 1
      `;
      const legacyLatest = legacyRows[0];
      if (
        !legacyLatest
        || Number(legacyLatest.created_at) !== EXPECTED_0017_CREATED_AT
        || legacyLatest.hash !== expected0017.hash
      ) {
        throw new Error("Legacy Drizzle ledger cannot safely bootstrap compatible ledger at 0017.");
      }

      await transaction`
        insert into public.leilei_schema_migrations (created_at, hash)
        values (${expected0017.folderMillis}, ${expected0017.hash})
      `;
    });
  } finally {
    await client.end();
  }
}

main().catch(() => {
  console.error("Production migration-ledger bootstrap failed.");
  process.exitCode = 1;
});
