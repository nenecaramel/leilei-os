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
  z.object({ action: z.literal("reply"), discussion_id: notionIdSchema, body: notionBodySchema }).strict(),
  z.object({ action: z.literal("update"), comment_id: notionIdSchema, body: notionBodySchema }).strict(),
]);

export type WriteNotionCommentToolDependencies = {
  notionService: {
    createComment(body: NotionJsonObject): Promise<NotionJsonObject>;
    updateComment(commentId: string, body: NotionJsonObject): Promise<NotionJsonObject>;
  };
  getAuthenticatedUserId: () => string;
};

export function registerWriteNotionCommentTool(
  server: McpServer,
  dependencies: WriteNotionCommentToolDependencies,
): void {
  server.registerTool("write_notion_comment", {
    title: "Write Notion comment",
    description: "Create a page/block comment, reply to an existing discussion, or update a comment created by this Notion connection where Notion permits it.",
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
          data = await dependencies.notionService.createComment(args.body);
          break;
        case "reply":
          data = await dependencies.notionService.createComment({
            ...args.body,
            discussion_id: args.discussion_id,
          });
          break;
        case "update":
          data = await dependencies.notionService.updateComment(args.comment_id, args.body);
          break;
      }
      return notionSuccess(data, `Notion comment ${args.action} completed.`);
    } catch (error) {
      if (error instanceof NotionWriteAuthenticationError) return notionAuthErrorResult();
      return notionErrorResult(error);
    }
  });
}
