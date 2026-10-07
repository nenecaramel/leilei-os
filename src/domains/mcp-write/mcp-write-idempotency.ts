import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { mcpWriteIdempotency } from "../../database/schema.js";

export const MCP_IDEMPOTENCY_KEY_MIN_LENGTH = 16;
export const MCP_IDEMPOTENCY_KEY_MAX_LENGTH = 128;
export const MCP_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;
export const MCP_WRITE_FINGERPRINT_VERSION = "leilei-os:mcp-write:v1";

export type McpFingerprintValue =
  | null
  | boolean
  | number
  | string
  | readonly McpFingerprintValue[]
  | { readonly [key: string]: McpFingerprintValue };

export type McpIdempotentToolName =
  | "write_memory"
  | "write_diary"
  | "toy_set"
  | "toy_stop"
  | "write_todo_paper"
  | "append_todo_entry"
  | "update_todo_entry"
  | "delete_todo_entry"
  | "create_universe_node"
  | "create_universe_relation"
  | "add_diary_comment";

export type McpIdempotentResourceType =
  | "mind_state"
  | "diary_entry"
  | "toy_command"
  | "todo_paper"
  | "todo_entry"
  | "universe_node"
  | "universe_relation"
  | "diary_comment";

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

export function canonicalizeMcpWriteRequest(value: unknown): string {
  return serializeCanonicalValue(value);
}

export function hashMcpWriteRequest(value: unknown): string {
  const canonical = canonicalizeMcpWriteRequest(value);
  return createHash("sha256")
    .update(`${MCP_WRITE_FINGERPRINT_VERSION}\n${canonical}`, "utf8")
    .digest("hex");
}

function serializeCanonicalValue(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("UNSUPPORTED_MCP_FINGERPRINT_VALUE");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const serialized: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new Error("UNSUPPORTED_MCP_FINGERPRINT_VALUE");
      }
      serialized.push(serializeCanonicalValue(value[index]));
    }
    return `[${serialized.join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("UNSUPPORTED_MCP_FINGERPRINT_VALUE");
    }
    return `{${Object.keys(value as object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serializeCanonicalValue((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  throw new Error("UNSUPPORTED_MCP_FINGERPRINT_VALUE");
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
