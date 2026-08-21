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
  success: z.boolean(),
  data: z.object({ node_id: z.string().min(1).max(256), diary_id: z.string().uuid(), universe_version: z.number().int().nonnegative() }).strict().optional(),
  error: universeWriteErrorDetailsSchema.optional(),
}).strict();

export type DeleteUniverseDiarySourceToolDependencies = {
  sourceService: Pick<UniverseService, "deleteUniverseDiarySource">;
  getAuthenticatedUserId: () => string;
};

export function registerDeleteUniverseDiarySourceTool(server: McpServer, dependencies: DeleteUniverseDiarySourceToolDependencies): void {
  server.registerTool("delete_universe_diary_source", {
    title: "Delete a Universe Diary source",
    description: "Remove exactly one Diary provenance binding from an authenticated Universe node; the Diary itself is never deleted. This is a destructive, non-idempotent mutation. If the transport outcome is uncertain, fresh-read the node's sources and Universe version before deciding whether another mutation is needed; never blindly retry.",
    inputSchema,
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ node_id, diary_id, expected_version }) => invokeMcpWrite({
    toolName: "delete_universe_diary_source",
    getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
    operation: async ({ userId }) => {
      const result = await dependencies.sourceService.deleteUniverseDiarySource(userId, node_id, diary_id, expected_version);
      return {
        content: [{ type: "text", text: "Universe Diary source deleted." }],
        structuredContent: { success: true as const, data: { node_id, diary_id, universe_version: result.version } },
      };
    },
    mapError: (error) => safeUniverseWriteError(error, "Universe Diary source was not found."),
  }));
}
