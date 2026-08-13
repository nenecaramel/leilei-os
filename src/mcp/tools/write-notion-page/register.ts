import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NotionJsonObject } from "../../../domains/notion/notion-transport.js";
import {
  notionAuthErrorResult,
  notionBodySchema,
  notionErrorResult,
  notionIdSchema,
  notionOutputSchema,
  notionSuccess,
  NotionWriteAuthenticationError,
} from "../notion-write-shared.js";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), body: notionBodySchema }).strict(),
  z.object({ action: z.literal("update"), page_id: notionIdSchema, body: notionBodySchema }).strict(),
  z.object({ action: z.literal("move"), page_id: notionIdSchema, parent: notionBodySchema }).strict(),
  z.object({ action: z.literal("update_content"), page_id: notionIdSchema, body: notionBodySchema }).strict(),
  z.object({ action: z.literal("trash"), page_id: notionIdSchema }).strict(),
  z.object({ action: z.literal("restore"), page_id: notionIdSchema }).strict(),
]);

export type WriteNotionPageToolDependencies = {
  notionService: {
    createPage(body: NotionJsonObject): Promise<NotionJsonObject>;
    updatePage(pageId: string, body: NotionJsonObject): Promise<NotionJsonObject>;
    movePage(pageId: string, parent: NotionJsonObject): Promise<NotionJsonObject>;
    updatePageMarkdown(pageId: string, body: NotionJsonObject): Promise<NotionJsonObject>;
  };
  getAuthenticatedUserId: () => string;
};

export function registerWriteNotionPageTool(
  server: McpServer,
  dependencies: WriteNotionPageToolDependencies,
): void {
  server.registerTool("write_notion_page", {
    title: "Write Notion page",
    description: "Create, update, move, change enhanced-Markdown content, trash, or restore a Notion page. Mutations execute immediately when Notion permits them.",
    inputSchema,
    outputSchema: notionOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async (args) => {
    try {
      dependencies.getAuthenticatedUserId();
      let data: NotionJsonObject;
      switch (args.action) {
        case "create":
          data = await dependencies.notionService.createPage(args.body);
          break;
        case "update":
          data = await dependencies.notionService.updatePage(args.page_id, args.body);
          break;
        case "move":
          data = await dependencies.notionService.movePage(args.page_id, args.parent);
          break;
        case "update_content":
          data = await dependencies.notionService.updatePageMarkdown(args.page_id, args.body);
          break;
        case "trash":
          data = await dependencies.notionService.updatePage(args.page_id, { in_trash: true });
          break;
        case "restore":
          data = await dependencies.notionService.updatePage(args.page_id, { in_trash: false });
          break;
      }
      return notionSuccess(data, `Notion page ${args.action} completed.`);
    } catch (error) {
      if (error instanceof NotionWriteAuthenticationError) return notionAuthErrorResult();
      return notionErrorResult(error);
    }
  });
}
