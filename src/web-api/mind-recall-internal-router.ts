import { Router } from "express";
import { z } from "zod";
import type { ClaudeCodeMindRecallService } from "../domains/runtime/mind/claude-code-mind-recall.js";

const candidate = z.object({stateId: z.string().uuid(), kind: z.literal("memory"), text: z.string().max(2000)}).strict();
const inputSchema = z.object({
  session_id: z.string().min(1).max(256),
  query: z.string().trim().min(1).max(16000),
  exclude_ids: z.array(z.string().uuid()).max(20000),
  caller: z.literal("claude_code"),
  semantic_candidates: z.array(candidate).max(256).optional(),
  semantic_scores: z.record(z.string().uuid(), z.number().min(0).max(1)).optional(),
}).strict();

export function createMindRecallRouter(dependencies: {
  service: Pick<ClaudeCodeMindRecallService, "recall">;
  requireActiveUser: (userId: string) => Promise<unknown>;
}) {
  const router = Router();
  router.post("/recall", async (request, response) => {
    if (!request.mcpUserId) { response.status(401).json({success: false}); return; }
    const input = inputSchema.safeParse(request.body);
    if (!input.success) { response.status(400).json({success: false, error: {code: "INVALID_REQUEST"}}); return; }
    try {
      await dependencies.requireActiveUser(request.mcpUserId);
      const data = await dependencies.service.recall({
        userId: request.mcpUserId, sessionId: input.data.session_id,
        query: input.data.query, excludeIds: input.data.exclude_ids,
        semanticCandidates: input.data.semantic_candidates,
        semanticScores: input.data.semantic_scores ? new Map(Object.entries(input.data.semantic_scores)) : undefined,
      });
      response.setHeader("Cache-Control", "no-store");
      response.json({success: true, data});
    } catch {
      // Never log user prompts, candidates, credentials or raw provider errors.
      response.status(503).json({success: false, error: {code: "MIND_RECALL_UNAVAILABLE"}});
    }
  });
  return router;
}
