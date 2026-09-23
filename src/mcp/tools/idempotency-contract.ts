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
    "Stable key for one logical mutation. Reuse only for the exact same request; use a new key for a different mutation.",
  );

export const mcpExpectedRevisionSchema = z.number()
  .int()
  .min(1)
  .describe(
    "Exact current entity revision from the latest read; stale values are rejected.",
  );

export const mcpExpectedNullableRevisionSchema = z.number()
  .int()
  .min(0)
  .nullable()
  .describe(
    "Current entity revision from the latest read, or null only when the entity is missing.",
  );

export const universeExpectedVersionSchema = z.number()
  .int()
  .nonnegative()
  .describe(
    "Current global Universe snapshot version from the latest Universe read; not an entity revision.",
  );
