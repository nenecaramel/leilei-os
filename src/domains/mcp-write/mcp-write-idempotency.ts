import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { mcpWriteIdempotency } from "../../database/schema.js";

export const MCP_IDEMPOTENCY_KEY_MIN_LENGTH = 16;
export const MCP_IDEMPOTENCY_KEY_MAX_LENGTH = 128;
export const MCP_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;

export type McpIdempotentToolName =
  | "create_task"
  | "write_diary"
  | "toy_set"
  | "toy_stop";

export type McpIdempotentResourceType =
  | "task"
  | "diary_entry"
  | "toy_command";

type Database = ReturnType<typeof createDatabase>["db"];
export type McpIdempotencyTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

export type McpIdempotencyRecord = {
  requestHash: string;
  resourceType: McpIdempotentResourceType;
  resourceId: string;
};

export function normalizeMcpIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < MCP_IDEMPOTENCY_KEY_MIN_LENGTH ||
    normalized.length > MCP_IDEMPOTENCY_KEY_MAX_LENGTH ||
    !MCP_IDEMPOTENCY_KEY_PATTERN.test(normalized)
  ) {
    throw new Error("INVALID_MCP_IDEMPOTENCY_KEY");
  }
  return normalized;
}

export function hashMcpWriteRequest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

export async function lockAndReadMcpIdempotency(
  transaction: McpIdempotencyTransaction,
  input: {
    userId: string;
    toolName: McpIdempotentToolName;
    idempotencyKey: string;
  },
): Promise<McpIdempotencyRecord | null> {
  await transaction.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(
        ${`${input.userId}:${input.toolName}:${input.idempotencyKey}`},
        0
      )
    )
  `);

  const [record] = await transaction
    .select({
      requestHash: mcpWriteIdempotency.requestHash,
      resourceType: mcpWriteIdempotency.resourceType,
      resourceId: mcpWriteIdempotency.resourceId,
    })
    .from(mcpWriteIdempotency)
    .where(
      and(
        eq(mcpWriteIdempotency.userId, input.userId),
        eq(mcpWriteIdempotency.toolName, input.toolName),
        eq(mcpWriteIdempotency.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);

  return record ?? null;
}

export async function recordMcpIdempotency(
  transaction: McpIdempotencyTransaction,
  input: {
    userId: string;
    toolName: McpIdempotentToolName;
    idempotencyKey: string;
    requestHash: string;
    resourceType: McpIdempotentResourceType;
    resourceId: string;
  },
): Promise<void> {
  await transaction.insert(mcpWriteIdempotency).values(input);
}
