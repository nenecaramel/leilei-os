import type { createDatabase } from "../../database/client.js";

export type Database = ReturnType<typeof createDatabase>["db"];
export type Transaction = Parameters<Database["transaction"]>[0] extends (
  tx: infer T,
) => unknown
  ? T
  : never;
export type DbExecutor = Database | Transaction;
