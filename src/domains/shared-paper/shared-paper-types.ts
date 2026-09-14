import type { ContentAuthor } from "../content-author.js";

export type SharedPaperScope = "active" | "archived";
export type SharedPaperEditTarget = "content" | "title";

export type SharedPaperRecord = {
  id: string;
  userId: string;
  title: string;
  content: string;
  revision: number;
  createdBy: ContentAuthor;
  updatedBy: ContentAuthor;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

export type SharedPaperEdit = {
  id: string;
  userId: string;
  paperId: string;
  baseRevision: number;
  revision: number;
  author: ContentAuthor;
  target: SharedPaperEditTarget;
  startOffset: number;
  endOffset: number;
  deletedText: string;
  insertedText: string;
  createdAt: Date;
};

export type SharedPaperListInput = { userId: string; limit?: number; scope?: SharedPaperScope };
export type SharedPaperSearchInput = { userId: string; query: string; limit?: number; scope?: SharedPaperScope };

export type SharedPaperCreateInput = {
  userId: string;
  title: string;
  content: string;
  author: ContentAuthor;
};

export type SharedPaperRangeEditInput = {
  userId: string;
  paperId: string;
  expectedRevision: number;
  author: ContentAuthor;
  target?: SharedPaperEditTarget;
  start: number;
  end: number;
  replacement: string;
};

export type SharedPaperMatchEditInput = {
  userId: string;
  paperId: string;
  expectedRevision: number;
  author: ContentAuthor;
  target?: SharedPaperEditTarget;
  matchText: string;
  replacementText: string;
};

export type SharedPaperCreateIdempotencyInput = SharedPaperCreateInput & {
  idempotencyKey: string;
  requestHash: string;
};

export type SharedPaperEditIdempotencyInput = SharedPaperMatchEditInput & {
  idempotencyKey: string;
  requestHash: string;
};

export type SharedPaperAppendIdempotencyInput = {
  userId: string;
  paperId: string;
  expectedRevision: number;
  author: ContentAuthor;
  text: string;
  idempotencyKey: string;
  requestHash: string;
};

export type SharedPaperLifecycleIdempotencyInput = {
  userId: string;
  paperId: string;
  idempotencyKey: string;
  requestHash: string;
};

export type SharedPaperDeleteResult = {
  paperId: string;
  outcome: "committed" | "replayed";
};

export type SharedPaperMutationResult = {
  paper: SharedPaperRecord;
  edit?: SharedPaperEdit;
  outcome: "committed" | "replayed";
};

export interface SharedPaperRepository {
  findUserById(userId: string): Promise<{ status: "active" | "disabled" } | null>;
  listPapers(input: SharedPaperListInput): Promise<SharedPaperRecord[]>;
  searchPapers(input: SharedPaperSearchInput): Promise<SharedPaperRecord[]>;
  getPaper(input: { userId: string; paperId: string }): Promise<SharedPaperRecord | null>;
  listEdits(input: { userId: string; paperId: string; limit?: number; beforeRevision?: number }): Promise<SharedPaperEdit[]>;
  createPaper(input: SharedPaperCreateInput): Promise<SharedPaperRecord>;
  archivePaper(input: { userId: string; paperId: string }): Promise<
    { outcome: "committed" | "unchanged"; paper: SharedPaperRecord } | { outcome: "not_found" }
  >;
  restorePaper(input: { userId: string; paperId: string }): Promise<
    { outcome: "committed" | "unchanged"; paper: SharedPaperRecord } | { outcome: "not_found" }
  >;
  deletePaper(input: { userId: string; paperId: string }): Promise<
    { outcome: "deleted" } | { outcome: "not_found" | "not_archived" }
  >;
  archivePaperIdempotently?(input: SharedPaperLifecycleIdempotencyInput): Promise<
    | { outcome: "committed" | "replayed"; paper: SharedPaperRecord }
    | { outcome: "idempotency_conflict" }
    | { outcome: "not_found" }
  >;
  restorePaperIdempotently?(input: SharedPaperLifecycleIdempotencyInput): Promise<
    | { outcome: "committed" | "replayed"; paper: SharedPaperRecord }
    | { outcome: "idempotency_conflict" }
    | { outcome: "not_found" }
  >;
  deletePaperIdempotently?(input: SharedPaperLifecycleIdempotencyInput): Promise<
    | SharedPaperDeleteResult
    | { outcome: "idempotency_conflict" }
    | { outcome: "not_found" }
    | { outcome: "not_archived" }
  >;
  editPaper(input: SharedPaperRangeEditInput): Promise<
    { outcome: "committed"; paper: SharedPaperRecord; edit: SharedPaperEdit } | { outcome: "revision_conflict" } | { outcome: "not_found" } | { outcome: "invalid_edit" }
  >;
  createPaperIdempotently?(input: SharedPaperCreateIdempotencyInput): Promise<SharedPaperMutationResult | { outcome: "idempotency_conflict" }>;
  editPaperIdempotently?(input: SharedPaperEditIdempotencyInput): Promise<(SharedPaperMutationResult & { edit: SharedPaperEdit }) | { outcome: "revision_conflict" | "idempotency_conflict" | "not_found" | "target_not_found" | "target_ambiguous" | "invalid_edit" }>;
  appendPaperIdempotently?(input: SharedPaperAppendIdempotencyInput): Promise<(SharedPaperMutationResult & { edit: SharedPaperEdit }) | { outcome: "revision_conflict" | "idempotency_conflict" | "not_found" | "invalid_edit" }>;
}
