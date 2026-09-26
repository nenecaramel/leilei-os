import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UNIVERSE_DOMAIN_BOUNDARY } from "../model-language.js";
import { UniverseServiceError, type UniverseService } from "../../../domains/universe/universe-service.js";
import { invokeMcpWrite } from "../write-context.js";
import { safeUniverseWriteError, universeWriteErrorDetailsSchema } from "../universe/shared.js";
import { createUniverseRelationInputSchema } from "./schema.js";
import { joinMcpContentLines } from "../content-contract.js";
import { mcpMutationReceipt, mcpMutationReceiptFields, mcpMutationOutcomeFromReplay } from "../mutation-contract.js";

const relationOutputSchema = z.object({
  id: z.string().min(1).max(256), source: z.string().min(1).max(256), target: z.string().min(1).max(256),
  relationType: z.enum(["related_to", "supports", "contradicts", "extends", "part_of", "raises"]),
  strength: z.number().finite(), created_at: z.string().datetime(),
}).strict();
const successDataSchema = z.object({ relation: relationOutputSchema, universe_version: z.number().int().nonnegative(), ...mcpMutationReceiptFields }).strict();
const outputSchema = z.object({
  success: z.boolean(),
  data: successDataSchema.optional(),
  error: universeWriteErrorDetailsSchema.optional(),
}).strict();

export type CreateUniverseRelationToolDependencies = {
  universeService: Pick<UniverseService, "createMcpRelation">;
  getAuthenticatedUserId: () => string;
};

export function registerCreateUniverseRelationTool(server: McpServer, dependencies: CreateUniverseRelationToolDependencies): void {
  server.registerTool("create_universe_relation", {
    title: "Create a Universe relation",
    description: "Create a directional Universe relation.",
    inputSchema: createUniverseRelationInputSchema,
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ source, target, relation_type, strength, expected_version, idempotency_key }) =>
    invokeMcpWrite({
      toolName: "create_universe_relation",
      getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
      operation: async ({ userId }) => {
        if (source === target) throw new UniverseServiceError("RELATION_INVALID");
        const data = await dependencies.universeService.createMcpRelation(
          userId,
          { source, target, relationType: relation_type, strength },
          expected_version,
          idempotency_key,
        );
        return {
          content: [{ type: "text", text: joinMcpContentLines([
            `${data.metadata.idempotent_replay ? "Universe relation replayed" : "Universe relation created"}: ${data.relation.id} ${data.relation.source}->${data.relation.target}; version=${data.universe_version}`,
          ]) }],
          structuredContent: {
            success: true as const,
            data: {
              relation: {
                id: data.relation.id,
                source: data.relation.source,
                target: data.relation.target,
                relationType: data.relation.relationType,
                strength: data.relation.strength,
                created_at: data.relation.createdAt,
              },
              universe_version: data.universe_version,
              ...mcpMutationReceipt({
                outcome: mcpMutationOutcomeFromReplay(
                  data.metadata.idempotent_replay,
                ),
                entity_type: "universe_relation",
                entity_id: data.relation.id,
                revision: null,
                detail_tool: "get_universe_relations",
                detail_arguments: { node_id: data.relation.source },
              }),
            },
          },
        };
      },
      mapError: (error) => safeUniverseWriteError(error, "Universe relation was not created."),
    }),
  );
}
