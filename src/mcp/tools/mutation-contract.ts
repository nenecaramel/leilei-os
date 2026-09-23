import { z } from "zod";

export const mcpMutationOutcomeSchema = z.enum([
  "applied",
  "replayed",
  "no_op",
]).describe(
  "Mutation result: applied changed durable state, replayed returned the prior idempotent result without applying it again, and no_op confirmed no durable change was needed.",
);

export const mcpMutationReceiptFields = {
  outcome: mcpMutationOutcomeSchema,
  entity_type: z.string().trim().min(1).max(100)
    .describe("Stable model-facing type of the primary entity affected by the mutation."),
  entity_id: z.string().trim().min(1).max(512)
    .describe("Stable identifier of the primary entity affected by the mutation."),
  revision: z.number().int().nonnegative().nullable()
    .describe("Current entity revision when this domain has one; null when it does not or when the entity was deleted."),
  detail_tool: z.string().trim().min(1).max(100).nullable()
    .describe("Authoritative readback tool for the resulting entity state, or null when no readback entity remains."),
  detail_arguments: z.record(z.string(), z.unknown()).nullable()
    .describe("Arguments for detail_tool, or null when detail_tool is null."),
};

export type McpMutationOutcome = z.infer<typeof mcpMutationOutcomeSchema>;

export type McpMutationReceipt = {
  outcome: McpMutationOutcome;
  entity_type: string;
  entity_id: string;
  revision: number | null;
  detail_tool: string | null;
  detail_arguments: Record<string, unknown> | null;
};

export function mcpMutationReceipt(input: McpMutationReceipt): McpMutationReceipt {
  return input;
}

export function mcpMutationOutcomeFromReplay(
  replayed: boolean,
  noOp = false,
): McpMutationOutcome {
  if (noOp) return "no_op";
  return replayed ? "replayed" : "applied";
}
