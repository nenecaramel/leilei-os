import { z } from "zod";
import {
  MCP_IDEMPOTENCY_KEY_MAX_LENGTH,
  MCP_IDEMPOTENCY_KEY_MIN_LENGTH,
  MCP_IDEMPOTENCY_KEY_PATTERN,
} from "../../../domains/mcp-write/mcp-write-idempotency.js";

export const createUniverseRelationInputSchema = z.object({
  source: z.string().trim().min(1).max(256),
  target: z.string().trim().min(1).max(256),
  relation_type: z.enum(["related_to", "supports", "contradicts", "extends", "part_of", "raises"]),
  strength: z.number().finite().min(0).max(1),
  expected_version: z.number().int().nonnegative(),
  idempotency_key: z.string()
    .min(MCP_IDEMPOTENCY_KEY_MIN_LENGTH)
    .max(MCP_IDEMPOTENCY_KEY_MAX_LENGTH)
    .regex(MCP_IDEMPOTENCY_KEY_PATTERN),
}).strict();

export type CreateUniverseRelationInput = z.infer<typeof createUniverseRelationInputSchema>;
