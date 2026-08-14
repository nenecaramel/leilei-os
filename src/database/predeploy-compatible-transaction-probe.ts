import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import {
  planPendingMigrations,
  type AppliedMigration,
  type MigrationFile,
} from "./migration-plan.js";
import { resolveRailwayMigrationDatabaseUrl } from "./railway-private-postgres.js";

const MIGRATIONS_FOLDER = "./drizzle";
const MIGRATION_LOCK_KEY = "leilei-os-schema-migrations";
const EXPECTED_0018_CREATED_AT = 1786645516211;
const ROLLBACK_SIGNAL = Symbol("rollback-compatible-ledger-write-probe");

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the compatible ledger-write probe.");
  }

  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }) as MigrationFile[];
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
    const before = await client<{ import_runs: string | null; custom_ledger: string | null }[]>`
      select
        to_regclass('public.data_import_runs')::text as import_runs,
        to_regclass('public.leilei_schema_migrations')::text as custom_ledger
    `;
    if (before[0]?.import_runs) {
      throw new Error("data_import_runs already exists before the ledger-write probe.");
    }

    let beforeLedgerRows: Array<{ hash: string; created_at: string }> = [];
    if (before[0]?.custom_ledger) {
      beforeLedgerRows = await client<{ hash: string; created_at: string }[]>`
        select hash, created_at::text as created_at
        from public.leilei_schema_migrations
        order by created_at asc
      `;
    }

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

        let ledgerRows: Array<{ hash: string; created_at: string }> = await transaction<
          { hash: string; created_at: string }[]
        >`
          select hash, created_at::text as created_at
          from public.leilei_schema_migrations
          order by created_at asc
        `;

        if (ledgerRows.length === 0) {
          const legacyRows = await transaction<{ hash: string; created_at: string }[]>`
            select hash, created_at::text as created_at
            from drizzle.__drizzle_migrations
            order by created_at desc
            limit 1
          `;
          const legacyLatest = legacyRows[0];
          const legacyCreatedAt = Number(legacyLatest?.created_at);
          const bootstrapMigration = migrations.find(
            (migration) => migration.folderMillis === legacyCreatedAt,
          );
          if (!legacyLatest || !bootstrapMigration || bootstrapMigration.hash !== legacyLatest.hash) {
            throw new Error("Legacy ledger bootstrap validation failed.");
          }

          await transaction`
            insert into public.leilei_schema_migrations (created_at, hash)
            values (${bootstrapMigration.folderMillis}, ${bootstrapMigration.hash})
          `;
          ledgerRows = [{
            created_at: String(bootstrapMigration.folderMillis),
            hash: bootstrapMigration.hash,
          }];
        }

        const applied: AppliedMigration[] = ledgerRows.map((row) => ({
          createdAt: Number(row.created_at),
          hash: row.hash,
        }));
        const pending = planPendingMigrations(migrations, applied);
        if (pending.length !== 1 || pending[0]?.folderMillis !== EXPECTED_0018_CREATED_AT) {
          throw new Error("Expected exactly 0018 to be pending.");
        }

        for (const migration of pending) {
          for (const statement of migration.sql) {
            await transaction.unsafe(statement);
          }
          await transaction`
            insert into public.leilei_schema_migrations (created_at, hash)
            values (${migration.folderMillis}, ${migration.hash})
          `;
        }

        throw ROLLBACK_SIGNAL;
      });
    } catch (error) {
      if (error !== ROLLBACK_SIGNAL) {
        throw error;
      }
    }

    const after = await client<{ import_runs: string | null; custom_ledger: string | null }[]>`
      select
        to_regclass('public.data_import_runs')::text as import_runs,
        to_regclass('public.leilei_schema_migrations')::text as custom_ledger
    `;
    if (after[0]?.import_runs) {
      throw new Error("Ledger-write probe left data_import_runs committed.");
    }
    if (!before[0]?.custom_ledger && after[0]?.custom_ledger) {
      throw new Error("Ledger-write probe left compatible ledger committed.");
    }
    if (before[0]?.custom_ledger) {
      const afterLedgerRows = await client<{ hash: string; created_at: string }[]>`
        select hash, created_at::text as created_at
        from public.leilei_schema_migrations
        order by created_at asc
      `;
      if (JSON.stringify(afterLedgerRows) !== JSON.stringify(beforeLedgerRows)) {
        throw new Error("Ledger-write probe changed the pre-existing compatible ledger.");
      }
    }
  } finally {
    await client.end();
  }
}

main().catch(() => {
  console.error("Compatible migration ledger-write probe failed.");
  process.exitCode = 1;
});
