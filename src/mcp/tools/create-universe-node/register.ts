import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { UniverseService } from "../../../domains/universe/universe-service.js";
import { invokeMcpWrite } from "../write-context.js";
import { safeUniverseWriteError, universeWriteErrorDetailsSchema } from "../universe/shared.js";
import { createUniverseNodeInputSchema } from "./schema.js";

const nodeOutputSchema = z.object({
  id: z.string().min(1).max(256),
  title: z.string(),
  type: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

const successDataSchema = z.object({
    node: nodeOutputSchema,
    universe_version: z.number().int().nonnegative(),
    metadata: z.object({ created: z.boolean(), idempotent_replay: z.boolean() }).strict(),
    detail_tool: z.literal("get_universe_node"),
    detail_arguments: z.object({ id: z.string().min(1).max(256) }).strict(),
}).strict();
const outputSchema = z.object({
  success: z.boolean(),
  data: successDataSchema.optional(),
  error: universeWriteErrorDetailsSchema.optional(),
}).strict();

export type CreateUniverseNodeToolDependencies = {
  universeService: Pick<UniverseService, "createMcpNode">;
  getAuthenticatedUserId: () => string;
};

export function registerCreateUniverseNodeTool(
  server: McpServer,
  dependencies: CreateUniverseNodeToolDependencies,
): void {
  server.registerTool("create_universe_node", {
    title: "Create a Universe node",
    description: "Create one Universe node at an explicit 0..100 position. The server owns the node ID and timestamps. Every mutation requires expected_version and a unique idempotency_key. If the outcome is uncertain, fresh-read Universe state before deciding whether a new mutation is needed; never blindly retry.",
    inputSchema: createUniverseNodeInputSchema,
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ title, summary, content, type, tags, galaxies, position, expected_version, idempotency_key }) =>
    invokeMcpWrite({
      toolName: "create_universe_node",
      getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
      operation: async ({ userId }) => {
        const data = await dependencies.universeService.createMcpNode(
          userId,
          { title, summary, content, type, tags, galaxies, position },
          expected_version,
          idempotency_key,
        );
        const node = {
          id: data.node.id,
          title: data.node.title,
          type: data.node.type,
          createdAt: data.node.createdAt,
          updatedAt: data.node.updatedAt,
        };
        return {
          content: [{ type: "text", text: data.metadata.idempotent_replay ? "Universe node replayed." : "Universe node created." }],
          structuredContent: {
            success: true as const,
            data: {
              node,
              universe_version: data.universe_version,
              metadata: data.metadata,
              detail_tool: "get_universe_node" as const,
              detail_arguments: { id: node.id },
            },
          },
        };
      },
      mapError: (error) => safeUniverseWriteError(error, "Universe node was not created."),
    }),
  );
}
