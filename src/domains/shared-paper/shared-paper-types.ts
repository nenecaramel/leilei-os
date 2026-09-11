import type { ContentAuthor } from "../content-author.js";

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
};

export type SharedPaperEdit = {
  id: string;
  userId: string;
  paperId: string;
  baseRevision: number;
  revision: number;
  author: ContentAuthor;
  startOffset: number;
  endOffset: number;
  deletedText: string;
  insertedText: string;
  createdAt: Date;
};

export type SharedPaperListInput = { userId: string; limit?: number };
export type SharedPaperSearchInput = { userId: string; query: string; limit?: number };

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
  start: number;
  end: number;
  replacement: string;
};

export type SharedPaperMatchEditInput = {
  userId: string;
  paperId: string;
  expectedRevision: number;
  author: ContentAuthor;
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
  listEdits(input: { userId: string; paperId: string; limit?: number }): Promise<SharedPaperEdit[]>;
  createPaper(input: SharedPaperCreateInput): Promise<SharedPaperRecord>;
  editPaper(input: SharedPaperRangeEditInput): Promise<
    { outcome: "committed"; paper: SharedPaperRecord; edit: SharedPaperEdit } | { outcome: "revision_conflict" } | { outcome: "not_found" } | { outcome: "invalid_edit" }
  >;
  createPaperIdempotently?(input: SharedPaperCreateIdempotencyInput): Promise<SharedPaperMutationResult | { outcome: "idempotency_conflict" }>;
  editPaperIdempotently?(input: SharedPaperEditIdempotencyInput): Promise<(SharedPaperMutationResult & { edit: SharedPaperEdit }) | { outcome: "revision_conflict" | "idempotency_conflict" | "not_found" | "target_not_found" | "target_ambiguous" | "invalid_edit" }>;
}
