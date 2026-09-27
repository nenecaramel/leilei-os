import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import {
  planPendingMigrations,
  type AppliedMigration,
  type MigrationFile,
} from "./migration-plan.js";
import {
  collectMigrationNetworkDiagnostics,
  logMigrationNetworkDiagnostics,
} from "./migration-network-diagnostics.js";
import {
  MIGRATION_READINESS_BACKOFF_MS,
  MIGRATION_READINESS_MAX_ATTEMPTS,
  MIGRATION_READINESS_MAX_BACKOFF_MS,
  waitForMigrationDatabaseReady,
} from "./migration-readiness.js";
import { resolveRailwayMigrationDatabaseUrl } from "./railway-private-postgres.js";

const MIGRATIONS_FOLDER = "./drizzle";
const MIGRATION_LOCK_KEY = "leilei-os-schema-migrations";

let migrationStage = "initialization";

function safeErrorName(error: unknown): string {
  const name = error instanceof Error ? error.name : "UNKNOWN";
  return /^[A-Za-z0-9_.-]{1,64}$/.test(name) ? name : "UNKNOWN";
}

function safeErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return "UNKNOWN";
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string") {
    return "UNKNOWN";
  }
  return /^[A-Z0-9_]{1,64}$/.test(code) ? code : "UNKNOWN";
}

async function main(): Promise<void> {
  migrationStage = "read_environment";
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database migrations.");
  }

  migrationStage = "read_migration_files";
  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }) as MigrationFile[];
  const expectedLatest = [...migrations].sort(
    (left, right) => left.folderMillis - right.folderMillis,
  ).at(-1);
  if (!expectedLatest) {
    throw new Error("No checked-in database migrations were found.");
  }

  migrationStage = "resolve_database_url";
  const migrationDatabaseUrl = resolveRailwayMigrationDatabaseUrl(
    databaseUrl,
    process.env.RAILWAY_ENVIRONMENT_ID,
  );
  migrationStage = "network_diagnostics";
  try {
    const diagnostics = await collectMigrationNetworkDiagnostics(
      databaseUrl,
      process.env.RAILWAY_ENVIRONMENT_ID,
      migrationDatabaseUrl,
    );
    logMigrationNetworkDiagnostics(diagnostics);
  } catch {
    // Diagnostics are best-effort and must never replace the migration error.
    console.error("MIGRATION_NETWORK_DIAGNOSTICS=UNAVAILABLE");
  }
  migrationStage = "create_client";
  const client = postgres(migrationDatabaseUrl, {
    max: 1,
    prepare: false,
    ssl: "require",
    connect_timeout: 3,
    idle_timeout: 5,
  });

  try {
    migrationStage = "readiness";
    await waitForMigrationDatabaseReady(
      () => client`select 1`,
      {
        maxAttempts: MIGRATION_READINESS_MAX_ATTEMPTS,
        backoffMs: MIGRATION_READINESS_BACKOFF_MS,
        maxBackoffMs: MIGRATION_READINESS_MAX_BACKOFF_MS,
        onRetry: ({ attempt, maxAttempts, name, code }) => {
          console.error(
            `Database readiness retry. stage=readiness attempt=${attempt}/${maxAttempts} name=${name} code=${code}`,
          );
        },
      },
    );

    // Bootstrap the LeileiOS-owned ledger in its own transaction. This records
    // only the already-applied legacy head and never advances schema state.
    await client.begin(async (transaction) => {
      migrationStage = "bootstrap_lock";
      await transaction`
        select pg_advisory_xact_lock(hashtext(${MIGRATION_LOCK_KEY}))
      `;

      migrationStage = "bootstrap_create_ledger";
      await transaction.unsafe(`
        create table if not exists public.leilei_schema_migrations (
          created_at bigint primary key,
          hash text not null,
          applied_at timestamp with time zone not null default now()
        )
      `);

      migrationStage = "bootstrap_read_ledger";
      let ledgerRows: Array<{ hash: string; created_at: string }> = await transaction<
        { hash: string; created_at: string }[]
      >`
        select hash, created_at::text as created_at
        from public.leilei_schema_migrations
        order by created_at asc
      `;

      if (ledgerRows.length === 0) {
        migrationStage = "bootstrap_read_legacy";
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

        migrationStage = "bootstrap_validate_legacy";
        if (!legacyLatest || !bootstrapMigration) {
          throw new Error("Legacy Drizzle ledger cannot bootstrap the production migration ledger.");
        }
        if (bootstrapMigration.hash !== legacyLatest.hash) {
          throw new Error("Legacy Drizzle ledger hash does not match the checked-in migration.");
        }

        migrationStage = "bootstrap_insert_ledger";
        await transaction`
          insert into public.leilei_schema_migrations (created_at, hash)
          values (${bootstrapMigration.folderMillis}, ${bootstrapMigration.hash})
        `;
        ledgerRows = [{
          created_at: String(bootstrapMigration.folderMillis),
          hash: bootstrapMigration.hash,
        }];
      }

      migrationStage = "bootstrap_plan";
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
      migrationStage = "advance_lock";
      await transaction`
        select pg_advisory_xact_lock(hashtext(${MIGRATION_LOCK_KEY}))
      `;

      migrationStage = "advance_read_ledger";
      const ledgerRows = await transaction<{ hash: string; created_at: string }[]>`
        select hash, created_at::text as created_at
        from public.leilei_schema_migrations
        order by created_at asc
      `;
      const applied: AppliedMigration[] = ledgerRows.map((row) => ({
        createdAt: Number(row.created_at),
        hash: row.hash,
      }));

      migrationStage = "advance_plan";
      const pending = planPendingMigrations(migrations, applied);

      for (const migration of pending) {
        migrationStage = "advance_insert_ledger";
        await transaction`
          insert into public.leilei_schema_migrations (created_at, hash)
          values (${migration.folderMillis}, ${migration.hash})
        `;
        for (const statement of migration.sql) {
          migrationStage = "advance_sql";
          await transaction.unsafe(statement);
        }
      }

      migrationStage = "verify_ledger";
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
      console.log(
        `MIGRATION_LEDGER_HEAD_MATCH=YES created_at=${expectedLatest.folderMillis}`,
      );

      migrationStage = "verify_import_table";
      const relations = await transaction<{ relation: string | null }[]>`
        select to_regclass('public.data_import_runs')::text as relation
      `;
      if (!relations[0]?.relation) {
        throw new Error("Expected data_import_runs table after migrations.");
      }
    });
  } catch (error) {
    const failureStage = migrationStage;
    try {
      await client.end();
    } catch {
      // Preserve the primary migration failure and its stage.
    }
    migrationStage = failureStage;
    throw error;
  }

  migrationStage = "client_end";
  await client.end();
  migrationStage = "complete";
}

main().catch((error: unknown) => {
  console.error(
    `Database migration failed. stage=${migrationStage} name=${safeErrorName(error)} code=${safeErrorCode(error)}`,
  );
  process.exitCode = 1;
});