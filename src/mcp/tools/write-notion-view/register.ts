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
  z.object({ action: z.literal("update"), view_id: notionIdSchema, body: notionBodySchema }).strict(),
]);

export type WriteNotionViewToolDependencies = {
  notionService: {
    createView(body: NotionJsonObject): Promise<NotionJsonObject>;
    updateView(viewId: string, body: NotionJsonObject): Promise<NotionJsonObject>;
  };
  getAuthenticatedUserId: () => string;
};

export function registerWriteNotionViewTool(
  server: McpServer,
  dependencies: WriteNotionViewToolDependencies,
): void {
  server.registerTool("write_notion_view", {
    title: "Write Notion view",
    description: "Create or update a Notion database view using the current API view types, filters, sorts, quick filters, and configuration fields.",
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
      const data = args.action === "create"
        ? await dependencies.notionService.createView(args.body)
        : await dependencies.notionService.updateView(args.view_id, args.body);
      return notionSuccess(data, `Notion view ${args.action} completed.`);
    } catch (error) {
      if (error instanceof NotionWriteAuthenticationError) return notionAuthErrorResult();
      return notionErrorResult(error);
    }
  });
}
