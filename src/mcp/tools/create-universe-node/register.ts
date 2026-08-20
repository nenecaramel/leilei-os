import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { UniverseService } from "../../../domains/universe/universe-service.js";
import { UniverseServiceError } from "../../../domains/universe/universe-service.js";
import { invokeMcpWrite } from "../write-context.js";
import { UniverseAuthenticationError, safeUniverseError } from "../universe/shared.js";
import { createUniverseNodeInputSchema, universeMembershipSchema, universePositionSchema } from "./schema.js";

const nodeOutputSchema = z.object({
  id: z.string().min(1).max(256),
  title: z.string(),
  summary: z.string(),
  content: z.string(),
  type: z.string(),
  tags: z.array(z.string()),
  galaxies: z.array(universeMembershipSchema),
  position: universePositionSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  importance: z.string().optional(),
  migration: z.object({
    source: z.enum(["mind-universe-static", "mind-universe"]),
    migratedAt: z.string().datetime(),
  }).strict().optional(),
}).strict();

const outputSchema = z.object({
  success: z.literal(true),
  data: z.object({
    node: nodeOutputSchema,
    universe_version: z.number().int().nonnegative(),
    metadata: z.object({ created: z.boolean(), idempotent_replay: z.boolean() }).strict(),
  }).strict(),
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
        return {
          content: [{ type: "text", text: data.metadata.idempotent_replay ? "Universe node replayed." : "Universe node created." }],
          structuredContent: { success: true as const, data },
        };
      },
      mapError: (error) => {
        if (error instanceof UniverseAuthenticationError) return safeUniverseError(error, "Universe node was not created.");
        if (error instanceof UniverseServiceError) return safeUniverseError(error, "Universe node was not created.");
        return safeUniverseError(error, "Universe node was not created.");
      },
    }),
  );
}
