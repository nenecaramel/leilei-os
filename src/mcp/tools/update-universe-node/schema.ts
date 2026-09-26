import { z } from "zod";
import { universeMembershipSchema, universeNodeTypeSchema, universePositionSchema } from "../create-universe-node/schema.js";
import { universeExpectedVersionSchema } from "../idempotency-contract.js";

const patchFields = {
  title: z.string().optional(),
  summary: z.string().optional(),
  content: z.string().optional(),
  type: universeNodeTypeSchema.optional(),
  tags: z.array(z.string()).optional(),
  galaxies: z.array(universeMembershipSchema).optional(),
  position: universePositionSchema.optional(),
} as const;

export const updateUniverseNodeInputSchema = z.object({
  id: z.string().trim().min(1).max(256),
  expected_version: universeExpectedVersionSchema,
  ...patchFields,
}).strict();

export type UpdateUniverseNodeInput = z.infer<typeof updateUniverseNodeInputSchema>;
