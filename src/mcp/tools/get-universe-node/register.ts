import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UNIVERSE_DOMAIN_BOUNDARY } from "../model-language.js";
import type { UniverseService } from "../../../domains/universe/universe-service.js";
import type { UniverseNode } from "../../../domains/universe/universe-types.js";
import { mcpToolErrorDetailsSchema } from "../error-contract.js";
import { safeUniverseReadError } from "../universe/shared.js";
import { UniverseServiceError } from "../../../domains/universe/universe-service.js";
import { joinMcpContentLines, quoteMcpText } from "../content-contract.js";

const nodeIdSchema = z.string().trim().min(1).max(256).describe("Exact canonical Universe node ID.");
const membershipSchema = z.object({ id: z.string().min(1).max(256), weight: z.number().finite() }).strict();
const nodeSchema = z.object({
  id: z.string().min(1).max(256), title: z.string(), summary: z.string(), content: z.string(), type: z.string(), tags: z.array(z.string()),
  galaxies: z.array(membershipSchema), position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), importance: z.string().optional(),
  migration: z.object({ source: z.enum(["mind-universe-static", "mind-universe"]), migratedAt: z.string().datetime() }).strict().optional(),
}).strict();
const outputSchema = z.object({
  success: z.boolean(),
  data: nodeSchema.extend({ universe_version: z.number().int().nonnegative() }).optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export type GetUniverseNodeToolDependencies = {
  universeService: Partial<Pick<UniverseService, "readUniverseNode" | "loadUniverse">>;
  getAuthenticatedUserId: () => string;
};

export function registerGetUniverseNodeTool(server: McpServer, dependencies: GetUniverseNodeToolDependencies): void {
  server.registerTool("get_universe_node", {
    title: "Get one Universe node", description: UNIVERSE_DOMAIN_BOUNDARY + " Read the full authoritative detail of one authenticated Universe node by exact stable ID. Use this after list_universe_nodes, search_universe, or a mutation receipt.", inputSchema: z.object({ id: nodeIdSchema }).strict(), outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ id }) => {
    try {
      const userId = dependencies.getAuthenticatedUserId();
      const result = dependencies.universeService.readUniverseNode
        ? await dependencies.universeService.readUniverseNode(userId, id)
        : await dependencies.universeService.loadUniverse!(userId).then(({ snapshot, version }) => ({ node: snapshot.nodes.find((candidate) => candidate.id === id) ?? null, version }));
      if (!result.node) throw new UniverseServiceError("NODE_NOT_FOUND");
      return {
        content: [{
          type: "text",
          text: joinMcpContentLines([
            `Universe node ${quoteMcpText(result.node.title)} [id=${result.node.id}; type=${result.node.type}]`,
            result.node.summary,
            result.node.content || "(empty)",
          ]),
        }],
        structuredContent: { success: true as const, data: { ...(result.node as UniverseNode), universe_version: result.version } },
      };
    } catch (error) {
      return safeUniverseReadError(error, "Universe node was not found.");
    }
  });
}
