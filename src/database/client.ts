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

type PostgresClient = ReturnType<typeof postgres>;
type CreatePostgresClient = (
  databaseUrl: string,
  maxConnections: number,
) => PostgresClient;
type CreateDrizzle = (client: PostgresClient) => ReturnType<typeof drizzle>;

export function createDatabase(
  databaseUrl: string,
  options: {
    createClient?: CreatePostgresClient;
    createDrizzle?: CreateDrizzle;
  } = {},
) {
  const client = (options.createClient ?? createPostgresClient)(databaseUrl, 10);
  const db = (options.createDrizzle ?? ((value) => drizzle(value, { schema })))(
    client,
  );
  let closePromise: Promise<void> | null = null;

  return {
    db,
    probe: () => client`select 1`,
    close: () => {
      closePromise ??= Promise.resolve(client.end()).then(() => undefined);
      return closePromise;
    },
  };
}
