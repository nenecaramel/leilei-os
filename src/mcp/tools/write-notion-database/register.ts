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
  z.object({ action: z.literal("update"), database_id: notionIdSchema, body: notionBodySchema }).strict(),
]);

export type WriteNotionDatabaseToolDependencies = {
  notionService: {
    createDatabase(body: NotionJsonObject): Promise<NotionJsonObject>;
    updateDatabase(databaseId: string, body: NotionJsonObject): Promise<NotionJsonObject>;
  };
  getAuthenticatedUserId: () => string;
};

export function registerWriteNotionDatabaseTool(
  server: McpServer,
  dependencies: WriteNotionDatabaseToolDependencies,
): void {
  server.registerTool("write_notion_database", {
    title: "Write Notion database",
    description: "Create or update a Notion database container, including supported title, description, icon, cover, parent, and initial data source fields.",
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
        ? await dependencies.notionService.createDatabase(args.body)
        : await dependencies.notionService.updateDatabase(args.database_id, args.body);
      return notionSuccess(data, `Notion database ${args.action} completed.`);
    } catch (error) {
      if (error instanceof NotionWriteAuthenticationError) return notionAuthErrorResult();
      return notionErrorResult(error);
    }
  });
}
