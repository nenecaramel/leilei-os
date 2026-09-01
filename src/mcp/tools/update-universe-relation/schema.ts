import { z } from "zod";

export const updateUniverseRelationInputSchema = z.object({
  relation_id: z.string().trim().min(1).max(256),
  expected_version: z.number().int().nonnegative(),
  relation_type: z.enum(["related_to", "supports", "contradicts", "extends", "part_of", "raises"]).optional(),
  strength: z.number().finite().min(0).max(1).optional(),
}).strict();

export type UpdateUniverseRelationInput = z.infer<typeof updateUniverseRelationInputSchema>;
