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
  z.object({ action: z.literal("update"), data_source_id: notionIdSchema, body: notionBodySchema }).strict(),
  z.object({ action: z.literal("trash"), data_source_id: notionIdSchema }).strict(),
  z.object({ action: z.literal("restore"), data_source_id: notionIdSchema }).strict(),
]);

export type WriteNotionDataSourceToolDependencies = {
  notionService: {
    createDataSource(body: NotionJsonObject): Promise<NotionJsonObject>;
    updateDataSource(dataSourceId: string, body: NotionJsonObject): Promise<NotionJsonObject>;
  };
  getAuthenticatedUserId: () => string;
};

export function registerWriteNotionDataSourceTool(
  server: McpServer,
  dependencies: WriteNotionDataSourceToolDependencies,
): void {
  server.registerTool("write_notion_data_source", {
    title: "Write Notion data source",
    description: "Create, update, move, trash, or restore a Notion data source. Update payloads may add, change, or remove properties using Notion's native schema format.",
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
          data = await dependencies.notionService.createDataSource(args.body);
          break;
        case "update":
          data = await dependencies.notionService.updateDataSource(args.data_source_id, args.body);
          break;
        case "trash":
          data = await dependencies.notionService.updateDataSource(args.data_source_id, { in_trash: true });
          break;
        case "restore":
          data = await dependencies.notionService.updateDataSource(args.data_source_id, { in_trash: false });
          break;
      }
      return notionSuccess(data, `Notion data source ${args.action} completed.`);
    } catch (error) {
      if (error instanceof NotionWriteAuthenticationError) return notionAuthErrorResult();
      return notionErrorResult(error);
    }
  });
}
