import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NotionDataSourceResult, NotionIntegration } from "../../../domains/notion/notion-read-integration.js";
import { readOnlyNotionAnnotations, safeNotionAdvancedError } from "../notion-advanced/shared.js";

const idSchema = z.string().trim().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const outputSchema = z.object({
  success: z.literal(true),
  data: z.object({
    id: z.string(),
    url: z.string().nullable(),
    title: z.string(),
    created_time: z.string().nullable(),
    last_edited_time: z.string().nullable(),
    parent_database_id: z.string().nullable(),
    schema: z.array(z.object({ id: z.string().nullable(), name: z.string(), type: z.string() }).strict()),
  }).strict(),
}).strict();

export type ReadNotionDataSourceToolDependencies = {
  notionIntegration: Pick<NotionIntegration, "readDataSource">;
  getAuthenticatedUserId: () => string;
};

export function registerReadNotionDataSourceTool(server: McpServer, dependencies: ReadNotionDataSourceToolDependencies): void {
  server.registerTool("read_notion_data_source", {
    title: "Read a Notion data source",
    description: "Read one accessible Notion data source identity and schema. Data sources are not databases and must be addressed by their own stable ID.",
    inputSchema: z.object({ data_source_id: idSchema }).strict(),
    outputSchema,
    annotations: readOnlyNotionAnnotations,
  }, async ({ data_source_id }) => {
    try {
      dependencies.getAuthenticatedUserId();
      const data: NotionDataSourceResult = await dependencies.notionIntegration.readDataSource(data_source_id);
      return { content: [{ type: "text" as const, text: "Notion data source retrieved." }], structuredContent: { success: true as const, data } };
    } catch (error) {
      return safeNotionAdvancedError(error);
    }
  });
}
