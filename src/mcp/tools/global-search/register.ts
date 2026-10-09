import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GlobalSearchError, type GlobalSearchInput, type GlobalSearchResult } from "../../../domains/global-search/global-search-service.js";
import { createMcpToolError, mcpToolErrorDetailsSchema } from "../error-contract.js";
import { compactMcpText, joinMcpContentLines, quoteMcpText } from "../content-contract.js";

const MAX_QUERY_CODE_POINTS = 200;
const MAX_CURSOR_ENCODED_LENGTH = 2_800;
const DEFAULT_GLOBAL_SEARCH_MODULES = ["diary", "todo", "universe", "mind"] as const;
const GLOBAL_SEARCH_MODULES = DEFAULT_GLOBAL_SEARCH_MODULES;

const globalSearchModuleSchema = z.enum(GLOBAL_SEARCH_MODULES);

const inputSchema = z.object({
  query: z.string().trim().min(1).refine(
    (value) => [...value].length <= MAX_QUERY_CODE_POINTS,
    { message: `query must be at most ${MAX_QUERY_CODE_POINTS} Unicode code points` },
  ).describe("Search phrase across the selected LeileiOS modules."),
  modules: z.array(globalSearchModuleSchema).min(1).max(4)
    .default([...DEFAULT_GLOBAL_SEARCH_MODULES])
    .optional()
    .describe("Domains to search. Defaults to Diary, Todo, Universe, and Mind Memory."),
  scope: z.enum(["active", "archived", "all"]).default("active").optional(),
  mode: z.enum(["normal", "phrase"]).default("normal").optional().describe("normal collapses runs of whitespace before matching; phrase preserves internal whitespace and matches the literal contiguous phrase."),
  author: z.enum(["L", "G", "C"]).optional().describe("Filter Diary and Todo records by author. Universe and Mind Memory have no L/G/C author and are excluded when this filter is set."),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.number().int().min(1).max(25).default(10).optional(),
  cursor: z.string().min(1).max(MAX_CURSOR_ENCODED_LENGTH).optional(),
}).strict();

const globalSearchDetailArgumentsSchema = z.union([
  z.object({ id: z.string().uuid(), scope: z.enum(["active", "archived"]) }).strict(),
  z.object({ id: z.string().min(1).max(256) }).strict(),
  z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
]);

const globalSearchResultSchema = z.object({
  entity_type: globalSearchModuleSchema,
  entity_id: z.string().min(1).max(256),
  stable_name: z.string(),
  snippet: z.string().max(480).describe("At most 240 Unicode code points; astral characters may occupy two UTF-16 code units."),
  matched_field: z.enum(["title", "content", "tags", "mood", "text"]),
  match_reason: z.enum(["exact_stable_name", "exact_phrase", "stable_name_prefix", "field_match"]),
  lifecycle_status: z.enum(["active", "archived"]),
  business_time: z.string().datetime().nullable().describe("Actual business time; null for undated Memory. Memory date filters use occurredAt in Asia/Shanghai."),
  time_basis: z.enum(["updated_at", "diary_date", "todo_date", "message_time", "memory_date", "undated"]),
  updated_at: z.string().datetime(),
  author: z.enum(["L", "G", "C"]).nullable(),
  detail_tool: z.enum(["get_diary", "read_todo_day", "get_universe_node", "get_memory"]).nullable(),
  detail_arguments: globalSearchDetailArgumentsSchema.nullable(),
}).strict().superRefine((result, context) => {
  if (result.detail_tool === null || result.detail_arguments === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["detail_tool"], message: "Search results require an MCP detail pointer." });
    return;
  }

  if (result.entity_type === "mind") {
    if (result.detail_tool !== "get_memory" || !("id" in result.detail_arguments)
      || "scope" in result.detail_arguments || !z.string().uuid().safeParse(result.detail_arguments.id).success
      || result.detail_arguments.id !== result.entity_id) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["detail_arguments"], message: "Mind results require get_memory with the matching UUID id only." });
    }
    if (result.author !== null || result.lifecycle_status !== "active"
      || result.stable_name !== "" || result.matched_field !== "text"
      || !["memory_date", "undated"].includes(result.time_basis)
      || (result.time_basis === "undated") !== (result.business_time === null)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid Memory date, visibility or body-only result semantics." });
    }
    return;
  }
  if (result.business_time === null || ["memory_date", "undated"].includes(result.time_basis)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["business_time"], message: "Only Memory supports an undated business time." });
  }
  if (result.entity_type === "todo") {
    if (result.detail_tool !== "read_todo_day") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["detail_tool"], message: "Todo results must use read_todo_day." });
    }
    if ("date" in result.detail_arguments) return;
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["detail_arguments"], message: "Todo detail_arguments must contain a date." });
    return;
  }

  if (result.entity_type === "universe") {
    if (result.detail_tool !== "get_universe_node") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["detail_tool"], message: "Universe results must use get_universe_node." });
    }
    if ("id" in result.detail_arguments && !("scope" in result.detail_arguments)
      && result.detail_arguments.id.trim().length > 0
      && result.detail_arguments.id.length <= 256) return;
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["detail_arguments"], message: "Universe detail_arguments must contain only an id." });
    return;
  }

  if (result.detail_tool !== "get_diary") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["detail_tool"], message: "Diary results must use get_diary." });
  }
  if ("scope" in result.detail_arguments && "id" in result.detail_arguments && z.string().uuid().safeParse(result.detail_arguments.id).success) return;
  context.addIssue({ code: z.ZodIssueCode.custom, path: ["detail_arguments"], message: "Diary detail_arguments require a UUID id and scope." });
});

const globalSearchDataSchema = z.object({
  results: z.array(globalSearchResultSchema),
  metadata: z.object({
    count: z.number().int().min(0).max(25),
    has_more: z.boolean(),
    next_cursor: z.string().max(MAX_CURSOR_ENCODED_LENGTH).nullable(),
    searched_modules: z.array(globalSearchModuleSchema).min(1).max(4),
    searched_scope: z.enum(["active", "archived", "all"]),
    searched_author: z.enum(["L", "G", "C"]).nullable(),
  }).strict(),
}).strict();

const globalSearchOutputSchema = z.object({
  success: z.boolean(),
  data: globalSearchDataSchema.optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export type GlobalSearchToolDependencies = { globalSearchService: { search(input: GlobalSearchInput): Promise<GlobalSearchResult> }; getAuthenticatedUserId: () => string };

export function registerGlobalSearchTool(server: McpServer, dependencies: GlobalSearchToolDependencies): void {
  server.registerTool("global_search", {
    title: "Search all Leilei OS records",
    description: "Search across LeileiOS Diary, Todo, Universe, and Mind Memory, optionally filtering authored Diary/Todo records by L, G, or C. Prefer a domain search when the domain is known.",
    inputSchema,
    outputSchema: globalSearchOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => {
    try {
      const userId = dependencies.getAuthenticatedUserId();
      const data = await dependencies.globalSearchService.search({ userId, ...args, modules: args.modules ?? [...DEFAULT_GLOBAL_SEARCH_MODULES] });
      return {
        content: [{ type: "text", text: globalSearchContent(data) }],
        structuredContent: { success: true as const, data },
      };
    } catch (error) {
      if (error instanceof GlobalSearchAuthenticationError) {
        return createMcpToolError(
          "AUTHENTICATION_REQUIRED",
          "Authentication is required to use global search.",
        );
      }
      if (error instanceof GlobalSearchError) {
        const unavailable = error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND";
        return createMcpToolError(
          error.code,
          unavailable
            ? "Global search is unavailable for the authenticated user."
            : "The global search request is invalid.",
        );
      }
      console.error(
        "global_search failed",
        error instanceof Error ? error.name : "UnknownError",
      );
      return createMcpToolError(
        "INTERNAL_ERROR",
        "Global search is temporarily unavailable.",
      );
    }
  });
}

function globalSearchContent(data: GlobalSearchResult): string {
  if (data.results.length === 0) {
    return "No matching LeileiOS records were found.";
  }

  return joinMcpContentLines(data.results.map((result) => {
    const detail = result.detail_tool && result.detail_arguments
      ? ` [detail_tool=${result.detail_tool}; detail_arguments=${compactMcpText(JSON.stringify(result.detail_arguments), 400)}]`
      : "";
    const preview = result.entity_type === "mind"
      ? quoteMcpText(result.snippet)
      : `${quoteMcpText(result.stable_name)} — ${quoteMcpText(result.snippet)}`;
    return `${result.entity_type} ${preview}${detail}`;
  }));
}

export class GlobalSearchAuthenticationError extends Error {
  constructor() {
    super("Global Search authentication is required.");
    this.name = "GlobalSearchAuthenticationError";
  }
}
