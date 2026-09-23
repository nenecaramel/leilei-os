import type { ContentAuthor } from "../content-author.js";

export const TODO_ENTRY_KINDS = ["pending", "completed", "record"] as const;
export type TodoEntryKind = (typeof TODO_ENTRY_KINDS)[number];
export type TodoEntry = { id: string; kind: TodoEntryKind; text: string; revision?: number };
export type TodoEntryWrite = { id: string; kind: TodoEntryKind; text: string };
export type TodoPaper = {
  author: ContentAuthor;
  date: string;
  revision: number;
  entries: TodoEntry[];
};
export type TodoDayPapers = {
  L: TodoPaper | null;
  G: TodoPaper | null;
  C: TodoPaper | null;
};
export type TodoSearchRow = {
  id: string;
  entryId: string;
  date: string;
  author: ContentAuthor;
  kind: TodoEntryKind;
  text: string;
};
export type TodoSearchInput = {
  userId: string;
  query: string;
  author?: ContentAuthor;
  kind?: TodoEntryKind;
  dateFrom?: string;
  dateTo?: string;
  limit: number;
  offset?: number;
};
export type TodoSearchEntry = {
  entry_id: string;
  date: string;
  author: ContentAuthor;
  kind: TodoEntryKind;
  text: string;
  snippet: string;
};
export type TodoSearchResult = {
  entries: TodoSearchEntry[];
  metadata: { count: number; author: ContentAuthor | null };
};
export type TodoUserRecord = { status: "active" | "disabled" };
export type ReplaceTodoPaperInput = {
  userId: string;
  date: string;
  author: ContentAuthor;
  expectedRevision: number | null;
  entries: TodoEntryWrite[];
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

export type AppendTodoEntryIdempotentlyInput = {
  userId: string;
  date: string;
  author: ContentAuthor;
  kind: TodoEntryKind;
  text: string;
  idempotencyKey: string;
  requestHash: string;
};

export type AppendTodoEntriesIdempotentlyInput = {
  userId: string;
  date: string;
  author: ContentAuthor;
  entries: Array<{ kind: TodoEntryKind; text: string }>;
  idempotencyKey: string;
  requestHash: string;
};

export type TodoEntriesMutationResult =
  | {
      outcome: "committed" | "replayed";
      entries: TodoEntry[];
      paperRevision: number;
    }
  | {
      outcome: "idempotency_conflict" | "entry_not_found" | "entry_limit";
    };

export type UpdateTodoEntryIdempotentlyInput = {
  userId: string;
  date: string;
  author: ContentAuthor;
  entryId: string;
  expectedRevision: number;
  kind?: TodoEntryKind;
  text?: string;
  idempotencyKey: string;
  requestHash: string;
};

export type DeleteTodoEntryIdempotentlyInput = {
  userId: string;
  date: string;
  author: ContentAuthor;
  entryId: string;
  expectedRevision: number;
  idempotencyKey: string;
  requestHash: string;
};

export type TodoEntryMutationResult =
  | {
      outcome: "committed" | "replayed";
      entry: TodoEntry;
      paperRevision: number;
    }
  | {
      outcome:
        | "idempotency_conflict"
        | "entry_not_found"
        | "entry_revision_conflict"
        | "entry_limit";
    };

export type TodoEntryDeleteResult =
  | {
      outcome: "committed" | "replayed";
      entryId: string;
      paperRevision: number;
    }
  | {
      outcome:
        | "idempotency_conflict"
        | "entry_not_found"
        | "entry_revision_conflict";
    };

export interface TodoRepository {
  findUserById(userId: string): Promise<TodoUserRecord | null>;
  readDay(userId: string, date: string): Promise<TodoDayPapers>;
  listContentDates(userId: string): Promise<string[]>;
  searchEntries?(input: TodoSearchInput): Promise<TodoSearchRow[]>;
  replacePaper(input: ReplaceTodoPaperInput): Promise<ReplaceTodoPaperResult>;
  replacePaperIdempotently?(
    input: ReplaceTodoPaperIdempotentlyInput,
  ): Promise<ReplaceTodoPaperIdempotentlyResult>;
  appendEntryIdempotently?(
    input: AppendTodoEntryIdempotentlyInput,
  ): Promise<TodoEntryMutationResult>;
  appendEntriesIdempotently?(
    input: AppendTodoEntriesIdempotentlyInput,
  ): Promise<TodoEntriesMutationResult>;
  updateEntryIdempotently?(
    input: UpdateTodoEntryIdempotentlyInput,
  ): Promise<TodoEntryMutationResult>;
  deleteEntryIdempotently?(
    input: DeleteTodoEntryIdempotentlyInput,
  ): Promise<TodoEntryDeleteResult>;
}
