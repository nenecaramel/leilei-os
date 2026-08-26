import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NotionConnectionResult, NotionIntegration } from "../../../domains/notion/notion-read-integration.js";
import { NotionAdvancedAuthenticationError, authorizeNotionUser, readOnlyNotionAnnotations, safeNotionAdvancedError, type NotionUserAuthorizationDependencies } from "../notion-advanced/shared.js";
import { mcpToolErrorDetailsSchema } from "../error-contract.js";

const outputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    provider: z.literal("notion"),
    connection: z.object({ id: z.string().min(1), name: z.string(), type: z.enum(["bot", "person", "unknown"]) }).strict(),
    workspace: z.object({ id: z.string().nullable(), name: z.string().nullable() }).strict(),
    capabilities: z.array(z.object({
      operation: z.enum(["page.read", "database.read", "data_source.read", "data_source.query"]),
      status: z.literal("unverified"),
    }).strict()),
  }).strict().optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export type GetNotionConnectionToolDependencies = NotionUserAuthorizationDependencies & {
  notionIntegration: Pick<NotionIntegration, "getConnection">;
};

export function registerGetNotionConnectionTool(server: McpServer, dependencies: GetNotionConnectionToolDependencies): void {
  server.registerTool("get_notion_connection", {
    title: "Get Notion connection capabilities",
    description: "Read the authenticated server-side Notion connection identity and available read capabilities without exposing credentials.",
    inputSchema: z.object({}).strict(),
    outputSchema,
    annotations: readOnlyNotionAnnotations,
  }, async () => {
    try {
      await authorizeNotionUser(dependencies);
      const data: NotionConnectionResult = await dependencies.notionIntegration.getConnection();
      return { content: [{ type: "text" as const, text: "Notion connection discovered." }], structuredContent: { success: true as const, data } };
    } catch (error) {
      return safeNotionAdvancedError(error);
    }
  });
}

export { NotionAdvancedAuthenticationError };
