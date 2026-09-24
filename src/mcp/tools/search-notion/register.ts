import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  NotionReadError,
  type NotionSearchInput,
  type NotionSearchResult,
} from "../../../domains/notion/notion-read-client.js";
import {
  authorizeNotionUser,
  isActiveUserAuthorizationError,
  type NotionUserAuthorizationDependencies,
} from "../../server/notion-authorization.js";
import { createMcpToolError, mcpToolErrorDetailsSchema } from "../error-contract.js";
import { formatMcpDetailPointer, joinMcpContentLines, quoteMcpText } from "../content-contract.js";

const inputSchema = z.object({
  query: z
    .string()
    .max(400)
    .refine((value) => {
      const normalized = value.normalize("NFC").trim();
      return normalized.length > 0 && [...normalized].length <= 200;
    }, "Query must contain 1 to 200 Unicode code points after NFC normalization and trimming."),
  limit: z.number().int().min(1).max(25).optional(),
  cursor: z.string().max(2000).optional(),
}).strict();

const pageSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  last_edited_time: z.string().datetime(),
  detail_tool: z.literal("read_notion_page"),
  detail_arguments: z.object({ page_id: z.string() }).strict(),
}).strict();

const outputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    results: z.array(pageSchema).max(25),
    metadata: z.object({
      count: z.number().int().min(0).max(25),
      has_more: z.boolean(),
      next_cursor: z.string().max(2000).nullable(),
    }).strict(),
  }).strict().optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export type SearchNotionToolDependencies = NotionUserAuthorizationDependencies & {
  notionService: {
    searchPages(input: NotionSearchInput): Promise<NotionSearchResult>;
  };
};

export function registerSearchNotionTool(
  server: McpServer,
  dependencies: SearchNotionToolDependencies,
): void {
  server.registerTool("search_notion", {
    title: "Search Notion pages",
    description: "Search accessible Notion pages by title; not body full-text search.",
    inputSchema,
    outputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (args) => {
    try {
      await authorizeNotionUser(dependencies);
      const data = await dependencies.notionService.searchPages(args);
      const structuredData = {
        results: data.results.map((page) => ({
          id: page.id,
          title: page.title,
          url: page.url,
          last_edited_time: page.last_edited_time,
          detail_tool: "read_notion_page" as const,
          detail_arguments: { page_id: page.id },
        })),
        metadata: {
          count: data.metadata.count,
          has_more: data.metadata.has_more,
          next_cursor: data.metadata.next_cursor,
        },
      };
      return {
        content: [{
          type: "text" as const,
          text: joinMcpContentLines([
            `Found ${data.metadata.count} Notion pages.`,
            ...structuredData.results.map((page) => `${quoteMcpText(page.title)} [id=${page.id}; ${formatMcpDetailPointer("read_notion_page", page.detail_arguments)}]`),
          ]),
        }],
        structuredContent: { success: true as const, data: structuredData },
      };
    } catch (error) {
      if (error instanceof SearchNotionAuthenticationError || isActiveUserAuthorizationError(error)) {
        return createMcpToolError(
          "AUTHENTICATION_REQUIRED",
          "Authentication is required to search Notion.",
        );
      }

      const mapped = mapNotionSearchError(error);
      return createMcpToolError(mapped.code, mapped.message);
    }
  });
}

function mapNotionSearchError(error: unknown): { code: string; message: string } {
  if (!(error instanceof NotionReadError)) {
    return { code: "INTERNAL_ERROR", message: "Notion is temporarily unavailable." };
  }

  switch (error.code) {
    case "NOT_CONFIGURED":
      return { code: error.code, message: "Notion is not configured." };
    case "AUTHENTICATION_FAILED":
      return { code: error.code, message: "Notion authentication failed." };
    case "ACCESS_DENIED":
      return { code: error.code, message: "Notion access is unavailable." };
    case "RATE_LIMITED":
      return { code: error.code, message: "Notion is temporarily rate limited." };
    case "MALFORMED_RESPONSE":
      return { code: error.code, message: "Notion returned an unsupported response." };
    case "NOT_FOUND":
    case "UPSTREAM":
      return { code: error.code, message: "Notion is temporarily unavailable." };
  }
}

export class SearchNotionAuthenticationError extends Error {
  constructor() {
    super("Notion search authentication is required.");
    this.name = "SearchNotionAuthenticationError";
  }
}
