import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { SharedPaperServiceError } from "../domains/shared-paper/shared-paper-service.js";
import type { ContentAuthor } from "../domains/content-author.js";

export type SharedPaperApiService = {
  listPapers(input: { userId: string; limit?: number; scope?: "active" | "archived" }): Promise<unknown>;
  searchPapers(input: { userId: string; query: unknown; limit?: number; scope?: "active" | "archived" }): Promise<unknown>;
  getPaper(input: { userId: string; paperId: string }): Promise<unknown>;
  listEdits(input: { userId: string; paperId: string; limit?: number; beforeRevision?: number }): Promise<unknown>;
  createPaper(input: { userId: string; title: string; content: string; author: ContentAuthor }): Promise<unknown>;
  editPaper(input: { userId: string; paperId: string; expectedRevision: number; author: ContentAuthor; target?: "content" | "title"; start: number; end: number; replacement: string }): Promise<unknown>;
  archivePaper(input: { userId: string; paperId: string }): Promise<unknown>;
  restorePaper(input: { userId: string; paperId: string }): Promise<unknown>;
  deletePaper(input: { userId: string; paperId: string }): Promise<unknown>;
};
export type SharedPaperApiDependencies = { sharedPaperService: SharedPaperApiService };

const authorSchema = z.enum(["L", "G", "C"]);
const createBodySchema = z.object({ title: z.string(), content: z.string(), author: authorSchema }).strict();
const editBodySchema = z.object({ expected_revision: z.number().int(), author: authorSchema, target: z.enum(["content", "title"]).default("content").optional(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), replacement: z.string() }).strict();

export function createSharedPaperApiRouter({ sharedPaperService }: SharedPaperApiDependencies): Router {
  const router = Router();
  router.get("/search", handler(async (req) => sharedPaperService.searchPapers({ userId: req.webUserId!, query: req.query.query, limit: parseLimit(req.query.limit), scope: parseScope(req.query.scope) })));
  router.get("/", handler(async (req) => sharedPaperService.listPapers({ userId: req.webUserId!, limit: parseLimit(req.query.limit), scope: parseScope(req.query.scope) })));
  router.get("/:id/edits", handler(async (req) => sharedPaperService.listEdits({ userId: req.webUserId!, paperId: param(req.params.id), limit: parseLimit(req.query.limit), beforeRevision: parseBeforeRevision(req.query.before_revision) })));
  router.post("/:id/archive", handler(async (req) => sharedPaperService.archivePaper({ userId: req.webUserId!, paperId: param(req.params.id) })));
  router.post("/:id/restore", handler(async (req) => sharedPaperService.restorePaper({ userId: req.webUserId!, paperId: param(req.params.id) })));
  router.delete("/:id/permanent", handler(async (req) => sharedPaperService.deletePaper({ userId: req.webUserId!, paperId: param(req.params.id) })));
  router.get("/:id", handler(async (req) => sharedPaperService.getPaper({ userId: req.webUserId!, paperId: param(req.params.id) })));
  router.post("/", handler(async (req) => {
    const parsed = createBodySchema.safeParse(req.body);
    if (!parsed.success) throw new SharedPaperServiceError("INVALID_SHARED_PAPER", "Shared paper request is invalid.");
    return sharedPaperService.createPaper({ userId: req.webUserId!, ...parsed.data, author: parsed.data.author as ContentAuthor });
  }));
  router.patch("/:id/content", handler(async (req) => {
    const parsed = editBodySchema.safeParse(req.body);
    if (!parsed.success) throw new SharedPaperServiceError("INVALID_SHARED_PAPER_EDIT", "Shared paper request is invalid.");
    return sharedPaperService.editPaper({ userId: req.webUserId!, paperId: param(req.params.id), expectedRevision: parsed.data.expected_revision, author: parsed.data.author as ContentAuthor, target: parsed.data.target ?? "content", start: parsed.data.start, end: parsed.data.end, replacement: parsed.data.replacement });
  }));
  return router;
}

function handler(run: (request: ExpressRequest) => Promise<unknown>): RequestHandler {
  return async (request, response) => {
    if (!request.webUserId) { response.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Web API authentication is required." } }); return; }
    try { response.json({ success: true, data: await run(request as ExpressRequest) }); } catch (error) { mapError(response, error); }
  };
}
type ExpressRequest = { webUserId?: string; query: Record<string, unknown>; params: Record<string, string | string[] | undefined>; body?: Record<string, unknown> };
function param(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
function parseLimit(value: unknown): number | undefined { if (value === undefined) return undefined; const parsed = Number(Array.isArray(value) ? value[0] : value); return Number.isFinite(parsed) ? parsed : undefined; }
function parseBeforeRevision(value: unknown): number | undefined { if (value === undefined) return undefined; const parsed = Number(Array.isArray(value) ? value[0] : value); return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined; }
function parseScope(value: unknown): "active" | "archived" {
  if (value === undefined) return "active";
  if (value === "active" || value === "archived") return value;
  throw new SharedPaperServiceError("INVALID_SHARED_PAPER", "Shared paper scope is invalid.");
}

function mapError(response: Response, error: unknown): void {
  if (error instanceof SharedPaperServiceError) {
    if (error.code === "PAPER_NOT_FOUND") { response.status(404).json({ success: false, error: { code: error.code, message: "Shared paper was not found." } }); return; }
    if (error.code === "PAPER_REVISION_CONFLICT") { response.status(409).json({ success: false, error: { code: error.code, message: "Shared paper revision conflict." } }); return; }
    if (error.code === "PAPER_NOT_ARCHIVED") { response.status(409).json({ success: false, error: { code: error.code, message: "Shared paper must be archived before permanent deletion." } }); return; }
    if (error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND") { response.status(403).json({ success: false, error: { code: "SHARED_PAPER_UNAVAILABLE", message: "Shared paper is unavailable for the authenticated user." } }); return; }
    response.status(400).json({ success: false, error: { code: error.code, message: "Shared paper request is invalid." } }); return;
  }
  response.status(503).json({ success: false, error: { code: "SHARED_PAPER_UNAVAILABLE", message: "Shared paper is temporarily unavailable." } });
}
