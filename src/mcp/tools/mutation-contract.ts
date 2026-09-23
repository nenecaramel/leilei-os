import { z } from "zod";

export const mcpMutationOutcomeSchema = z.enum([
  "applied",
  "replayed",
  "no_op",
]);

export const mcpMutationReceiptFields = {
  outcome: mcpMutationOutcomeSchema,
  entity_type: z.string().trim().min(1).max(100),
  entity_id: z.string().trim().min(1).max(512),
  revision: z.number().int().nonnegative().nullable(),
  detail_tool: z.string().trim().min(1).max(100).nullable(),
  detail_arguments: z.record(z.string(), z.unknown()).nullable(),
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
