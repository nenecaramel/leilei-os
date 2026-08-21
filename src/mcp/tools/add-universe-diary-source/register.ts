import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { UniverseService } from "../../../domains/universe/universe-service.js";
import { invokeMcpWrite } from "../write-context.js";
import { safeUniverseWriteError, universeWriteErrorDetailsSchema } from "../universe/shared.js";

const inputSchema = z.object({
  node_id: z.string().trim().min(1).max(256),
  diary_id: z.string().uuid(),
  expected_version: z.number().int().nonnegative(),
}).strict();

const outputSchema = z.object({
  success: z.literal(true),
  data: z.object({ node_id: z.string().min(1).max(256), diary_id: z.string().uuid(), universe_version: z.number().int().nonnegative() }).strict(),
  error: universeWriteErrorDetailsSchema.optional(),
}).strict();

export type AddUniverseDiarySourceToolDependencies = {
  sourceService: Pick<UniverseService, "addUniverseDiarySource">;
  getAuthenticatedUserId: () => string;
};

export function registerAddUniverseDiarySourceTool(server: McpServer, dependencies: AddUniverseDiarySourceToolDependencies): void {
  server.registerTool("add_universe_diary_source", {
    title: "Add a Universe Diary source",
    description: "Attach one active or archived Diary to an authenticated Universe node. This is a non-idempotent provenance mutation. If the transport outcome is uncertain, fresh-read the node's sources and Universe version before deciding whether another mutation is needed; never blindly retry.",
    inputSchema,
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ node_id, diary_id, expected_version }) => invokeMcpWrite({
    toolName: "add_universe_diary_source",
    getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
    operation: async ({ userId }) => {
      const result = await dependencies.sourceService.addUniverseDiarySource(userId, node_id, diary_id, expected_version);
      return {
        content: [{ type: "text", text: "Universe Diary source added." }],
        structuredContent: { success: true as const, data: { node_id, diary_id, universe_version: result.version } },
      };
    },
    mapError: (error) => safeUniverseWriteError(error, "Universe Diary source was not added."),
  }));
}
