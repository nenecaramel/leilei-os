import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { UniverseService } from "../../../domains/universe/universe-service.js";
import { UniverseServiceError } from "../../../domains/universe/universe-service.js";
import { safeUniverseError } from "../universe/shared.js";

const relationSchema = z.object({
  id: z.string().min(1).max(256), source: z.string().min(1).max(256), target: z.string().min(1).max(256),
  relation_type: z.enum(["related_to", "supports", "contradicts", "extends", "part_of", "raises"]),
  strength: z.number().finite(), created_at: z.string().datetime(),
}).strict();
const outputSchema = z.object({
  success: z.literal(true),
  data: z.object({
    node_id: z.string().min(1).max(256),
    relations: z.array(relationSchema),
    metadata: z.object({ count: z.number().int().min(0) }).strict(),
    universe_version: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export type GetUniverseRelationsToolDependencies = { universeService: Pick<UniverseService, "loadUniverse">; getAuthenticatedUserId: () => string };

export function registerGetUniverseRelationsTool(server: McpServer, dependencies: GetUniverseRelationsToolDependencies): void {
  server.registerTool("get_universe_relations", {
    title: "Get Universe node relations", description: "Expand the relationships around one known authenticated Universe node by exact node ID. This is a neighborhood read, not global Universe discovery.",
    inputSchema: z.object({ node_id: z.string().trim().min(1).max(256).describe("Exact canonical Universe node ID.") }).strict(), outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ node_id }) => {
    try {
      const userId = dependencies.getAuthenticatedUserId();
      const { snapshot, version } = await dependencies.universeService.loadUniverse(userId);
      if (!snapshot.nodes.some((node) => node.id === node_id)) throw new UniverseServiceError("NODE_NOT_FOUND");
      const relations = snapshot.relations.filter((relation) => relation.source === node_id || relation.target === node_id).map((relation) => ({
        id: relation.id, source: relation.source, target: relation.target, relation_type: relation.relationType, strength: relation.strength, created_at: relation.createdAt,
      }));
      return {
        content: [{ type: "text", text: `Found ${relations.length} Universe relations.` }],
        structuredContent: { success: true as const, data: { node_id, relations, metadata: { count: relations.length }, universe_version: version } },
      };
    } catch (error) {
      return safeUniverseError(error, "Universe node was not found.");
    }
  });
}
