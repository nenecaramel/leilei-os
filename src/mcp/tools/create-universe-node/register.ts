import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UNIVERSE_DOMAIN_BOUNDARY } from "../model-language.js";
import type { UniverseService } from "../../../domains/universe/universe-service.js";
import { invokeMcpWrite } from "../write-context.js";
import { safeUniverseWriteError, universeWriteErrorDetailsSchema } from "../universe/shared.js";
import { createUniverseNodeInputSchema } from "./schema.js";
import { joinMcpContentLines, quoteMcpText } from "../content-contract.js";
import { mcpMutationReceipt, mcpMutationReceiptFields, mcpMutationOutcomeFromReplay } from "../mutation-contract.js";

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
    ...mcpMutationReceiptFields,
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
    description: "expected_version is the global Universe snapshot version, not an entity revision. " + UNIVERSE_DOMAIN_BOUNDARY + " Create one node at an explicit 0..100 position; server owns ID/timestamps. If outcome is uncertain, fresh-read Universe state before retrying.",
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
          content: [{ type: "text", text: joinMcpContentLines([
            `${data.metadata.idempotent_replay ? "Universe node replayed" : "Universe node created"}: ${quoteMcpText(node.title)} [id=${node.id}; version=${data.universe_version}]`,
            `get_universe_node(id=${node.id})`,
          ]) }],
          structuredContent: {
            success: true as const,
            data: {
              node,
              universe_version: data.universe_version,
              ...mcpMutationReceipt({
                outcome: mcpMutationOutcomeFromReplay(
                  data.metadata.idempotent_replay,
                ),
                entity_type: "universe_node",
                entity_id: node.id,
                revision: null,
                detail_tool: "get_universe_node",
                detail_arguments: { id: node.id },
              }),
            },
          },
        };
      },
      mapError: (error) => safeUniverseWriteError(error, "Universe node was not created."),
    }),
  );
}
