import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { UniverseService } from "../../../domains/universe/universe-service.js";
import { invokeMcpWrite } from "../write-context.js";
import { safeUniverseWriteError, universeWriteErrorDetailsSchema } from "../universe/shared.js";

const inputSchema = z.object({
  relation_id: z.string().trim().min(1).max(256),
  expected_version: z.number().int().nonnegative(),
}).strict();

const outputSchema = z.object({
  success: z.literal(true),
  data: z.object({ relation_id: z.string().min(1).max(256), universe_version: z.number().int().nonnegative() }).strict(),
  error: universeWriteErrorDetailsSchema.optional(),
}).strict();

export type DeleteUniverseRelationToolDependencies = {
  relationService: Pick<UniverseService, "deleteRelation">;
  getAuthenticatedUserId: () => string;
};

export function registerDeleteUniverseRelationTool(server: McpServer, dependencies: DeleteUniverseRelationToolDependencies): void {
  server.registerTool("delete_universe_relation", {
    title: "Delete a Universe relation",
    description: "Delete one authenticated Universe relation. This is a destructive, non-idempotent mutation. If the transport outcome is uncertain, fresh-read the relation and Universe version before deciding whether another action is needed; never blindly retry.",
    inputSchema,
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ relation_id, expected_version }) => invokeMcpWrite({
    toolName: "delete_universe_relation",
    getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
    operation: async ({ userId }) => {
      const result = await dependencies.relationService.deleteRelation(userId, relation_id, expected_version);
      return {
        content: [{ type: "text", text: "Universe relation deleted." }],
        structuredContent: { success: true as const, data: { relation_id, universe_version: result.version } },
      };
    },
    mapError: (error) => safeUniverseWriteError(error, "Universe relation was not found."),
  }));
}
