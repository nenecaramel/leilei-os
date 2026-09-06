import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NotionDatabaseResult, NotionIntegration } from "../../../domains/notion/notion-read-integration.js";
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
    data_sources: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
    schema: z.array(z.object({ id: z.string().nullable(), name: z.string(), type: z.string() }).strict()),
  }).strict().optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export type ReadNotionDatabaseToolDependencies = NotionUserAuthorizationDependencies & {
  notionIntegration: Pick<NotionIntegration, "readDatabase">;
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
      await authorizeNotionUser(dependencies);
      const data: NotionDatabaseResult = await dependencies.notionIntegration.readDatabase(database_id);
      return {
        content: [{
          type: "text" as const,
          text: joinMcpContentLines([
            `Notion database ${quoteMcpText(data.title)} [id=${data.id}]`,
            `Data sources: ${data.data_sources.map((source) => `${source.name} (${source.id})`).join(", ") || "none"}`,
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
