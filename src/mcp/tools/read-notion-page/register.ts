import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  NotionReadError,
  type NotionPageReadResult,
} from "../../../domains/notion/notion-read-client.js";
import { parseNotionPageReference } from "../../../domains/notion/notion-read-integration.js";
import {
  authorizeNotionUser,
  isActiveUserAuthorizationError,
  type NotionUserAuthorizationDependencies,
} from "../../server/notion-authorization.js";
import { createMcpToolError, mcpToolErrorDetailsSchema } from "../error-contract.js";
import { joinMcpContentLines, quoteMcpText } from "../content-contract.js";
import {
  boundedReadInputSchemaFields,
  boundedReadMetadataSchema,
  McpBoundedReadCursorError,
  sliceMcpBoundedContent,
} from "../bounded-read.js";

const inputSchema = z.object({
  page_id: z.string().trim().optional(),
  page_url: z.string().trim().url().optional(),
  ...boundedReadInputSchemaFields,
}).strict();

const pageSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  last_edited_time: z.string().datetime(),
}).strict();

const outputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    page: pageSchema,
    content: z.string().max(60_000),
    block_count: z.number().int().min(0).max(500),
    truncated: z.boolean(),
    content_metadata: boundedReadMetadataSchema,
  }).strict().optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export type ReadNotionPageToolDependencies = NotionUserAuthorizationDependencies & {
  notionService: {
    readPage(pageId: string): Promise<NotionPageReadResult>;
  };
};

export function registerReadNotionPageTool(
  server: McpServer,
  dependencies: ReadNotionPageToolDependencies,
): void {
  server.registerTool("read_notion_page", {
    title: "Read a Notion page",
    description: "Read one selected accessible Notion page by exact page ID or URL using a bounded content window. max_chars defaults to 12000 Unicode code points. When content_metadata.truncated is true, continue with content_metadata.next_cursor and the same page reference. The existing top-level truncated flag still reports upstream traversal/text caps; child pages and databases are listed but not recursively expanded.",
    inputSchema,
    outputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (args) => {
    if (!args.page_id && !args.page_url) {
      return createMcpToolError(
        "INVALID_PAGE_REFERENCE",
        "Provide page_id or page_url.",
      );
    }
    if (args.page_id && args.page_url) {
      return createMcpToolError(
        "INVALID_PAGE_REFERENCE",
        "Provide only one page reference.",
      );
    }

    try {
      await authorizeNotionUser(dependencies);
      const pageId = parseNotionPageReference(args.page_id ?? args.page_url ?? "");
      const data = await dependencies.notionService.readPage(pageId);
      const window = sliceMcpBoundedContent({
        content: data.content,
        maxChars: args.max_chars,
        cursor: args.cursor,
        tool: "read_notion_page",
        context: {
          id: data.page.id,
          last_edited_time: data.page.last_edited_time,
        },
      });
      const structuredData = {
        page: {
          id: data.page.id,
          title: data.page.title,
          url: data.page.url,
          last_edited_time: data.page.last_edited_time,
        },
        content: window.content,
        block_count: data.block_count,
        truncated: data.truncated,
        content_metadata: window.metadata,
      };
      return {
        content: [{
          type: "text" as const,
          text: joinMcpContentLines([
            `Notion page ${quoteMcpText(data.page.title)} [id=${data.page.id}]`,
            window.content || "(empty)",
          ]),
        }],
        structuredContent: { success: true as const, data: structuredData },
      };
    } catch (error) {
      if (error instanceof McpBoundedReadCursorError) {
        return createMcpToolError(
          "INVALID_CURSOR",
          "The Notion page continuation cursor is invalid or stale. Read the page again without a cursor.",
        );
      }

      if (error instanceof ReadNotionPageAuthenticationError || isActiveUserAuthorizationError(error)) {
        return createMcpToolError(
          "AUTHENTICATION_REQUIRED",
          "Authentication is required to read Notion.",
        );
      }

      const mapped = mapNotionReadError(error);
      return createMcpToolError(mapped.code, mapped.message);
    }
  });
}

function mapNotionReadError(error: unknown): { code: string; message: string } {
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
    case "NOT_FOUND":
      return { code: error.code, message: "The Notion page was not found or is not accessible." };
    case "RATE_LIMITED":
      return { code: error.code, message: "Notion is temporarily rate limited." };
    case "MALFORMED_RESPONSE":
      return { code: error.code, message: "Notion returned an unsupported response." };
    case "UPSTREAM":
      return { code: error.code, message: "Notion is temporarily unavailable." };
  }
}

export class ReadNotionPageAuthenticationError extends Error {
  constructor() {
    super("Notion page read authentication is required.");
    this.name = "ReadNotionPageAuthenticationError";
  }
}
