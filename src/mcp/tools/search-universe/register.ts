import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UNIVERSE_DOMAIN_BOUNDARY } from "../model-language.js";
import {
  GlobalSearchError,
  type GlobalSearchInput,
  type GlobalSearchResult,
} from "../../../domains/global-search/global-search-service.js";
import { createMcpToolError, mcpToolErrorDetailsSchema } from "../error-contract.js";
import { safeUniverseReadError, UniverseAuthenticationError } from "../universe/shared.js";
import { formatMcpDetailPointer, joinMcpContentLines, quoteMcpText } from "../content-contract.js";

const MAX_CURSOR_ENCODED_LENGTH = 2800;
const inputSchema = z.object({
  query: z.string().max(400).refine((value) => {
    const normalized = value.normalize("NFC").trim();
    return normalized.length > 0 && [...normalized].length <= 200;
  }, "Query must contain 1 to 200 Unicode code points after NFC normalization and trimming."),
  limit: z.number().int().min(1).max(25).default(10).optional().describe("Maximum results per page. Defaults to 10."),
  cursor: z.string().max(MAX_CURSOR_ENCODED_LENGTH).optional(),
}).strict();

const itemSchema = z.object({
  entity_type: z.literal("universe"),
  entity_id: z.string().min(1).max(256),
  stable_name: z.string(),
  snippet: z.string(),
  matched_field: z.enum(["title", "content", "tags"]),
  match_reason: z.enum(["exact_stable_name", "exact_phrase", "stable_name_prefix", "field_match"]),
  lifecycle_status: z.literal("active"),
  business_time: z.string().datetime(),
  time_basis: z.literal("updated_at"),
  updated_at: z.string().datetime(),
  detail_tool: z.literal("get_universe_node"),
  detail_arguments: z.object({ id: z.string().min(1).max(256) }).strict(),
}).strict();
const outputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    results: z.array(itemSchema).max(25),
    metadata: z.object({
      count: z.number().int().min(0).max(25),
      has_more: z.boolean(),
      next_cursor: z.string().max(MAX_CURSOR_ENCODED_LENGTH).nullable(),
      searched_modules: z.tuple([z.literal("universe")]),
      searched_scope: z.literal("active"),
    }).strict(),
  }).strict().optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export type SearchUniverseToolDependencies = {
  globalSearchService: { search(input: GlobalSearchInput): Promise<GlobalSearchResult> };
  getAuthenticatedUserId: () => string;
};

export function registerSearchUniverseTool(server: McpServer, dependencies: SearchUniverseToolDependencies): void {
  server.registerTool("search_universe", {
    title: "Search Universe",
    description: UNIVERSE_DOMAIN_BOUNDARY + " Search the authenticated user's active Universe nodes by text. Results are compact discovery records with stable IDs and pagination evidence; use list_universe_nodes for query-free browsing and get_universe_node for an exact selected node.",
    inputSchema,
    outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ query, limit, cursor }) => {
    try {
      const userId = dependencies.getAuthenticatedUserId();
      const data = await dependencies.globalSearchService.search({
        userId,
        query,
        modules: ["universe"],
        scope: "active",
        mode: "normal",
        limit,
        cursor,
      });
      const universeData = {
        results: data.results.filter((result) => result.entity_type === "universe").map((result) => ({
          entity_type: "universe" as const,
          entity_id: result.entity_id,
          stable_name: result.stable_name,
          snippet: result.snippet,
          matched_field: result.matched_field as "title" | "content" | "tags",
          match_reason: result.match_reason,
          lifecycle_status: "active" as const,
          business_time: result.business_time,
          time_basis: "updated_at" as const,
          updated_at: result.updated_at,
          detail_tool: "get_universe_node" as const,
          detail_arguments: { id: result.entity_id },
        })),
        metadata: {
          count: data.results.filter((result) => result.entity_type === "universe").length,
          has_more: data.metadata.has_more,
          next_cursor: data.metadata.next_cursor,
          searched_modules: ["universe"] as ["universe"],
          searched_scope: "active" as const,
        },
      };
      return {
        content: [{ type: "text", text: universeSearchContent(universeData) }],
        structuredContent: { success: true as const, data: universeData },
      };
    } catch (error) {
      if (error instanceof UniverseAuthenticationError) return safeUniverseReadError(error, "A Universe node was not found.");
      if (error instanceof GlobalSearchError) {
        const text = error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND"
          ? "Universe is unavailable for the authenticated user."
          : "The Universe search request is invalid.";
        return createMcpToolError(error.code, text);
      }
      return safeUniverseReadError(error, "A Universe node was not found.");
    }
  });
}

function universeSearchContent(data: { results: Array<{ entity_id: string; stable_name: string; snippet: string; detail_arguments: { id: string } }>; metadata: { count: number } }): string {
  const lines = [`Found ${data.metadata.count} Universe nodes.`];
  for (const result of data.results) {
    lines.push(`${quoteMcpText(result.stable_name)} [id=${result.entity_id}; ${formatMcpDetailPointer("get_universe_node", result.detail_arguments)}] — ${quoteMcpText(result.snippet)}`);
  }
  return joinMcpContentLines(lines);
}
