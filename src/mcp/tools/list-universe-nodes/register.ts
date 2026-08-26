import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { UniverseService } from "../../../domains/universe/universe-service.js";
import { UniverseServiceError } from "../../../domains/universe/universe-service.js";
import { safeUniverseError } from "../universe/shared.js";

const cursorSchema = z.string().min(1).max(2048);
const outputNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  tags: z.array(z.string()),
  galaxies: z.array(z.string()),
  importance: z.string().nullable(),
  updated_at: z.string().datetime(),
  summary_preview: z.string(),
  detail_tool: z.literal("get_universe_node"),
  detail_arguments: z.object({ id: z.string() }).strict(),
}).strict();

const outputSchema = z.object({
  success: z.literal(true),
  data: z.object({
    count: z.number().int().nonnegative(),
    has_more: z.boolean(),
    next_cursor: z.string().nullable(),
    universe_version: z.number().int().nonnegative(),
    nodes: z.array(outputNodeSchema),
  }).strict(),
}).strict();

export type ListUniverseNodesToolDependencies = {
  universeService: Pick<UniverseService, "listUniverseNodes">;
  getAuthenticatedUserId: () => string;
};

type Cursor = { updatedAt: string; id: string };

export function registerListUniverseNodesTool(server: McpServer, dependencies: ListUniverseNodesToolDependencies): void {
  server.registerTool("list_universe_nodes", {
    title: "List Universe nodes",
    description: "Browse the authenticated user's Universe nodes without a text query. Results are compact summaries with stable IDs; use search_universe for text discovery and get_universe_node for the complete content of a selected node.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional(), cursor: cursorSchema.optional() }).strict(),
    outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ limit = 25, cursor }) => {
    try {
      const userId = dependencies.getAuthenticatedUserId();
      const after = cursor === undefined ? undefined : decodeCursor(cursor);
      const result = await dependencies.universeService.listUniverseNodes(userId, limit, after);
      const nodes = result.nodes.map((node) => ({
        id: node.id,
        title: node.title,
        type: node.type,
        tags: node.tags,
        galaxies: node.galaxies,
        importance: node.importance,
        updated_at: node.updatedAt.toISOString(),
        summary_preview: compactSummary(node.summaryPreview),
        detail_tool: "get_universe_node" as const,
        detail_arguments: { id: node.id },
      }));
      const last = nodes[nodes.length - 1];
      return {
        content: [{ type: "text", text: `Found ${nodes.length} Universe nodes.` }],
        structuredContent: {
          success: true as const,
          data: {
            count: nodes.length,
            has_more: result.hasMore,
            next_cursor: result.hasMore && last ? encodeCursor({ updatedAt: last.updated_at, id: last.id }) : null,
            universe_version: result.version,
            nodes,
          },
        },
      };
    } catch (error) {
      return safeUniverseError(error, "Universe node was not found.");
    }
  });
}

function compactSummary(summary: string): string {
  const codePoints = Array.from(summary.normalize("NFC"));
  return codePoints.length <= 240 ? summary.normalize("NFC") : `${codePoints.slice(0, 239).join("")}…`;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify({ updated_at: cursor.updatedAt, id: cursor.id }), "utf8").toString("base64url");
}

function decodeCursor(value: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || typeof record.updated_at !== "string" || typeof record.id !== "string") throw new Error("shape");
    if (Number.isNaN(Date.parse(record.updated_at)) || record.id.trim().length === 0 || record.id.length > 256) throw new Error("value");
    return { updatedAt: new Date(record.updated_at).toISOString(), id: record.id };
  } catch {
    throw new UniverseServiceError("INVALID_UNIVERSE");
  }
}
