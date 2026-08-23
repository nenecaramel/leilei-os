import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

function createPostgresClient(databaseUrl: string, maxConnections: number) {
  return postgres(databaseUrl, {
    max: maxConnections,
    prepare: false,
    ssl: "require",
    connect_timeout: 3,
    idle_timeout: 5,
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
