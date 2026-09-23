import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UNIVERSE_DOMAIN_BOUNDARY } from "../model-language.js";
import type { UniverseService } from "../../../domains/universe/universe-service.js";
import { invokeMcpWrite } from "../write-context.js";
import { safeUniverseWriteError, universeWriteErrorDetailsSchema } from "../universe/shared.js";
import { joinMcpContentLines } from "../content-contract.js";
import { mcpMutationReceipt, mcpMutationReceiptFields } from "../mutation-contract.js";
import { universeExpectedVersionSchema } from "../idempotency-contract.js";

const inputSchema = z.object({
  node_id: z.string().trim().min(1).max(256),
  diary_id: z.string().uuid(),
  expected_version: universeExpectedVersionSchema,
}).strict();

const outputSchema = z.object({
  success: z.boolean(),
  data: z.object({ node_id: z.string().min(1).max(256), diary_id: z.string().uuid(), universe_version: z.number().int().nonnegative(), ...mcpMutationReceiptFields }).strict().optional(),
  error: universeWriteErrorDetailsSchema.optional(),
}).strict();

export type AddUniverseDiarySourceToolDependencies = {
  sourceService: Pick<UniverseService, "addUniverseDiarySource">;
  getAuthenticatedUserId: () => string;
};

export function registerAddUniverseDiarySourceTool(server: McpServer, dependencies: AddUniverseDiarySourceToolDependencies): void {
  server.registerTool("add_universe_diary_source", {
    title: "Add a Universe Diary source",
    description: "expected_version is the global Universe snapshot version, not an entity revision. " + UNIVERSE_DOMAIN_BOUNDARY + " Attach one active/archived Diary as node provenance. Non-idempotent; on uncertain outcome, fresh-read sources and Universe version before retrying.",
    inputSchema,
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ node_id, diary_id, expected_version }) => invokeMcpWrite({
    toolName: "add_universe_diary_source",
    getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
    operation: async ({ userId }) => {
      const result = await dependencies.sourceService.addUniverseDiarySource(userId, node_id, diary_id, expected_version);
      return {
        content: [{ type: "text", text: joinMcpContentLines([
          `Universe Diary source added: node=${node_id}; diary=${diary_id}; version=${result.version}`,
        ]) }],
        structuredContent: {
          success: true as const,
          data: {
            node_id,
            diary_id,
            universe_version: result.version,
            ...mcpMutationReceipt({
              outcome: "applied",
              entity_type: "universe_diary_source",
              entity_id: `${node_id}:${diary_id}`,
              revision: null,
              detail_tool: "get_universe_diary_sources",
              detail_arguments: { node_id },
            }),
          },
        },
      };
    },
    mapError: (error) => safeUniverseWriteError(error, "Universe Diary source was not added."),
  }));
}
