import { z } from "zod";
import { mcpIdempotencyKeySchema, universeExpectedVersionSchema } from "../idempotency-contract.js";

export const createUniverseRelationInputSchema = z.object({
  source: z.string().trim().min(1).max(256),
  target: z.string().trim().min(1).max(256),
  relation_type: z.enum(["related_to", "supports", "contradicts", "extends", "part_of", "raises"]),
  strength: z.number().finite().min(0).max(1),
  expected_version: universeExpectedVersionSchema,
  idempotency_key: mcpIdempotencyKeySchema,
}).strict();

export type CreateUniverseRelationInput = z.infer<typeof createUniverseRelationInputSchema>;
