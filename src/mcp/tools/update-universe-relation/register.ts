import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UNIVERSE_DOMAIN_BOUNDARY } from "../model-language.js";
import { UniverseServiceError, type UniverseService } from "../../../domains/universe/universe-service.js";
import { invokeMcpWrite } from "../write-context.js";
import { safeUniverseWriteError, universeWriteErrorDetailsSchema } from "../universe/shared.js";
import { updateUniverseRelationInputSchema } from "./schema.js";
import { mcpMutationReceipt, mcpMutationReceiptFields } from "../mutation-contract.js";

const relationOutputSchema = z.object({
  id: z.string().min(1).max(256),
  source: z.string().min(1).max(256),
  target: z.string().min(1).max(256),
  relationType: z.enum(["related_to", "supports", "contradicts", "extends", "part_of", "raises"]),
  strength: z.number().finite().min(0).max(1),
  createdAt: z.string().datetime(),
}).strict();

const outputSchema = z.object({
  success: z.boolean(),
  data: z.object({ relation: relationOutputSchema, universe_version: z.number().int().nonnegative(), ...mcpMutationReceiptFields }).strict().optional(),
  error: universeWriteErrorDetailsSchema.optional(),
}).strict();

export type UpdateUniverseRelationToolDependencies = {
  universeService: Pick<UniverseService, "updateMcpRelation">;
  getAuthenticatedUserId: () => string;
};

export function registerUpdateUniverseRelationTool(server: McpServer, dependencies: UpdateUniverseRelationToolDependencies): void {
  server.registerTool("update_universe_relation", {
    title: "Update a Universe relation",
    description: "expected_version is the global Universe snapshot version, not an entity revision. " + UNIVERSE_DOMAIN_BOUNDARY + " Apply a partial update to one Universe relation. Only relation_type and strength may change; id, source, target, and createdAt remain unchanged. A stale global version is a conflict; fresh-read the relation and Universe version before deciding whether another action is needed, and never blindly retry.",
    inputSchema: updateUniverseRelationInputSchema,
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ relation_id, expected_version, relation_type, strength }) => invokeMcpWrite({
    toolName: "update_universe_relation",
    getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
    operation: async ({ userId }) => {
      if (relation_type === undefined && strength === undefined) {
        throw new UniverseServiceError("INVALID_UNIVERSE");
      }
      const result = await dependencies.universeService.updateMcpRelation(
        userId,
        relation_id,
        {
          ...(relation_type === undefined ? {} : { relationType: relation_type }),
          ...(strength === undefined ? {} : { strength }),
        },
        expected_version,
      );
      return {
        content: [{ type: "text", text: "Universe relation updated." }],
        structuredContent: {
          success: true as const,
          data: {
            ...result,
            ...mcpMutationReceipt({
              outcome: "applied",
              entity_type: "universe_relation",
              entity_id: result.relation.id,
              revision: null,
              detail_tool: "get_universe_relations",
              detail_arguments: { node_id: result.relation.source },
            }),
          },
        },
      };
    },
    mapError: (error) => safeUniverseWriteError(error, "Universe relation was not found."),
  }));
}
