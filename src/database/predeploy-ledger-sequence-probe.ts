import postgres from "postgres";
import { resolveRailwayMigrationDatabaseUrl } from "./railway-private-postgres.js";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the ledger sequence probe.");
  }

  const resolvedUrl = resolveRailwayMigrationDatabaseUrl(
    databaseUrl,
    process.env.RAILWAY_ENVIRONMENT_ID,
  );
  const client = postgres(resolvedUrl, { max: 1, prepare: false, ssl: "require" });

  try {
    const rows = await client<{
      sequence_name: string | null;
      column_default: string | null;
      max_id: string | null;
      last_value: string | null;
      has_usage: boolean | null;
      has_select: boolean | null;
    }[]>`
      with ledger as (
        select
          pg_get_serial_sequence('drizzle.__drizzle_migrations', 'id') as sequence_name,
          (
            select column_default
            from information_schema.columns
            where table_schema = 'drizzle'
              and table_name = '__drizzle_migrations'
              and column_name = 'id'
          ) as column_default,
          (select max(id)::bigint from drizzle.__drizzle_migrations) as max_id
      ), sequence_identity as (
        select
          ledger.*,
          to_regclass(ledger.sequence_name) as sequence_oid
        from ledger
      )
      select
        sequence_identity.sequence_name,
        sequence_identity.column_default,
        sequence_identity.max_id::text,
        pg_sequences.last_value::text,
        case
          when sequence_identity.sequence_name is null then null
          else has_sequence_privilege(current_user, sequence_identity.sequence_name, 'USAGE')
        end as has_usage,
        case
          when sequence_identity.sequence_name is null then null
          else has_sequence_privilege(current_user, sequence_identity.sequence_name, 'SELECT')
        end as has_select
      from sequence_identity
      left join pg_class
        on pg_class.oid = sequence_identity.sequence_oid
      left join pg_namespace
        on pg_namespace.oid = pg_class.relnamespace
      left join pg_sequences
        on pg_sequences.schemaname = pg_namespace.nspname
       and pg_sequences.sequencename = pg_class.relname
    `;

    const row = rows[0];
    const maxId = Number(row?.max_id);
    const lastValue = Number(row?.last_value);
    const hasSerialDefault = row?.column_default?.includes("nextval(") === true;

    if (
      !row?.sequence_name
      || !hasSerialDefault
      || row.has_usage !== true
      || row.has_select !== true
      || !Number.isSafeInteger(maxId)
      || !Number.isSafeInteger(lastValue)
      || !(lastValue < maxId)
    ) {
      throw new Error("Ledger sequence is not in the expected stale-sequence state.");
    }
  } finally {
    await client.end();
  }
}

main().catch(() => {
  console.error("Pre-deploy migration ledger sequence probe failed.");
  process.exitCode = 1;
});
