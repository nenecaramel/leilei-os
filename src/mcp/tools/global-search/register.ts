import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GlobalSearchError, type GlobalSearchInput, type GlobalSearchResult } from "../../../domains/global-search/global-search-service.js";
import { createMcpToolError, mcpToolErrorDetailsSchema } from "../error-contract.js";
import { formatMcpDetailPointer, joinMcpContentLines, quoteMcpText } from "../content-contract.js";

const MAX_CURSOR_ENCODED_LENGTH = 2800;
const DEFAULT_GLOBAL_SEARCH_MODULES = ["memory", "diary", "task", "todo", "universe", "shared_paper"] as const;
const GLOBAL_SEARCH_MODULES = [...DEFAULT_GLOBAL_SEARCH_MODULES, "conversation"] as const;
const globalSearchModuleSchema = z.enum(GLOBAL_SEARCH_MODULES);

const inputSchema = z.object({
  query: z
    .string()
    .max(400)
    .refine((value) => {
      const normalized = value.normalize("NFC").trim();
      return normalized.length > 0 && [...normalized].length <= 200;
    }, "Query must contain 1 to 200 Unicode code points after NFC normalization and trimming."),
  modules: z.array(globalSearchModuleSchema).min(1).max(7).default([...DEFAULT_GLOBAL_SEARCH_MODULES]).optional()
    .describe("Domains to search. Defaults to Memory, Diary, Task, Todo, Universe, and Shared Paper. Conversation Archive is opt-in because it can contain a very large message corpus."),
  scope: z.enum(["active", "archived", "all"]).default("active").optional()
    .describe("Lifecycle scope. Defaults to active; use all for explicit historical/all-record requests."),
  mode: z.enum(["phrase", "normal"]).default("normal").optional()
    .describe("Search mode. Defaults to normal; use phrase only when exact phrase matching is intended."),
  date_from: z.string().max(10).optional(),
  date_to: z.string().max(10).optional(),
  limit: z.number().int().min(1).max(25).default(10).optional()
    .describe("Maximum results per page. Defaults to 10."),
  cursor: z.string().max(MAX_CURSOR_ENCODED_LENGTH).optional(),
}).strict();

const detailArgumentsSchema = z.union([
  z.object({ id: z.string().uuid(), scope: z.enum(["active", "archived"]) }).strict(),
  z.object({ id: z.string().min(1).max(256) }).strict(),
  z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
]);

const globalSearchResultSchema = z.object({
  entity_type: globalSearchModuleSchema,
  entity_id: z.string().min(1).max(256),
  stable_name: z.string(),
  snippet: z.string().max(480).describe("At most 240 Unicode code points; astral characters may occupy two UTF-16 code units."),
  matched_field: z.enum(["key", "title", "content", "description", "tags", "mood", "text"]),
  match_reason: z.enum(["exact_stable_name", "exact_phrase", "stable_name_prefix", "field_match"]),
  lifecycle_status: z.enum(["active", "archived"]),
  business_time: z.string().datetime(),
  time_basis: z.enum(["updated_at", "diary_date", "due_time", "created_at", "todo_date", "message_time"]),
  updated_at: z.string().datetime(),
  author: z.enum(["L", "G", "C"]).nullable(),
  detail_tool: z.enum(["get_memory", "get_diary", "get_task", "read_todo_day", "get_universe_node", "get_shared_paper"]).nullable(),
  detail_arguments: detailArgumentsSchema.nullable(),
  conversation_id: z.string().uuid().nullable(),
  conversation_view: z.enum(["default", "all"]).nullable(),
}).strict().superRefine((result, context) => {
  if (result.entity_type === "conversation") {
    if (result.detail_tool !== null || result.detail_arguments !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["detail_tool"], message: "Conversation results use Web deep links rather than an MCP detail pointer." });
    }
    if (!result.conversation_id || !result.conversation_view) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["conversation_id"], message: "Conversation results require canonical conversation deep-link metadata." });
    }
    return;
  }
  if (result.conversation_id !== null || result.conversation_view !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["conversation_id"], message: "Non-Conversation results cannot carry Conversation deep-link metadata." });
  }
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
    if ("id" in result.detail_arguments && !("scope" in result.detail_arguments)
      && result.detail_arguments.id.trim().length > 0
      && result.detail_arguments.id.length <= 256) return;
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["detail_arguments"], message: "Universe detail_arguments must contain only a canonical node id." });
    return;
  }

  if (result.entity_type === "todo") {
    if (result.detail_tool !== "read_todo_day" || !("date" in result.detail_arguments)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["detail_tool"], message: "Todo results must use read_todo_day with a date." });
    }
    return;
  }

  if (result.entity_type === "shared_paper") {
    if (result.detail_tool !== "get_shared_paper") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["detail_tool"], message: "Shared Paper results must use get_shared_paper." });
    }
    if ("id" in result.detail_arguments && !("scope" in result.detail_arguments)
      && z.string().uuid().safeParse(result.detail_arguments.id).success) return;
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["detail_arguments"], message: "Shared Paper detail_arguments must contain only a UUID id." });
    return;
  }

  const expectedTool = ({ memory: "get_memory", diary: "get_diary", task: "get_task" } as const)[result.entity_type];
  if (result.detail_tool !== expectedTool) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["detail_tool"], message: "Detail tool must match the result module." });
  }
  if ("scope" in result.detail_arguments && z.string().uuid().safeParse(result.detail_arguments.id).success) return;
  context.addIssue({ code: z.ZodIssueCode.custom, path: ["detail_arguments"], message: "Memory, Diary, and Task detail_arguments require a UUID id and scope." });
});

const globalSearchDataSchema = z.object({
  results: z.array(globalSearchResultSchema),
  metadata: z.object({
    count: z.number().int().min(0).max(25),
    has_more: z.boolean(),
    next_cursor: z.string().max(MAX_CURSOR_ENCODED_LENGTH).nullable(),
    searched_modules: z.array(globalSearchModuleSchema).min(1).max(7),
    searched_scope: z.enum(["active", "archived", "all"]),
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
    description: "Use global_search only for cross-domain discovery when the target domain is unknown or genuinely spans LeileiOS domains. Defaults remain Memory, Diary, Task, Todo, Universe, and Shared Paper; Conversation Archive is supported but opt-in via modules=['conversation', ...] so its large message corpus does not change default six-domain search. When the domain is known, prefer that domain's dedicated browse/search tool. Conversation results are exact message discoveries with Web deep-link metadata and intentionally have no MCP detail pointer. Use scope=all only for explicit historical/all-record intent. No results means nothing was found: never invent an answer.",
    inputSchema,
    outputSchema: globalSearchOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => {
    try {
      const userId = dependencies.getAuthenticatedUserId();
      const data = await dependencies.globalSearchService.search({ userId, ...args });
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
  const lines = [`Found ${data.metadata.count} records.`];
  for (const result of data.results) {
    const pointer = result.detail_tool && result.detail_arguments
      ? formatMcpDetailPointer(result.detail_tool, Object.fromEntries(Object.entries(result.detail_arguments).map(([key, value]) => [key, String(value)])))
      : "no-detail-pointer";
    lines.push(`${result.entity_type} ${quoteMcpText(result.stable_name)} [id=${result.entity_id}; ${pointer}] — ${quoteMcpText(result.snippet)}`);
  }
  return joinMcpContentLines(lines);
}

export class GlobalSearchAuthenticationError extends Error {
  constructor() {
    super("Global search authentication is required.");
    this.name = "GlobalSearchAuthenticationError";
  }
}
