import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NotionDataSourceResult, NotionIntegration } from "../../../domains/notion/notion-read-integration.js";
import { authorizeNotionUser, readOnlyNotionAnnotations, safeNotionAdvancedError, type NotionUserAuthorizationDependencies } from "../notion-advanced/shared.js";
import { mcpToolErrorDetailsSchema } from "../error-contract.js";
import { joinMcpContentLines, quoteMcpText } from "../content-contract.js";

const idSchema = z.string().trim().refine((value) => /^[0-9a-f]{32}$/i.test(value.replaceAll("-", "")), "Notion IDs must be UUIDs.");
const outputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    id: z.string(),
    url: z.string().nullable(),
    title: z.string(),
    created_time: z.string().nullable(),
    last_edited_time: z.string().nullable(),
    parent_database_id: z.string().nullable(),
    schema: z.array(z.object({ id: z.string().nullable(), name: z.string(), type: z.string() }).strict()),
  }).strict().optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export type ReadNotionDataSourceToolDependencies = NotionUserAuthorizationDependencies & {
  notionIntegration: Pick<NotionIntegration, "readDataSource">;
};

export function registerReadNotionDataSourceTool(server: McpServer, dependencies: ReadNotionDataSourceToolDependencies): void {
  server.registerTool("read_notion_data_source", {
    title: "Read a Notion data source",
    description: "Read a Notion data source's metadata and schema.",
    inputSchema: z.object({ data_source_id: idSchema }).strict(),
    outputSchema,
    annotations: readOnlyNotionAnnotations,
  }, async ({ data_source_id }) => {
    try {
      await authorizeNotionUser(dependencies);
      const data: NotionDataSourceResult = await dependencies.notionIntegration.readDataSource(data_source_id);
      return {
        content: [{
          type: "text" as const,
          text: joinMcpContentLines([
            `Notion data source ${quoteMcpText(data.title)} [id=${data.id}]`,
            `Schema: ${data.schema.map((property) => `${property.name} (${property.type})`).join(", ") || "empty"}`,
          ]),
        }],
        structuredContent: { success: true as const, data },
      };
    } catch (error) {
      return safeNotionAdvancedError(error);
    }
  });
}
