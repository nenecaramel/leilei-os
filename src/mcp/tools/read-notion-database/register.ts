import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NotionDatabaseResult, NotionIntegration } from "../../../domains/notion/notion-read-integration.js";
import { readOnlyNotionAnnotations, safeNotionAdvancedError } from "../notion-advanced/shared.js";

const idSchema = z.string().trim().refine((value) => /^[0-9a-f]{32}$/i.test(value.replaceAll("-", "")), "Notion IDs must be UUIDs.");
const outputSchema = z.object({
  success: z.literal(true),
  data: z.object({
    id: z.string(),
    url: z.string().nullable(),
    title: z.string(),
    created_time: z.string().nullable(),
    last_edited_time: z.string().nullable(),
    data_sources: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
    schema: z.array(z.object({ id: z.string().nullable(), name: z.string(), type: z.string() }).strict()),
  }).strict(),
}).strict();

export type ReadNotionDatabaseToolDependencies = {
  notionIntegration: Pick<NotionIntegration, "readDatabase">;
  getAuthenticatedUserId: () => string;
};

export function registerReadNotionDatabaseTool(server: McpServer, dependencies: ReadNotionDatabaseToolDependencies): void {
  server.registerTool("read_notion_database", {
    title: "Read a Notion database",
    description: "Read one accessible Notion database's identity, data-source references, and available schema metadata.",
    inputSchema: z.object({ database_id: idSchema }).strict(),
    outputSchema,
    annotations: readOnlyNotionAnnotations,
  }, async ({ database_id }) => {
    try {
      dependencies.getAuthenticatedUserId();
      const data: NotionDatabaseResult = await dependencies.notionIntegration.readDatabase(database_id);
      return { content: [{ type: "text" as const, text: "Notion database retrieved." }], structuredContent: { success: true as const, data } };
    } catch (error) {
      return safeNotionAdvancedError(error);
    }
  });
}
