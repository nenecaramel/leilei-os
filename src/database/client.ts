import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const DATABASE_CONNECT_TIMEOUT_SECONDS = 3;
const DATABASE_IDLE_TIMEOUT_SECONDS = 5;

function createPostgresClient(databaseUrl: string, maxConnections: number) {
  return postgres(databaseUrl, {
    max: maxConnections,
    prepare: false,
    ssl: "require",
    connect_timeout: DATABASE_CONNECT_TIMEOUT_SECONDS,
    idle_timeout: DATABASE_IDLE_TIMEOUT_SECONDS,
  });
}

export function createDatabase(databaseUrl: string) {
  const client = createPostgresClient(databaseUrl, 10);

  return {
    db: drizzle(client, { schema }),
    close: () => client.end(),
  };
}

export function createDatabaseReadinessProbe(databaseUrl: string) {
  const client = createPostgresClient(databaseUrl, 1);
  return () => client`select 1`;
}
