import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NotionDataSourceQueryResult, NotionIntegration } from "../../../domains/notion/notion-read-integration.js";
import { authorizeNotionUser, readOnlyNotionAnnotations, safeNotionAdvancedError, type NotionUserAuthorizationDependencies } from "../notion-advanced/shared.js";
import { mcpToolErrorDetailsSchema } from "../error-contract.js";
import { joinMcpContentLines, quoteMcpText } from "../content-contract.js";

const idSchema = z.string().trim().refine((value) => /^[0-9a-f]{32}$/i.test(value.replaceAll("-", "")), "Notion IDs must be UUIDs.");
const jsonValueSchema: z.ZodTypeAny = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema).max(100),
  z.record(z.string().max(200), jsonValueSchema),
]));
const jsonObjectSchema = z.record(z.string().max(200), jsonValueSchema);
const outputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    data_source_id: z.string(),
    results: z.array(z.object({
      id: z.string(),
      url: z.string().nullable(),
      title: z.string(),
      created_time: z.string().nullable(),
      last_edited_time: z.string().nullable(),
      properties: z.record(z.object({ id: z.string().nullable(), type: z.string(), value: z.any() }).strict()),
    }).strict()),
    metadata: z.object({ count: z.number().int().min(0), has_more: z.boolean(), next_cursor: z.string().nullable() }).strict(),
  }).strict().optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export type QueryNotionDataSourceToolDependencies = NotionUserAuthorizationDependencies & {
  notionIntegration: Pick<NotionIntegration, "queryDataSource">;
};

export function registerQueryNotionDataSourceTool(server: McpServer, dependencies: QueryNotionDataSourceToolDependencies): void {
  server.registerTool("query_notion_data_source", {
    title: "Query a Notion data source",
    description: "Read pages from one Notion data source with bounded, structured filters, sorting, and cursor pagination. No SQL or arbitrary query text is accepted.",
    inputSchema: z.object({
      data_source_id: idSchema,
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().min(1).max(2000).optional(),
      filter: jsonObjectSchema.optional(),
      sorts: z.array(jsonObjectSchema).max(10).optional(),
    }).strict(),
    outputSchema,
    annotations: readOnlyNotionAnnotations,
  }, async ({ data_source_id, limit, cursor, filter, sorts }) => {
    try {
      await authorizeNotionUser(dependencies);
      const data: NotionDataSourceQueryResult = await dependencies.notionIntegration.queryDataSource({
        dataSourceId: data_source_id,
        limit,
        cursor,
        filter,
        sorts,
      });
      return {
        content: [{
          type: "text" as const,
          text: joinMcpContentLines([
            `Read ${data.metadata.count} Notion data source pages for ${data.data_source_id}.`,
            ...data.results.map((page) => `${quoteMcpText(page.title)} [id=${page.id}]${page.url ? ` ${page.url}` : ""}`),
            ...(data.results.length === 0 ? ["empty"] : []),
          ]),
        }],
        structuredContent: { success: true as const, data },
      };
    } catch (error) {
      return safeNotionAdvancedError(error);
    }
  });
}
