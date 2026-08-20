import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UniverseServiceError, type UniverseService } from "../../../domains/universe/universe-service.js";
import { invokeMcpWrite } from "../write-context.js";
import { UniverseAuthenticationError, safeUniverseError } from "../universe/shared.js";
import { universeMembershipSchema, universePositionSchema } from "../create-universe-node/schema.js";
import { updateUniverseNodeInputSchema } from "./schema.js";

const nodeOutputSchema = z.object({
  id: z.string().min(1).max(256), title: z.string(), summary: z.string(), content: z.string(), type: z.string(),
  tags: z.array(z.string()), galaxies: z.array(universeMembershipSchema), position: universePositionSchema,
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), importance: z.string().optional(),
  migration: z.object({ source: z.enum(["mind-universe-static", "mind-universe"]), migratedAt: z.string().datetime() }).strict().optional(),
}).strict();
const outputSchema = z.object({
  success: z.literal(true),
  data: z.object({ node: nodeOutputSchema, universe_version: z.number().int().nonnegative() }).strict(),
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
        return {
          content: [{ type: "text", text: "Universe node updated." }],
          structuredContent: { success: true as const, data: { node, universe_version: result.version } },
        };
      },
      mapError: (error) => {
        if (error instanceof UniverseAuthenticationError) return safeUniverseError(error, "Universe node was not updated.");
        return safeUniverseError(error, "Universe node was not updated.");
      },
    }),
  );
}
