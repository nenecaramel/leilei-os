import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GlobalSearchError, type GlobalSearchInput, type GlobalSearchResult } from "../../../domains/global-search/global-search-service.js";

const MAX_CURSOR_ENCODED_LENGTH = 2800;

const inputSchema = z.object({
  query: z
    .string()
    .max(400)
    .refine((value) => {
      const normalized = value.normalize("NFC").trim();
      return normalized.length > 0 && [...normalized].length <= 200;
    }, "Query must contain 1 to 200 Unicode code points after NFC normalization and trimming."),
  modules: z.array(z.enum(["memory", "diary", "task", "universe"])).min(1).max(4).optional(),
  scope: z.enum(["active", "archived", "all"]).optional(),
  mode: z.enum(["phrase", "normal"]).optional(),
  date_from: z.string().max(10).optional(),
  date_to: z.string().max(10).optional(),
  limit: z.number().int().min(1).max(25).optional(),
  cursor: z.string().max(MAX_CURSOR_ENCODED_LENGTH).optional(),
}).strict();

const detailArgumentsSchema = z.union([
  z.object({ id: z.string().uuid(), scope: z.enum(["active", "archived"]) }).strict(),
  z.object({ id: z.string().min(1).max(256) }).strict(),
]);

const globalSearchResultSchema = z.object({
  entity_type: z.enum(["memory", "diary", "task", "universe"]),
  entity_id: z.string().min(1).max(256),
  stable_name: z.string(),
  snippet: z.string().max(480).describe("At most 240 Unicode code points; astral characters may occupy two UTF-16 code units."),
  matched_field: z.enum(["key", "title", "content", "description", "tags", "mood"]),
  match_reason: z.enum(["exact_stable_name", "exact_phrase", "stable_name_prefix", "field_match"]),
  lifecycle_status: z.enum(["active", "archived"]),
  business_time: z.string().datetime(),
  time_basis: z.enum(["updated_at", "diary_date", "due_time", "created_at"]),
  updated_at: z.string().datetime(),
  detail_tool: z.enum(["get_memory", "get_diary", "get_task", "get_universe_node"]).nullable(),
  detail_arguments: detailArgumentsSchema.nullable(),
}).strict().superRefine((result, context) => {
  if (result.detail_tool === null) {
    if (result.detail_arguments !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["detail_arguments"], message: "Null detail_tool requires null detail_arguments." });
    }
    return;
  }
  if (result.detail_arguments === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["detail_arguments"], message: "A detail tool requires detail_arguments." });
    return;
  }

  if (result.entity_type === "universe") {
    if (result.detail_tool !== "get_universe_node") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["detail_tool"], message: "Universe results must use get_universe_node." });
    }
    if (!("scope" in result.detail_arguments)
      && result.detail_arguments.id.trim().length > 0
      && result.detail_arguments.id.length <= 256) return;
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["detail_arguments"], message: "Universe detail_arguments must contain only a canonical node id." });
    return;
  }

  const expectedTool = ({ memory: "get_memory", diary: "get_diary", task: "get_task" } as const)[result.entity_type];
  if (result.detail_tool !== expectedTool) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["detail_tool"], message: "Detail tool must match the result module." });
  }
  if ("scope" in result.detail_arguments && z.string().uuid().safeParse(result.detail_arguments.id).success) return;
  context.addIssue({ code: z.ZodIssueCode.custom, path: ["detail_arguments"], message: "Memory, Diary, and Task detail_arguments require a UUID id and scope." });
});

const globalSearchOutputSchema = z.object({
  success: z.literal(true),
  data: z.object({
    results: z.array(globalSearchResultSchema),
    metadata: z.object({
      count: z.number().int().min(0).max(25),
      has_more: z.boolean(),
      next_cursor: z.string().max(MAX_CURSOR_ENCODED_LENGTH).nullable(),
      searched_modules: z.array(z.enum(["memory", "diary", "task", "universe"])).min(1).max(4),
      searched_scope: z.enum(["active", "archived", "all"]),
    }).strict(),
  }).strict(),
}).strict();

export type GlobalSearchToolDependencies = { globalSearchService: { search(input: GlobalSearchInput): Promise<GlobalSearchResult> }; getAuthenticatedUserId: () => string };

export function registerGlobalSearchTool(server: McpServer, dependencies: GlobalSearchToolDependencies): void {
  server.registerTool("global_search", {
    title: "Search all Leilei OS records",
    description: "Use global_search for previously recorded experiences, preferences, decisions, plans, tasks, diary entries, Universe nodes, project facts, or whenever model memory is uncertain. Use active for current state and all for 以前、曾经、历史、所有记录. No results means nothing was found: never invent an answer. Compare conflicting records by module, lifecycle, and time; archived records are historical, not automatically current. Before relying on private full content, call the returned detail_tool with detail_arguments when one is available. Preserve entity type, ID, and time when summarizing important results.",
    inputSchema,
    outputSchema: globalSearchOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => {
    try {
      const userId = dependencies.getAuthenticatedUserId();
      const data = await dependencies.globalSearchService.search({ userId, ...args });
      return { content: [{ type: "text", text: `Found ${data.metadata.count} records.` }], structuredContent: { success: true as const, data } };
    } catch (error) {
      if (error instanceof GlobalSearchAuthenticationError) {
        return { isError: true as const, content: [{ type: "text" as const, text: "Authentication is required to use global search." }] };
      }
      const unavailable = error instanceof GlobalSearchError && (error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND");
      return { isError: true as const, content: [{ type: "text" as const, text: unavailable ? "Global search is unavailable for the authenticated user." : error instanceof GlobalSearchError ? "The global search request is invalid." : "Global search is temporarily unavailable." }] };
    }
  });
}

export class GlobalSearchAuthenticationError extends Error {
  constructor() {
    super("Global search authentication is required.");
    this.name = "GlobalSearchAuthenticationError";
  }
}
