import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UniverseServiceError, type UniverseService } from "../../../domains/universe/universe-service.js";
import { invokeMcpWrite } from "../write-context.js";
import { safeUniverseWriteError, universeWriteErrorDetailsSchema } from "../universe/shared.js";
import { updateUniverseRelationInputSchema } from "./schema.js";

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
  data: z.object({ relation: relationOutputSchema, universe_version: z.number().int().nonnegative() }).strict().optional(),
  error: universeWriteErrorDetailsSchema.optional(),
}).strict();

export type UpdateUniverseRelationToolDependencies = {
  universeService: Pick<UniverseService, "updateMcpRelation">;
  getAuthenticatedUserId: () => string;
};

export function registerUpdateUniverseRelationTool(server: McpServer, dependencies: UpdateUniverseRelationToolDependencies): void {
  server.registerTool("update_universe_relation", {
    title: "Update a Universe relation",
    description: "Apply a partial update to one Universe relation using expected_version. Only relation_type and strength may change; id, source, target, and createdAt remain unchanged. A stale version is a conflict; fresh-read the relation and Universe version before deciding whether another action is needed, and never blindly retry.",
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
        structuredContent: { success: true as const, data: result },
      };
    },
    mapError: (error) => safeUniverseWriteError(error, "Universe relation was not found."),
  }));
}
