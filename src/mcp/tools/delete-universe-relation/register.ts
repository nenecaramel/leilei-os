import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UNIVERSE_DOMAIN_BOUNDARY } from "../model-language.js";
import type { UniverseService } from "../../../domains/universe/universe-service.js";
import { invokeMcpWrite } from "../write-context.js";
import { safeUniverseWriteError, universeWriteErrorDetailsSchema } from "../universe/shared.js";
import { joinMcpContentLines } from "../content-contract.js";
import { mcpMutationReceipt, mcpMutationReceiptFields } from "../mutation-contract.js";
import { universeExpectedVersionSchema } from "../idempotency-contract.js";

const inputSchema = z.object({
  relation_id: z.string().trim().min(1).max(256),
  expected_version: universeExpectedVersionSchema,
}).strict();

const outputSchema = z.object({
  success: z.boolean(),
  data: z.object({ relation_id: z.string().min(1).max(256), universe_version: z.number().int().nonnegative(), ...mcpMutationReceiptFields }).strict().optional(),
  error: universeWriteErrorDetailsSchema.optional(),
}).strict();

export type DeleteUniverseRelationToolDependencies = {
  relationService: Pick<UniverseService, "deleteRelation">;
  getAuthenticatedUserId: () => string;
};

export function registerDeleteUniverseRelationTool(server: McpServer, dependencies: DeleteUniverseRelationToolDependencies): void {
  server.registerTool("delete_universe_relation", {
    title: "Delete a Universe relation",
    description: "expected_version is the global Universe snapshot version, not an entity revision. " + UNIVERSE_DOMAIN_BOUNDARY + " Delete one authenticated Universe relation. This is a destructive, non-idempotent mutation. If the transport outcome is uncertain, fresh-read the relation and Universe version before deciding whether another action is needed; never blindly retry.",
    inputSchema,
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ relation_id, expected_version }) => invokeMcpWrite({
    toolName: "delete_universe_relation",
    getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
    operation: async ({ userId }) => {
      const result = await dependencies.relationService.deleteRelation(userId, relation_id, expected_version);
      return {
        content: [{ type: "text", text: joinMcpContentLines([
          `Universe relation deleted: ${relation_id}; version=${result.version}`,
        ]) }],
        structuredContent: {
          success: true as const,
          data: {
            relation_id,
            universe_version: result.version,
            ...mcpMutationReceipt({
              outcome: "applied",
              entity_type: "universe_relation",
              entity_id: relation_id,
              revision: null,
              detail_tool: null,
              detail_arguments: null,
            }),
          },
        },
      };
    },
    mapError: (error) => safeUniverseWriteError(error, "Universe relation was not found."),
  }));
}
