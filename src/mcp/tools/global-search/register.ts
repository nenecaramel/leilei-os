import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GlobalSearchError, type GlobalSearchInput, type GlobalSearchResult } from "../../../domains/global-search/global-search-service.js";

const inputSchema = z.object({
  query: z.string().max(1000),
  modules: z.array(z.enum(["memory", "diary", "task"])).min(1).max(3).optional(),
  scope: z.enum(["active", "archived", "all"]).optional(),
  mode: z.enum(["phrase", "normal"]).optional(),
  date_from: z.string().max(10).optional(),
  date_to: z.string().max(10).optional(),
  limit: z.number().int().min(1).max(25).optional(),
  cursor: z.string().max(1200).optional(),
}).strict();

export type GlobalSearchToolDependencies = { globalSearchService: { search(input: GlobalSearchInput): Promise<GlobalSearchResult> }; getAuthenticatedUserId: () => string };

export function registerGlobalSearchTool(server: McpServer, dependencies: GlobalSearchToolDependencies): void {
  server.registerTool("global_search", {
    title: "Search all Leilei OS records",
    description: "Use global_search for previously recorded experiences, preferences, decisions, plans, tasks, diary entries, project facts, or whenever model memory is uncertain. Use active for current state and all for 以前、曾经、历史、所有记录. No results means nothing was found: never invent an answer. Compare conflicting records by module, lifecycle, and time; archived records are historical, not automatically current. Before relying on private full content, call the returned detail_tool with detail_arguments. Preserve entity type, ID, and time when summarizing important results.",
    inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => {
    try {
      const data = await dependencies.globalSearchService.search({ userId: dependencies.getAuthenticatedUserId(), ...args });
      return { content: [{ type: "text", text: `Found ${data.metadata.count} records.` }], structuredContent: { success: true as const, data } };
    } catch (error) {
      const unavailable = error instanceof GlobalSearchError && (error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND");
      return { isError: true as const, content: [{ type: "text" as const, text: unavailable ? "Global search is unavailable for the authenticated user." : error instanceof GlobalSearchError ? "The global search request is invalid." : "Global search is temporarily unavailable." }] };
    }
  });
}
