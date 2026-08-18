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
}).strict();

const outputSchema = z.object({
  success: z.literal(true),
  data: z.object({
    results: z.array(pageSchema).max(25),
    metadata: z.object({
      count: z.number().int().min(0).max(25),
      has_more: z.boolean(),
      next_cursor: z.string().max(2000).nullable(),
    }).strict(),
  }).strict(),
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
    description: "Search accessible Notion pages by title. This is title search, not full-text search across page bodies. Use read_notion_page with a returned page ID to read the page content.",
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
          text: `Found ${data.metadata.count} Notion pages.`,
        }],
        structuredContent: { success: true as const, data: structuredData },
      };
    } catch (error) {
      if (error instanceof SearchNotionAuthenticationError || isActiveUserAuthorizationError(error)) {
        return {
          isError: true as const,
          content: [{
            type: "text" as const,
            text: "Authentication is required to search Notion.",
          }],
        };
      }

      return {
        isError: true as const,
        content: [{
          type: "text" as const,
          text: mapNotionSearchError(error),
        }],
      };
    }
  });
}

function mapNotionSearchError(error: unknown): string {
  if (!(error instanceof NotionReadError)) {
    return "Notion is temporarily unavailable.";
  }

  switch (error.code) {
    case "NOT_CONFIGURED":
      return "Notion is not configured.";
    case "AUTHENTICATION_FAILED":
      return "Notion authentication failed.";
    case "ACCESS_DENIED":
      return "Notion access is unavailable.";
    case "RATE_LIMITED":
      return "Notion is temporarily rate limited.";
    case "MALFORMED_RESPONSE":
      return "Notion returned an unsupported response.";
    case "NOT_FOUND":
    case "UPSTREAM":
      return "Notion is temporarily unavailable.";
  }
}

export class SearchNotionAuthenticationError extends Error {
  constructor() {
    super("Notion search authentication is required.");
    this.name = "SearchNotionAuthenticationError";
  }
}
