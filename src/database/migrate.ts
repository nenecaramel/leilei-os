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

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database migrations.");
  }

  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }) as MigrationFile[];
  const expectedLatest = [...migrations].sort(
    (left, right) => left.folderMillis - right.folderMillis,
  ).at(-1);
  if (!expectedLatest) {
    throw new Error("No checked-in database migrations were found.");
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
    // Bootstrap the LeileiOS-owned ledger in its own transaction. This records
    // only the already-applied legacy head and never advances schema state.
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
        if (!legacyLatest || !bootstrapMigration) {
          throw new Error("Legacy Drizzle ledger cannot bootstrap the production migration ledger.");
        }
        if (bootstrapMigration.hash !== legacyLatest.hash) {
          throw new Error("Legacy Drizzle ledger hash does not match the checked-in migration.");
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
      planPendingMigrations(migrations, applied);
    });

    // Advance schema state in a separate all-or-nothing transaction. Recording
    // each pending row before its SQL is safe because both are committed or
    // rolled back together, and this ordering is verified in Railway production.
    await client.begin(async (transaction) => {
      await transaction`
        select pg_advisory_xact_lock(hashtext(${MIGRATION_LOCK_KEY}))
      `;

      const ledgerRows = await transaction<{ hash: string; created_at: string }[]>`
        select hash, created_at::text as created_at
        from public.leilei_schema_migrations
        order by created_at asc
      `;
      const applied: AppliedMigration[] = ledgerRows.map((row) => ({
        createdAt: Number(row.created_at),
        hash: row.hash,
      }));
      const pending = planPendingMigrations(migrations, applied);

      for (const migration of pending) {
        await transaction`
          insert into public.leilei_schema_migrations (created_at, hash)
          values (${migration.folderMillis}, ${migration.hash})
        `;
        for (const statement of migration.sql) {
          await transaction.unsafe(statement);
        }
      }

      const latestRows = await transaction<{ hash: string; created_at: string }[]>`
        select hash, created_at::text as created_at
        from public.leilei_schema_migrations
        order by created_at desc
        limit 1
      `;
      const latest = latestRows[0];
      if (
        Number(latest?.created_at) !== expectedLatest.folderMillis
        || latest?.hash !== expectedLatest.hash
      ) {
        throw new Error("Production migration ledger is not at the checked-in migration head.");
      }

      const relations = await transaction<{ relation: string | null }[]>`
        select to_regclass('public.data_import_runs')::text as relation
      `;
      if (!relations[0]?.relation) {
        throw new Error("Expected data_import_runs table after migrations.");
      }
    });
  } finally {
    await client.end();
  }
}

main().catch(() => {
  console.error("Database migration failed.");
  process.exitCode = 1;
});
