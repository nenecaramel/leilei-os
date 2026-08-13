import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  NotionReadError,
  type NotionPageReadResult,
} from "../../../domains/notion/notion-read-client.js";

const inputSchema = z.object({
  page_id: z.string().trim().refine((value) => {
    const compact = value.replaceAll("-", "");
    return /^[0-9a-fA-F]{32}$/.test(compact);
  }, "page_id must be a Notion page UUID."),
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
    page: pageSchema,
    content: z.string().max(60_000),
    block_count: z.number().int().min(0).max(500),
    truncated: z.boolean(),
  }).strict(),
}).strict();

export type ReadNotionPageToolDependencies = {
  notionService: {
    readPage(pageId: string): Promise<NotionPageReadResult>;
  };
  getAuthenticatedUserId: () => string;
};

export function registerReadNotionPageTool(
  server: McpServer,
  dependencies: ReadNotionPageToolDependencies,
): void {
  server.registerTool("read_notion_page", {
    title: "Read a Notion page",
    description: "Read one accessible Notion page and its nested structural blocks. Child pages and child databases are listed but are not recursively expanded; call read_notion_page again with a child page ID when its content is needed.",
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
      dependencies.getAuthenticatedUserId();
      const data = await dependencies.notionService.readPage(args.page_id);
      return {
        content: [{
          type: "text" as const,
          text: `Read Notion page "${data.page.title}".`,
        }],
        structuredContent: { success: true as const, data },
      };
    } catch (error) {
      if (error instanceof ReadNotionPageAuthenticationError) {
        return {
          isError: true as const,
          content: [{
            type: "text" as const,
            text: "Authentication is required to read Notion.",
          }],
        };
      }

      return {
        isError: true as const,
        content: [{
          type: "text" as const,
          text: mapNotionReadError(error),
        }],
      };
    }
  });
}

function mapNotionReadError(error: unknown): string {
  if (!(error instanceof NotionReadError)) {
    return "Notion is temporarily unavailable.";
  }

  switch (error.code) {
    case "NOT_CONFIGURED":
      return "Notion is not configured.";
    case "ACCESS_DENIED":
      return "Notion access is unavailable.";
    case "NOT_FOUND":
      return "The Notion page was not found or is not accessible.";
    case "RATE_LIMITED":
      return "Notion is temporarily rate limited.";
    case "UPSTREAM":
      return "Notion is temporarily unavailable.";
  }
}

export class ReadNotionPageAuthenticationError extends Error {
  constructor() {
    super("Notion page read authentication is required.");
    this.name = "ReadNotionPageAuthenticationError";
  }
}
