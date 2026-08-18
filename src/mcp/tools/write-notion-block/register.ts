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
  z.object({ action: z.literal("append_children"), block_id: notionIdSchema, body: notionBodySchema }).strict(),
  z.object({ action: z.literal("insert_children"), block_id: notionIdSchema, body: notionBodySchema }).strict(),
  z.object({ action: z.literal("update"), block_id: notionIdSchema, body: notionBodySchema }).strict(),
  z.object({ action: z.literal("delete"), block_id: notionIdSchema }).strict(),
  z.object({ action: z.literal("restore"), block_id: notionIdSchema }).strict(),
]);

export type WriteNotionBlockToolDependencies = {
  notionService: {
    appendBlockChildren(blockId: string, body: NotionJsonObject): Promise<NotionJsonObject>;
    updateBlock(blockId: string, body: NotionJsonObject): Promise<NotionJsonObject>;
    deleteBlock(blockId: string): Promise<NotionJsonObject>;
  };
  getAuthenticatedUserId: () => string;
};

export function registerWriteNotionBlockTool(
  server: McpServer,
  dependencies: WriteNotionBlockToolDependencies,
): void {
  server.registerTool("write_notion_block", {
    title: "Write Notion block",
    description: "Append or position child blocks, update a block, move it to trash, or restore it. For insertion use the Notion 2026-03-11 position object inside body.",
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
        case "append_children":
        case "insert_children":
          data = await dependencies.notionService.appendBlockChildren(args.block_id, args.body);
          break;
        case "update":
          data = await dependencies.notionService.updateBlock(args.block_id, args.body);
          break;
        case "delete":
          data = await dependencies.notionService.deleteBlock(args.block_id);
          break;
        case "restore":
          data = await dependencies.notionService.updateBlock(args.block_id, { in_trash: false });
          break;
      }
      return notionSuccess(data, `Notion block ${args.action} completed.`);
    } catch (error) {
      if (error instanceof NotionWriteAuthenticationError) return notionAuthErrorResult();
      return notionErrorResult(error);
    }
  });
}
