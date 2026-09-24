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
    "Stable key for one logical mutation; reuse only for the exact same request.",
  );

export const mcpExpectedRevisionSchema = z.number()
  .int()
  .min(1)
  .describe(
    "Current entity revision from the latest read.",
  );

export const mcpExpectedNullableRevisionSchema = z.number()
  .int()
  .min(0)
  .nullable()
  .describe(
    "Current entity revision, or null when the entity does not exist.",
  );

export const universeExpectedVersionSchema = z.number()
  .int()
  .nonnegative()
  .describe(
    "Current global Universe snapshot version; not an entity revision.",
  );
