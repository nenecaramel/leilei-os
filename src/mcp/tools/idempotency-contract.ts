import { z } from "zod";
import {
  MCP_IDEMPOTENCY_KEY_MAX_LENGTH,
  MCP_IDEMPOTENCY_KEY_MIN_LENGTH,
  MCP_IDEMPOTENCY_KEY_PATTERN,
} from "../../domains/mcp-write/mcp-write-idempotency.js";

export const mcpIdempotencyKeySchema = z.string()
  .min(MCP_IDEMPOTENCY_KEY_MIN_LENGTH)
  .max(MCP_IDEMPOTENCY_KEY_MAX_LENGTH)
  .regex(MCP_IDEMPOTENCY_KEY_PATTERN)
  .describe(
    "Stable client-generated key for one logical mutation. Reuse the same key only when replaying the exact same request; use a new key for a different mutation. The key remains explicit because a transport request ID is not a durable logical-mutation ID.",
  );

export const mcpExpectedRevisionSchema = z.number()
  .int()
  .min(1)
  .describe(
    "Exact current entity revision from the latest authoritative read. A stale revision is rejected; fresh-read before retrying.",
  );

export const mcpExpectedNullableRevisionSchema = z.number()
  .int()
  .min(0)
  .nullable()
  .describe(
    "Exact current entity revision from the latest authoritative read, or null only when creating a missing entity. A stale revision is rejected.",
  );

export const universeExpectedVersionSchema = z.number()
  .int()
  .nonnegative()
  .describe(
    "Expected global Universe snapshot version. This is not an entity revision; use the latest universe_version returned by an authoritative Universe read.",
  );
