import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createMindState } from "../../../domains/runtime/mind/mind-writer.js";
import type { DrizzleMindProductRepository } from "../../../domains/runtime/mind/mind-product-repository.js";
import { hashMcpWriteRequest, normalizeMcpIdempotencyKey } from "../../../domains/mcp-write/mcp-write-idempotency.js";
import { invokeMcpWrite } from "../write-context.js";
import { mcpIdempotencyKeySchema } from "../idempotency-contract.js";
import { createMcpToolError, mcpErrorRecoveryHint, mcpToolErrorDetailsSchema } from "../error-contract.js";
import { mcpMutationReceiptFields, mcpMutationOutcomeFromReplay } from "../mutation-contract.js";

export type WriteMemoryDependencies = {
  repository: Pick<DrizzleMindProductRepository, "insertMcpIdempotent">;
  requireActiveUser: () => Promise<string>;
  subjectId: string;
};

export function registerWriteMemoryTool(server: McpServer, dependencies: WriteMemoryDependencies) {
  server.registerTool("write_memory", {
    title: "Remember a lasting fact",
    description: "Save a lasting fact or preference in LeileiOS Mind, globally confirmed without branch dependence. Avoid temporary task progress. Reuse idempotency_key only for the identical request.",
    inputSchema: z.object({
      text: z.string().trim().min(1).max(20000).describe("The memory to retain."),
      occurred_at: z.string().datetime({offset: true}).nullable().optional().describe("When the remembered event happened, if known; do not invent a date."),
      note: z.string().trim().max(10000).nullable().optional().describe("Optional provenance note."),
      idempotency_key: mcpIdempotencyKeySchema,
    }).strict(),
    outputSchema: z.object({
      success: z.boolean(),
      data: z.object({memory_id: z.string().uuid(), ...mcpMutationReceiptFields}).strict().optional(),
      error: mcpToolErrorDetailsSchema.optional(),
    }).strict(),
    annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false},
  }, async input => {
    try {
      const userId = await dependencies.requireActiveUser();
      return await invokeMcpWrite({
        toolName: "write_memory", getAuthenticatedUserId: () => userId,
        operation: async context => {
          const occurredAt = input.occurred_at ? new Date(input.occurred_at).toISOString() : null;
          const note = input.note?.trim() || null;
          const state = createMindState({
            id: randomUUID(), userId: context.userId, subjectId: dependencies.subjectId,
            kind: "memory", text: input.text,
            source: {origin: "claude_code", occurredAt, note},
          });
          const result = await dependencies.repository.insertMcpIdempotent({
            userId: context.userId, subjectId: dependencies.subjectId, state,
            idempotencyKey: normalizeMcpIdempotencyKey(input.idempotency_key),
            requestHash: hashMcpWriteRequest({text: state.text, occurred_at: occurredAt, note, source: "claude_code"}),
          });
          const structuredContent = {success: true, data: {
            memory_id: result.memoryId,
            outcome: mcpMutationOutcomeFromReplay(result.replayed),
            entity_type: "memory", entity_id: result.memoryId, revision: null,
            detail_tool: null, detail_arguments: null,
          }};
          // JSON text also preserves the machine receipt in clients omitting structuredContent.
          return {content: [{type: "text" as const, text: JSON.stringify(structuredContent)}], structuredContent};
        }, mapError: safeError,
      });
    } catch (error) { return safeError(error); }
  });
}

function safeError(error: unknown) {
  if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT") {
    return createMcpToolError("IDEMPOTENCY_CONFLICT", "This key already identifies different memory content.", undefined,
      mcpErrorRecoveryHint({retryable: false, reason: "idempotency_conflict"}));
  }
  return createMcpToolError("MEMORY_WRITE_UNAVAILABLE", "Memory writing is unavailable for this request.");
}
