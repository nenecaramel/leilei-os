import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { UniverseService } from "../../../domains/universe/universe-service.js";
import { safeUniverseError } from "../universe/shared.js";

const inputSchema = z.object({ node_id: z.string().trim().min(1).max(256) }).strict();
const sourceSchema = z.object({
  diary_id: z.string().uuid(),
  title: z.string(),
  date: z.string(),
  status: z.enum(["active", "archived"]),
}).strict();
const outputSchema = z.object({
  success: z.literal(true),
  data: z.object({
    node_id: z.string().min(1).max(256),
    sources: z.array(sourceSchema),
    metadata: z.object({ count: z.number().int().min(0) }).strict(),
    universe_version: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export type GetUniverseDiarySourcesToolDependencies = {
  sourceService: Pick<UniverseService, "getUniverseDiarySources">;
  getAuthenticatedUserId: () => string;
};

export function registerGetUniverseDiarySourcesTool(server: McpServer, dependencies: GetUniverseDiarySourcesToolDependencies): void {
  server.registerTool("get_universe_diary_sources", {
    title: "Get Universe Diary sources",
    description: "Read the authenticated user's active and archived Diary sources for one exact Universe node. Returns only live source metadata, never Diary body content.",
    inputSchema,
    outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ node_id }) => {
    try {
      const userId = dependencies.getAuthenticatedUserId();
      const result = await dependencies.sourceService.getUniverseDiarySources(userId, node_id);
      const sources = result.sources.map((source) => ({
        diary_id: source.diaryId,
        title: source.title,
        date: source.date,
        status: source.status,
      }));
      return {
        content: [{ type: "text", text: `Found ${sources.length} Universe Diary sources.` }],
        structuredContent: { success: true as const, data: { node_id, sources, metadata: { count: sources.length }, universe_version: result.version } },
      };
    } catch (error) {
      return safeUniverseError(error, "Universe node was not found.");
    }
  });
}
