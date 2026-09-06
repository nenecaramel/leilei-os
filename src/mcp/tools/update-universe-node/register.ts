import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UniverseServiceError, type UniverseService } from "../../../domains/universe/universe-service.js";
import { invokeMcpWrite } from "../write-context.js";
import { safeUniverseWriteError, universeWriteErrorDetailsSchema } from "../universe/shared.js";
import { updateUniverseNodeInputSchema } from "./schema.js";
import { joinMcpContentLines, quoteMcpText } from "../content-contract.js";

const successDataSchema = z.object({ node: z.object({ id: z.string().min(1).max(256), title: z.string(), type: z.string(), createdAt: z.string().datetime(), updatedAt: z.string().datetime() }).strict(), universe_version: z.number().int().nonnegative(), detail_tool: z.literal("get_universe_node"), detail_arguments: z.object({ id: z.string().min(1).max(256) }).strict() }).strict();
const outputSchema = z.object({
  success: z.boolean(),
  data: successDataSchema.optional(),
  error: universeWriteErrorDetailsSchema.optional(),
}).strict();

export type UpdateUniverseNodeToolDependencies = {
  universeService: Pick<UniverseService, "updateMcpNode">;
  getAuthenticatedUserId: () => string;
};

export function registerUpdateUniverseNodeTool(server: McpServer, dependencies: UpdateUniverseNodeToolDependencies): void {
  server.registerTool("update_universe_node", {
    title: "Update a Universe node",
    description: "Apply a partial update to one Universe node using expected_version. Omitted fields remain unchanged. A stale version is a conflict; fresh-read authoritative state before deciding whether a new mutation is needed, and never blindly retry.",
    inputSchema: updateUniverseNodeInputSchema,
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ id, expected_version, title, summary, content, type, tags, galaxies, position }) =>
    invokeMcpWrite({
      toolName: "update_universe_node",
      getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
      operation: async ({ userId }) => {
        const patch = {
          ...(title === undefined ? {} : { title }),
          ...(summary === undefined ? {} : { summary }),
          ...(content === undefined ? {} : { content }),
          ...(type === undefined ? {} : { type }),
          ...(tags === undefined ? {} : { tags }),
          ...(galaxies === undefined ? {} : { galaxies }),
          ...(position === undefined ? {} : { position }),
        };
        if (Object.keys(patch).length === 0) {
          throw new UniverseServiceError("INVALID_UNIVERSE");
        }
        const result = await dependencies.universeService.updateMcpNode(
          userId,
          id,
          patch,
          expected_version,
        );
        const node = result.snapshot.nodes.find((candidate) => candidate.id === id);
        if (!node) throw new Error("Updated Universe node was not returned.");
        const compactNode = {
          id: node.id,
          title: node.title,
          type: node.type,
          createdAt: node.createdAt,
          updatedAt: node.updatedAt,
        };
        return {
          content: [{ type: "text", text: joinMcpContentLines([
            `Universe node updated: ${quoteMcpText(compactNode.title)} [id=${compactNode.id}; version=${result.version}]`,
            `get_universe_node(id=${compactNode.id})`,
          ]) }],
          structuredContent: {
            success: true as const,
            data: {
              node: compactNode,
              universe_version: result.version,
              detail_tool: "get_universe_node" as const,
              detail_arguments: { id: compactNode.id },
            },
          },
        };
      },
      mapError: (error) => safeUniverseWriteError(error, "Universe node was not updated."),
    }),
  );
}
