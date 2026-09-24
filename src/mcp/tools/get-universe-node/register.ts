import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UNIVERSE_DOMAIN_BOUNDARY } from "../model-language.js";
import type { UniverseService } from "../../../domains/universe/universe-service.js";
import { mcpToolErrorDetailsSchema } from "../error-contract.js";
import { safeUniverseReadError } from "../universe/shared.js";
import { UniverseServiceError } from "../../../domains/universe/universe-service.js";
import { joinMcpContentLines, quoteMcpText } from "../content-contract.js";

const nodeIdSchema = z.string().trim().min(1).max(256).describe("Exact canonical Universe node ID.");
const membershipSchema = z.object({ id: z.string().min(1).max(256), weight: z.number().finite() }).strict();
const nodeSchema = z.object({
  id: z.string().min(1).max(256), title: z.string(), summary: z.string(), content: z.string(), type: z.string(), tags: z.array(z.string()),
  galaxies: z.array(membershipSchema), position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  importance: z.string().optional().describe("Readable but not writable through the MCP surface."),
  migration: z.object({
    source: z.enum(["mind-universe-static", "mind-universe"]),
    migrated_at: z.string().datetime(),
  }).strict().optional().describe("Migration metadata; readable but not writable through the MCP surface."),
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
    title: "Get one Universe node", description: "Read one Universe node in full.", inputSchema: z.object({ id: nodeIdSchema }).strict(), outputSchema,
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
        structuredContent: {
          success: true as const,
          data: {
            id: result.node.id,
            title: result.node.title,
            summary: result.node.summary,
            content: result.node.content,
            type: result.node.type,
            tags: result.node.tags,
            galaxies: result.node.galaxies,
            position: result.node.position,
            created_at: result.node.createdAt,
            updated_at: result.node.updatedAt,
            ...(result.node.importance === undefined ? {} : { importance: result.node.importance }),
            ...(result.node.migration === undefined ? {} : {
              migration: {
                source: result.node.migration.source,
                migrated_at: result.node.migration.migratedAt,
              },
            }),
            universe_version: result.version,
          },
        },
      };
    } catch (error) {
      return safeUniverseReadError(error, "Universe node was not found.");
    }
  });
}
