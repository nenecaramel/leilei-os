import { z } from "zod";
import { mcpIdempotencyKeySchema, universeExpectedVersionSchema } from "../idempotency-contract.js";

const positionCoordinate = (label: string, axis: "X" | "Y") =>
  z.number()
    .finite()
    .min(0, `${label} must be between 0 and 100.`)
    .max(100, `${label} must be between 0 and 100.`)
    .describe(`Logical Universe canvas ${axis} coordinate, from 0 to 100.`);

export const universeMembershipSchema = z.object({
  id: z.string().min(1).max(256).describe("Galaxy ID from list_universe_galaxies."),
  weight: z.number().finite().describe(
    "Membership weight; any finite number. Not limited to 0-1 or normalized. For new memberships use 1 for the first and 0.72 for additional ones; preserve existing values.",
  ),
}).strict();

export const universePositionSchema = z.object({
  x: positionCoordinate("position.x", "X"),
  y: positionCoordinate("position.y", "Y"),
}).strict();

export const universeNodeTypeSchema = z.string()
  .min(1)
  .max(128)
  .regex(/\S/u, "type must not be blank.")
  .describe("Free-form Universe node type; non-blank, maximum 128 characters.");

export const createUniverseNodeInputSchema = z.object({
  title: z.string(),
  summary: z.string(),
  content: z.string(),
  type: universeNodeTypeSchema,
  tags: z.array(z.string()),
  galaxies: z.array(universeMembershipSchema),
  position: universePositionSchema,
  expected_version: universeExpectedVersionSchema,
  idempotency_key: mcpIdempotencyKeySchema,
}).strict();

export type CreateUniverseNodeInput = z.infer<typeof createUniverseNodeInputSchema>;
