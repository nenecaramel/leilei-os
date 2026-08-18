import type { ContentAuthor } from "../content-author.js";

export const TODO_ENTRY_KINDS = ["pending", "completed", "record"] as const;
export type TodoEntryKind = (typeof TODO_ENTRY_KINDS)[number];
export type TodoEntry = { id: string; kind: TodoEntryKind; text: string };
export type TodoPaper = {
  author: ContentAuthor;
  date: string;
  revision: number;
  entries: TodoEntry[];
};
export type TodoDayPapers = { L: TodoPaper | null; G: TodoPaper | null };
export type TodoUserRecord = { status: "active" | "disabled" };
export type ReplaceTodoPaperInput = {
  userId: string;
  date: string;
  author: ContentAuthor;
  expectedRevision: number | null;
  entries: TodoEntry[];
};
export type ReplaceTodoPaperResult =
  | { outcome: "committed"; paper: TodoPaper }
  | { outcome: "conflict" };

export type ReplaceTodoPaperIdempotentlyInput = ReplaceTodoPaperInput & {
  idempotencyKey: string;
  requestHash: string;
};

export type ReplaceTodoPaperIdempotentlyResult =
  | { outcome: "committed" | "replayed"; paper: TodoPaper }
  | { outcome: "idempotency_conflict" | "revision_conflict" };

export interface TodoRepository {
  findUserById(userId: string): Promise<TodoUserRecord | null>;
  readDay(userId: string, date: string): Promise<TodoDayPapers>;
  listContentDates(userId: string): Promise<string[]>;
  replacePaper(input: ReplaceTodoPaperInput): Promise<ReplaceTodoPaperResult>;
  replacePaperIdempotently?(
    input: ReplaceTodoPaperIdempotentlyInput,
  ): Promise<ReplaceTodoPaperIdempotentlyResult>;
}
