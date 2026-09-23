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
  strength: z.number().finite(), createdAt: z.string().datetime(),
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
    description: "expected_version is the global Universe snapshot version, not an entity revision. " + UNIVERSE_DOMAIN_BOUNDARY + " Create one directional Universe relation with strength 0..1. The server owns the relation ID and timestamp. Supply a unique idempotency_key for this logical create; reuse it only to replay the exact same request. If the outcome is uncertain, fresh-read Universe state before deciding whether a new mutation is needed; never blindly retry.",
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
              relation: data.relation,
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
