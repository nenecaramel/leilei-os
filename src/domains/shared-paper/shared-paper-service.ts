import { isContentAuthor, type ContentAuthor } from "../content-author.js";
import { requireActiveUser, ActiveUserAuthorizationError } from "../require-active-user.js";
import { hashMcpWriteRequest, normalizeMcpIdempotencyKey } from "../mcp-write/mcp-write-idempotency.js";
import { codePointLength, codeUnitOffsetToCodePointOffset, replaceCodePointRange } from "../../shared/unicode.js";
import type {
  SharedPaperCreateInput,
  SharedPaperEdit,
  SharedPaperMatchEditInput,
  SharedPaperMutationResult,
  SharedPaperRangeEditInput,
  SharedPaperScope,
  SharedPaperRepository,
  SharedPaperRecord,
} from "./shared-paper-types.js";

export const MAX_SHARED_PAPER_CONTENT_CODE_POINTS = 100_000;

export type SharedPaperServiceErrorCode =
  | "USER_NOT_FOUND" | "USER_DISABLED" | "PAPER_NOT_FOUND" | "PAPER_REVISION_CONFLICT"
  | "PAPER_EDIT_TARGET_NOT_FOUND" | "PAPER_EDIT_TARGET_AMBIGUOUS" | "PAPER_NOT_ARCHIVED" | "INVALID_SHARED_PAPER"
  | "INVALID_SHARED_PAPER_EDIT" | "INVALID_IDEMPOTENCY_KEY" | "IDEMPOTENCY_CONFLICT";

export class SharedPaperServiceError extends Error {
  constructor(public readonly code: SharedPaperServiceErrorCode, message: string) {
    super(message);
    this.name = "SharedPaperServiceError";
  }
}

export class SharedPaperService {
  constructor(private readonly repository: SharedPaperRepository) {}

  async listPapers(input: { userId: string; limit?: number; scope?: SharedPaperScope }): Promise<SharedPaperRecord[]> {
    await this.requireActive(input.userId);
    return this.repository.listPapers({ userId: input.userId, limit: boundedLimit(input.limit), scope: normalizeScope(input.scope) });
  }

  async searchPapers(input: { userId: string; query: unknown; limit?: number; scope?: SharedPaperScope }): Promise<SharedPaperRecord[]> {
    await this.requireActive(input.userId);
    const query = normalizeQuery(input.query);
    return this.repository.searchPapers({ userId: input.userId, query, limit: boundedLimit(input.limit), scope: normalizeScope(input.scope) });
  }

  async getPaper(input: { userId: string; paperId: string }): Promise<SharedPaperRecord> {
    await this.requireActive(input.userId);
    const paper = await this.repository.getPaper(input);
    if (!paper) throw new SharedPaperServiceError("PAPER_NOT_FOUND", "Shared paper was not found.");
    return paper;
  }

  async listEdits(input: { userId: string; paperId: string; limit?: number; beforeRevision?: number }): Promise<SharedPaperEdit[]> {
    await this.requireActive(input.userId);
    if (input.beforeRevision !== undefined && (!Number.isInteger(input.beforeRevision) || input.beforeRevision < 1)) throw new SharedPaperServiceError("INVALID_SHARED_PAPER", "Shared paper history cursor is invalid.");
    return this.repository.listEdits({ ...input, limit: boundedLimit(input.limit) });
  }

  async createPaper(input: SharedPaperCreateInput): Promise<SharedPaperRecord> {
    await this.requireActive(input.userId);
    const normalized = normalizeCreate(input);
    return this.repository.createPaper(normalized);
  }

  async createPaperIdempotently(input: SharedPaperCreateInput & { idempotencyKey: string }): Promise<SharedPaperMutationResult> {
    await this.requireActive(input.userId);
    const normalized = normalizeCreate(input);
    const idempotencyKey = normalizeKey(input.idempotencyKey);
    if (!this.repository.createPaperIdempotently) throw new Error("Shared paper idempotency persistence is unavailable.");
    const result = await this.repository.createPaperIdempotently({
      ...normalized,
      idempotencyKey,
      requestHash: hashMcpWriteRequest({
        title: normalized.title,
        content: normalized.content,
        author: normalized.author,
      }),
    });
    if (result.outcome === "idempotency_conflict") throw new SharedPaperServiceError("IDEMPOTENCY_CONFLICT", "The idempotency key was already used for different shared paper content.");
    return result;
  }

  async archivePaper(input: { userId: string; paperId: string }): Promise<SharedPaperRecord> {
    await this.requireActive(input.userId);
    const result = await this.repository.archivePaper(input);
    if (result.outcome === "not_found") throw new SharedPaperServiceError("PAPER_NOT_FOUND", "Shared paper was not found.");
    return result.paper;
  }

  async restorePaper(input: { userId: string; paperId: string }): Promise<SharedPaperRecord> {
    await this.requireActive(input.userId);
    const result = await this.repository.restorePaper(input);
    if (result.outcome === "not_found") throw new SharedPaperServiceError("PAPER_NOT_FOUND", "Shared paper was not found.");
    return result.paper;
  }

  async deletePaper(input: { userId: string; paperId: string }): Promise<{ paperId: string }> {
    await this.requireActive(input.userId);
    const result = await this.repository.deletePaper(input);
    if (result.outcome === "not_found") throw new SharedPaperServiceError("PAPER_NOT_FOUND", "Shared paper was not found.");
    if (result.outcome === "not_archived") throw new SharedPaperServiceError("PAPER_NOT_ARCHIVED", "Shared paper must be archived before permanent deletion.");
    return { paperId: input.paperId };
  }

  async archivePaperIdempotently(input: { userId: string; paperId: string; idempotencyKey: string }): Promise<{ paper: SharedPaperRecord; outcome: "committed" | "replayed" }> {
    await this.requireActive(input.userId);
    const idempotencyKey = normalizeKey(input.idempotencyKey);
    if (!this.repository.archivePaperIdempotently) throw new Error("Shared paper lifecycle idempotency persistence is unavailable.");
    const result = await this.repository.archivePaperIdempotently({
      userId: input.userId,
      paperId: input.paperId,
      idempotencyKey,
      requestHash: hashMcpWriteRequest({ paperId: input.paperId }),
    });
    if (result.outcome === "idempotency_conflict") throw new SharedPaperServiceError("IDEMPOTENCY_CONFLICT", "The idempotency key was already used for a different shared paper archive request.");
    if (result.outcome === "not_found") throw new SharedPaperServiceError("PAPER_NOT_FOUND", "Shared paper was not found.");
    return result;
  }

  async restorePaperIdempotently(input: { userId: string; paperId: string; idempotencyKey: string }): Promise<{ paper: SharedPaperRecord; outcome: "committed" | "replayed" }> {
    await this.requireActive(input.userId);
    const idempotencyKey = normalizeKey(input.idempotencyKey);
    if (!this.repository.restorePaperIdempotently) throw new Error("Shared paper lifecycle idempotency persistence is unavailable.");
    const result = await this.repository.restorePaperIdempotently({
      userId: input.userId,
      paperId: input.paperId,
      idempotencyKey,
      requestHash: hashMcpWriteRequest({ paperId: input.paperId }),
    });
    if (result.outcome === "idempotency_conflict") throw new SharedPaperServiceError("IDEMPOTENCY_CONFLICT", "The idempotency key was already used for a different shared paper restore request.");
    if (result.outcome === "not_found") throw new SharedPaperServiceError("PAPER_NOT_FOUND", "Shared paper was not found.");
    return result;
  }

  async deletePaperIdempotently(input: { userId: string; paperId: string; idempotencyKey: string }): Promise<{ paperId: string; outcome: "committed" | "replayed" }> {
    await this.requireActive(input.userId);
    const idempotencyKey = normalizeKey(input.idempotencyKey);
    if (!this.repository.deletePaperIdempotently) throw new Error("Shared paper lifecycle idempotency persistence is unavailable.");
    const result = await this.repository.deletePaperIdempotently({
      userId: input.userId,
      paperId: input.paperId,
      idempotencyKey,
      requestHash: hashMcpWriteRequest({ paperId: input.paperId }),
    });
    if (result.outcome === "idempotency_conflict") throw new SharedPaperServiceError("IDEMPOTENCY_CONFLICT", "The idempotency key was already used for a different shared paper delete request.");
    if (result.outcome === "not_found") throw new SharedPaperServiceError("PAPER_NOT_FOUND", "Shared paper was not found.");
    if (result.outcome === "not_archived") throw new SharedPaperServiceError("PAPER_NOT_ARCHIVED", "Shared paper must be archived before permanent deletion.");
    return result;
  }

  async editPaper(input: SharedPaperRangeEditInput): Promise<{ paper: SharedPaperRecord; edit: SharedPaperEdit }> {
    await this.requireActive(input.userId);
    const target = normalizeEditTarget(input.target);
    const normalized = { ...input, target, replacement: normalizeNfc(input.replacement) };
    validateRangeInput(normalized);
    const result = await this.repository.editPaper(normalized);
    if (result.outcome === "revision_conflict") throw new SharedPaperServiceError("PAPER_REVISION_CONFLICT", "Shared paper revision conflict.");
    if (result.outcome === "not_found") throw new SharedPaperServiceError("PAPER_NOT_FOUND", "Shared paper was not found.");
    if (result.outcome === "invalid_edit") throw new SharedPaperServiceError("INVALID_SHARED_PAPER_EDIT", "Shared paper edit is invalid.");
    return result;
  }

  async editPaperByMatch(input: SharedPaperMatchEditInput & { idempotencyKey?: string }): Promise<{ paper: SharedPaperRecord; edit: SharedPaperEdit; outcome?: "committed" | "replayed" }> {
    await this.requireActive(input.userId);
    const idempotencyKey = input.idempotencyKey === undefined ? undefined : normalizeKey(input.idempotencyKey);
    const target = normalizeEditTarget(input.target);
    const match = normalizeNfc(input.matchText);
    const replacement = normalizeNfc(input.replacementText);
    if (idempotencyKey !== undefined && this.repository.editPaperIdempotently) {
      const request = { paperId: input.paperId, expectedRevision: input.expectedRevision, author: input.author, ...(target === "title" ? { target } : {}), matchText: match, replacementText: replacement };
      const result = await this.repository.editPaperIdempotently({ ...input, target, matchText: match, replacementText: replacement, idempotencyKey, requestHash: hashMcpWriteRequest(request) });
      if (result.outcome === "idempotency_conflict") throw new SharedPaperServiceError("IDEMPOTENCY_CONFLICT", "The idempotency key was already used for different shared paper content.");
      if (result.outcome === "revision_conflict") throw new SharedPaperServiceError("PAPER_REVISION_CONFLICT", "Shared paper revision conflict.");
      if (result.outcome === "not_found") throw new SharedPaperServiceError("PAPER_NOT_FOUND", "Shared paper was not found.");
      if (result.outcome === "target_not_found") throw new SharedPaperServiceError("PAPER_EDIT_TARGET_NOT_FOUND", "The edit target was not found.");
      if (result.outcome === "target_ambiguous") throw new SharedPaperServiceError("PAPER_EDIT_TARGET_AMBIGUOUS", "The edit target is ambiguous.");
      if (result.outcome === "invalid_edit") throw new SharedPaperServiceError("INVALID_SHARED_PAPER_EDIT", "Shared paper edit is invalid.");
      if ((result.outcome !== "committed" && result.outcome !== "replayed") || !result.edit) throw new SharedPaperServiceError("INVALID_SHARED_PAPER_EDIT", "Shared paper edit failed.");
      return result;
    }
    const paper = await this.repository.getPaper({ userId: input.userId, paperId: input.paperId });
    if (!paper) throw new SharedPaperServiceError("PAPER_NOT_FOUND", "Shared paper was not found.");
    if (paper.revision !== input.expectedRevision) throw new SharedPaperServiceError("PAPER_REVISION_CONFLICT", "Shared paper revision conflict.");
    const source = target === "title" ? paper.title : paper.content;
    const startUnit = findUniqueMatch(source, match);
    const start = codeUnitOffsetToCodePointOffset(source, startUnit);
    const end = start + codePointLength(match);
    const range: SharedPaperRangeEditInput = { ...input, target, start, end, replacement };
    return { ...(await this.editPaper(range)), outcome: "committed" };
  }

  private async requireActive(userId: string): Promise<void> {
    try { await requireActiveUser(this.repository, userId); }
    catch (error) {
      if (error instanceof ActiveUserAuthorizationError) throw new SharedPaperServiceError(error.code, "Shared paper is unavailable for the authenticated user.");
      throw error;
    }
  }
}

function normalizeCreate(input: SharedPaperCreateInput): SharedPaperCreateInput {
  if (!isContentAuthor(input.author)) throw new SharedPaperServiceError("INVALID_SHARED_PAPER", "Shared paper author is invalid.");
  if (typeof input.title !== "string" || typeof input.content !== "string") {
    throw new SharedPaperServiceError("INVALID_SHARED_PAPER", "Shared paper content is invalid.");
  }
  const title = normalizeNfc(input.title).trim();
  const content = normalizeNfc(input.content);
  if (!title || codePointLength(title) > 200 || codePointLength(content) > MAX_SHARED_PAPER_CONTENT_CODE_POINTS) throw new SharedPaperServiceError("INVALID_SHARED_PAPER", "Shared paper content is invalid.");
  return { userId: input.userId, title, content, author: input.author as ContentAuthor };
}

function validateRangeInput(input: SharedPaperRangeEditInput): void {
  if (!isContentAuthor(input.author) || (input.target !== "content" && input.target !== "title") || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 1 || !Number.isInteger(input.start) || !Number.isInteger(input.end) || input.start < 0 || input.end < input.start || typeof input.replacement !== "string") throw new SharedPaperServiceError("INVALID_SHARED_PAPER_EDIT", "Shared paper edit is invalid.");
}

function normalizeEditTarget(value: SharedPaperRangeEditInput["target"]): "content" | "title" {
  if (value === undefined || value === "content") return "content";
  if (value === "title") return "title";
  throw new SharedPaperServiceError("INVALID_SHARED_PAPER_EDIT", "Shared paper edit target is invalid.");
}

function normalizeQuery(value: unknown): string {
  if (typeof value !== "string") throw new SharedPaperServiceError("INVALID_SHARED_PAPER", "Shared paper search is invalid.");
  const query = normalizeNfc(value).trim().replace(/\s+/gu, " ");
  if (!query || codePointLength(query) > 200) throw new SharedPaperServiceError("INVALID_SHARED_PAPER", "Shared paper search is invalid.");
  return query.toLowerCase();
}

function normalizeNfc(value: string): string { return value.normalize("NFC"); }

function normalizeScope(value: SharedPaperScope | undefined): SharedPaperScope {
  if (value === undefined) return "active";
  if (value === "active" || value === "archived") return value;
  throw new SharedPaperServiceError("INVALID_SHARED_PAPER", "Shared paper scope is invalid.");
}

function boundedLimit(value: number | undefined): number { return value === undefined ? 50 : Math.max(1, Math.min(100, Math.trunc(value))); }

function normalizeKey(value: string): string {
  try { return normalizeMcpIdempotencyKey(value); } catch { throw new SharedPaperServiceError("INVALID_IDEMPOTENCY_KEY", "The idempotency key is invalid."); }
}

function findUniqueMatch(content: string, match: string): number {
  if (match.length === 0) { if (content.length !== 0) throw new SharedPaperServiceError("PAPER_EDIT_TARGET_NOT_FOUND", "The edit target was not found."); return 0; }
  const first = content.indexOf(match);
  if (first < 0) throw new SharedPaperServiceError("PAPER_EDIT_TARGET_NOT_FOUND", "The edit target was not found.");
  if (content.indexOf(match, first + 1) >= 0) throw new SharedPaperServiceError("PAPER_EDIT_TARGET_AMBIGUOUS", "The edit target is ambiguous.");
  return first;
}
