import { Router } from "express";
import { z } from "zod";
import type { ClaudeCodeMindRecallService } from "../domains/runtime/mind/claude-code-mind-recall.js";

const candidate = z.object({stateId: z.string().uuid(), kind: z.literal("memory"), text: z.string().max(2000)}).strict();
const inputSchema = z.object({
  session_id: z.string().min(1).max(256),
  query: z.string().trim().min(1).max(16000),
  candidate_query: z.string().trim().min(1).max(16000).optional(),
  exclude_ids: z.array(z.string().uuid()).max(20000),
  caller: z.literal("claude_code"),
  context_epoch: z.number().int().min(0).max(2147483647).optional().default(0),
  semantic_candidates: z.array(candidate).max(256).optional(),
  semantic_scores: z.record(z.string().uuid(), z.number().min(0).max(1)).optional(),
  receipt_mode: z.literal("signed_v1").optional(),
  semantic_snapshot_version: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  snapshot_scores: z.record(z.string().uuid(), z.number().min(0).max(1)).optional(),
}).strict();

export function createMindRecallRouter(dependencies: {
  service: Pick<ClaudeCodeMindRecallService, "recall"> & Partial<Pick<ClaudeCodeMindRecallService, "confirm" | "snapshot">>;
  requireActiveUser: (userId: string) => Promise<unknown>;
}) {
  const router = Router();
  router.get("/snapshot", async (request, response) => {
    response.setHeader("Cache-Control", "private, no-store");
    if (!request.mcpUserId) { response.status(401).json({success: false}); return; }
    const params = z.object({
      offset: z.coerce.number().int().min(0).max(30_000).optional().default(0),
    }).strict().safeParse(request.query);
    if (!params.success) { response.status(400).json({success: false}); return; }
    try {
      await dependencies.requireActiveUser(request.mcpUserId);
      if (!dependencies.service.snapshot) throw new Error("Unavailable");
      const data = await dependencies.service.snapshot({
        userId: request.mcpUserId, offset: params.data.offset,
      });
      response.json({success: true, data});
    } catch {
      response.status(503).json({success: false, error: {code: "MIND_SNAPSHOT_UNAVAILABLE"}});
    }
  });
  router.post("/recall", async (request, response) => {
    if (!request.mcpUserId) { response.status(401).json({success: false}); return; }
    const input = inputSchema.safeParse(request.body);
    if (!input.success) { response.status(400).json({success: false, error: {code: "INVALID_REQUEST"}}); return; }
    try {
      await dependencies.requireActiveUser(request.mcpUserId);
      const data = await dependencies.service.recall({
        userId: request.mcpUserId, sessionId: input.data.session_id,
        query: input.data.query, candidateQuery: input.data.candidate_query,
        excludeIds: input.data.exclude_ids, contextEpoch: input.data.context_epoch,
        semanticCandidates: input.data.semantic_candidates,
        semanticScores: input.data.semantic_scores ? new Map(Object.entries(input.data.semantic_scores)) : undefined,
        receiptMode: input.data.receipt_mode,
        semanticSnapshotVersion: input.data.semantic_snapshot_version,
        snapshotScores: input.data.snapshot_scores
          ? new Map(Object.entries(input.data.snapshot_scores)) : undefined,
      });
      response.setHeader("Cache-Control", "no-store");
      response.json({success: true, data});
    } catch {
      // Never log user prompts, candidates, credentials or raw provider errors.
      response.status(503).json({success: false, error: {code: "MIND_RECALL_UNAVAILABLE"}});
    }
  });
  router.post("/recall/confirm", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!request.mcpUserId) { response.status(401).json({success: false}); return; }
    const input = z.union([
      z.object({
        recall_id: z.string().uuid(),
        caller: z.literal("claude_code"),
        context_sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }).strict(),
      z.object({
        recall_id: z.string().uuid(),
        recall_token: z.string().min(80).max(4096),
        caller: z.literal("claude_code"),
        context_sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }).strict(),
    ]).safeParse(request.body);
    if (!input.success) { response.status(400).json({success: false, error: {code: "INVALID_REQUEST"}}); return; }
    try {
      await dependencies.requireActiveUser(request.mcpUserId);
      if (!dependencies.service.confirm) throw new Error("Unavailable");
      const data = await dependencies.service.confirm({
        userId: request.mcpUserId,
        recallId: input.data.recall_id,
        contextSha256: input.data.context_sha256,
        ...("recall_token" in input.data ? {recallToken: input.data.recall_token} : {}),
      });
      response.json({success: true, data: {recall_id: input.data.recall_id, ...data}});
    } catch {
      response.status(503).json({success: false, error: {code: "RECALL_CONFIRM_UNAVAILABLE"}});
    }
  });
  return router;
}