import { z } from "zod";
import {
  MCP_IDEMPOTENCY_KEY_MAX_LENGTH,
  MCP_IDEMPOTENCY_KEY_MIN_LENGTH,
  MCP_IDEMPOTENCY_KEY_PATTERN,
} from "../../../domains/mcp-write/mcp-write-idempotency.js";

const positionCoordinate = (label: string) =>
  z.number().finite().min(0, `${label} must be between 0 and 100.`).max(100, `${label} must be between 0 and 100.`);

export const universeMembershipSchema = z.object({
  id: z.string().min(1).max(256),
  weight: z.number().finite(),
}).strict();

export const universePositionSchema = z.object({
  x: positionCoordinate("position.x"),
  y: positionCoordinate("position.y"),
}).strict();

export const createUniverseNodeInputSchema = z.object({
  title: z.string(),
  summary: z.string(),
  content: z.string(),
  type: z.string(),
  tags: z.array(z.string()),
  galaxies: z.array(universeMembershipSchema),
  position: universePositionSchema,
  expected_version: z.number().int().nonnegative(),
  idempotency_key: z.string()
    .min(MCP_IDEMPOTENCY_KEY_MIN_LENGTH)
    .max(MCP_IDEMPOTENCY_KEY_MAX_LENGTH)
    .regex(MCP_IDEMPOTENCY_KEY_PATTERN),
}).strict();

export type CreateUniverseNodeInput = z.infer<typeof createUniverseNodeInputSchema>;
