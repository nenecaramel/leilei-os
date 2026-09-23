import { isContentAuthor, type ContentAuthor } from "../content-author.js";
import {
  hashMcpWriteRequest,
  normalizeMcpIdempotencyKey,
} from "../mcp-write/mcp-write-idempotency.js";
import {
  TODO_ENTRY_KINDS,
  type ReplaceTodoPaperInput,
  type TodoEntry,
  type TodoPaper,
  type TodoRepository,
  type TodoSearchInput,
  type TodoSearchResult,
} from "./todo-types.js";
import {
  ActiveUserAuthorizationError,
  requireActiveUser,
} from "../require-active-user.js";
import {
  MAX_TODO_ENTRIES,
  MAX_TODO_ENTRY_ID_LENGTH,
  MAX_TODO_ENTRY_TEXT_LENGTH,
} from "../resource-limits.js";
import { createSearchSnippet, normalizeSearchQuery } from "../search/search-text.js";

export type TodoServiceErrorCode =
  | "TODO_DATE_INVALID"
  | "TODO_AUTHOR_INVALID"
  | "TODO_REVISION_INVALID"
  | "TODO_ENTRY_INVALID"
  | "TODO_ENTRY_ID_DUPLICATE"
  | "TODO_ENTRY_NOT_FOUND"
  | "TODO_ENTRY_CONFLICT"
  | "TODO_ENTRY_LIMIT"
  | "TODO_PAPER_CONFLICT"
  | "TODO_SEARCH_INVALID"
  | "INVALID_IDEMPOTENCY_KEY"
  | "IDEMPOTENCY_CONFLICT"
  | "USER_NOT_FOUND"
  | "USER_DISABLED";

export class TodoServiceError extends Error {
  constructor(public readonly code: TodoServiceErrorCode, message: string) {
    super(message);
    this.name = "TodoServiceError";
  }
}

function assertDate(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TodoServiceError("TODO_DATE_INVALID", "Todo date is invalid.");
  }
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new TodoServiceError("TODO_DATE_INVALID", "Todo date is invalid.");
  }
}

function normalizeEntries(value: unknown): TodoEntry[] {
  if (!Array.isArray(value)) throw new TodoServiceError("TODO_ENTRY_INVALID", "Todo entries are invalid.");
  if (value.length > MAX_TODO_ENTRIES) throw new TodoServiceError("TODO_ENTRY_INVALID", "Todo entries are invalid.");
  const seen = new Set<string>();
  const normalized: TodoEntry[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") throw new TodoServiceError("TODO_ENTRY_INVALID", "Todo entry is invalid.");
    const candidate = row as Record<string, unknown>;
    if (typeof candidate.id !== "string" || !candidate.id.trim()) throw new TodoServiceError("TODO_ENTRY_INVALID", "Todo entry is invalid.");
    if (typeof candidate.kind !== "string" || !(TODO_ENTRY_KINDS as readonly string[]).includes(candidate.kind)) throw new TodoServiceError("TODO_ENTRY_INVALID", "Todo entry is invalid.");
    if (typeof candidate.text !== "string") throw new TodoServiceError("TODO_ENTRY_INVALID", "Todo entry is invalid.");
    const id = candidate.id.trim();
    const text = candidate.text.trim();
    if (id.length > MAX_TODO_ENTRY_ID_LENGTH || text.length > MAX_TODO_ENTRY_TEXT_LENGTH) throw new TodoServiceError("TODO_ENTRY_INVALID", "Todo entry is invalid.");
    if (!text) continue;
    if (seen.has(id)) throw new TodoServiceError("TODO_ENTRY_ID_DUPLICATE", "Todo entry ids must be unique.");
    seen.add(id);
    normalized.push({ id, kind: candidate.kind as TodoEntry["kind"], text });
  }
  return normalized;
}

type ReplacePaperServiceInput = {
  userId: string;
  date: unknown;
  author: unknown;
  revision: unknown;
  entries: unknown;
};

function normalizeReplacePaperInput(
  input: ReplacePaperServiceInput,
): ReplaceTodoPaperInput {
  assertDate(input.date);
  if (!isContentAuthor(input.author)) {
    throw new TodoServiceError("TODO_AUTHOR_INVALID", "Todo author is invalid.");
  }
  if (
    input.revision !== null &&
    (typeof input.revision !== "number" ||
      !Number.isInteger(input.revision) ||
      input.revision < 0)
  ) {
    throw new TodoServiceError("TODO_REVISION_INVALID", "Todo revision is invalid.");
  }
  return {
    userId: input.userId,
    date: input.date,
    author: input.author as ContentAuthor,
    expectedRevision: input.revision as number | null,
    entries: normalizeEntries(input.entries),
  };
}

export type ReplaceTodoPaperIdempotentlyServiceResult = {
  paper: TodoPaper;
  metadata: {
    committed: boolean;
    idempotent_replay: boolean;
  };
};

export type TodoEntryMutationServiceResult = {
  entry: TodoEntry;
  paperRevision: number;
  metadata: {
    committed: boolean;
    idempotent_replay: boolean;
  };
};

export type TodoEntriesMutationServiceResult = {
  entries: Array<TodoEntry & { outcome: "applied" | "replayed" }>;
  paperRevision: number;
  metadata: {
    committed: boolean;
    idempotent_replay: boolean;
  };
};

export type TodoEntryDeleteServiceResult = {
  entryId: string;
  paperRevision: number;
  metadata: {
    committed: boolean;
    idempotent_replay: boolean;
  };
};

export class TodoService {
  constructor(private readonly repository: TodoRepository) {}

  async readDay(userId: string, date: string) {
    await this.requireActiveUser(userId);
    assertDate(date);
    return { date, papers: await this.repository.readDay(userId, date) };
  }

  async listDates(userId: string): Promise<string[]> {
    await this.requireActiveUser(userId);
    return this.repository.listContentDates(userId);
  }

  async search(input: {
    userId: string;
    query: unknown;
    author?: unknown;
    kind?: unknown;
    date_from?: unknown;
    date_to?: unknown;
    limit?: unknown;
  }): Promise<TodoSearchResult> {
    await this.requireActiveUser(input.userId);
    let query: string;
    try { query = normalizeSearchQuery(input.query).toLocaleLowerCase(); } catch { throw new TodoServiceError("TODO_SEARCH_INVALID", "Todo search is invalid."); }
    const author = input.author === undefined ? undefined : input.author;
    if (author !== undefined && !isContentAuthor(author)) throw new TodoServiceError("TODO_SEARCH_INVALID", "Todo search is invalid.");
    const kind = input.kind === undefined ? undefined : input.kind;
    if (kind !== undefined && !(TODO_ENTRY_KINDS as readonly unknown[]).includes(kind)) throw new TodoServiceError("TODO_SEARCH_INVALID", "Todo search is invalid.");
    const dateFrom = searchDate(input.date_from);
    const dateTo = searchDate(input.date_to);
    if (dateFrom && dateTo && dateFrom > dateTo) throw new TodoServiceError("TODO_SEARCH_INVALID", "Todo search is invalid.");
    const limit = input.limit === undefined ? 50 : input.limit;
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new TodoServiceError("TODO_SEARCH_INVALID", "Todo search is invalid.");
    if (!this.repository.searchEntries) throw new Error("Todo search persistence is unavailable.");
    const rows = await this.repository.searchEntries({
      userId: input.userId,
      query,
      author: author as TodoSearchInput["author"],
      kind: kind as TodoSearchInput["kind"],
      dateFrom,
      dateTo,
      limit,
    });
    return {
      entries: rows.map((row) => ({
        entry_id: row.entryId,
        date: row.date,
        author: row.author,
        kind: row.kind,
        text: row.text,
        snippet: createSearchSnippet(row.text, query),
      })),
      metadata: { count: rows.length, author: author ?? null },
    };
  }

  async replacePaper(input: ReplacePaperServiceInput): Promise<TodoPaper> {
    await this.requireActiveUser(input.userId);
    const result = await this.repository.replacePaper(
      normalizeReplacePaperInput(input),
    );
    if (result.outcome === "conflict") throw new TodoServiceError("TODO_PAPER_CONFLICT", "Todo paper changed on another device.");
    return result.paper;
  }

  async replacePaperIdempotently(
    input: ReplacePaperServiceInput & { idempotencyKey: string },
  ): Promise<ReplaceTodoPaperIdempotentlyServiceResult> {
    await this.requireActiveUser(input.userId);
    const normalized = normalizeReplacePaperInput(input);
    let idempotencyKey: string;
    try {
      idempotencyKey = normalizeMcpIdempotencyKey(input.idempotencyKey);
    } catch {
      throw new TodoServiceError(
        "INVALID_IDEMPOTENCY_KEY",
        "The idempotency key is invalid.",
      );
    }
    if (!this.repository.replacePaperIdempotently) {
      throw new Error("Todo idempotent persistence is unavailable.");
    }
    const requestHash = hashMcpWriteRequest({
      date: normalized.date,
      author: normalized.author,
      revision: normalized.expectedRevision,
      entries: normalized.entries,
    });
    const result = await this.repository.replacePaperIdempotently({
      ...normalized,
      idempotencyKey,
      requestHash,
    });
    if (result.outcome === "committed" || result.outcome === "replayed") {
      return {
        paper: result.paper,
        metadata: {
          committed: result.outcome === "committed",
          idempotent_replay: result.outcome === "replayed",
        },
      };
    }
    if (result.outcome === "idempotency_conflict") {
      throw new TodoServiceError(
        "IDEMPOTENCY_CONFLICT",
        "The idempotency key was already used for different Todo content.",
      );
    }
    if (result.outcome === "revision_conflict") {
      throw new TodoServiceError(
        "TODO_PAPER_CONFLICT",
        "Todo paper changed on another device.",
      );
    }
    throw new Error("Unknown Todo idempotent persistence outcome.");
  }

  async appendEntryIdempotently(input: {
    userId: string;
    date: unknown;
    author: unknown;
    kind: unknown;
    text: unknown;
    idempotencyKey: string;
  }): Promise<TodoEntryMutationServiceResult> {
    await this.requireActiveUser(input.userId);
    const date = normalizeTodoDate(input.date);
    const author = normalizeTodoAuthor(input.author);
    const kind = normalizeTodoKind(input.kind);
    const text = normalizeTodoEntryText(input.text);
    const idempotencyKey = normalizeTodoIdempotencyKey(input.idempotencyKey);
    if (!this.repository.appendEntryIdempotently) {
      throw new Error("Todo entry append persistence is unavailable.");
    }
    const result = await this.repository.appendEntryIdempotently({
      userId: input.userId,
      date,
      author,
      kind,
      text,
      idempotencyKey,
      requestHash: hashMcpWriteRequest({ date, author, kind, text }),
    });
    if (result.outcome === "committed" || result.outcome === "replayed") {
      return {
        entry: result.entry,
        paperRevision: result.paperRevision,
        metadata: {
          committed: result.outcome === "committed",
          idempotent_replay: result.outcome === "replayed",
        },
      };
    }
    if (result.outcome === "idempotency_conflict") {
      throw new TodoServiceError("IDEMPOTENCY_CONFLICT", "The idempotency key was already used for a different Todo entry append.");
    }
    if (result.outcome === "entry_limit") {
      throw new TodoServiceError("TODO_ENTRY_LIMIT", "The Todo paper already has the maximum number of entries.");
    }
    if (result.outcome === "entry_not_found") {
      throw new TodoServiceError("TODO_ENTRY_NOT_FOUND", "The appended Todo entry is no longer available.");
    }
    throw new Error("Unknown Todo entry append persistence outcome.");
  }

  async appendEntriesIdempotently(input: {
    userId: string;
    date: unknown;
    author: unknown;
    entries: unknown;
    idempotencyKey: string;
  }): Promise<TodoEntriesMutationServiceResult> {
    await this.requireActiveUser(input.userId);
    const date = normalizeTodoDate(input.date);
    const author = normalizeTodoAuthor(input.author);
    const entries = normalizeTodoBatchEntries(input.entries);
    const idempotencyKey = normalizeTodoIdempotencyKey(input.idempotencyKey);
    if (!this.repository.appendEntriesIdempotently) {
      throw new Error("Todo batch append persistence is unavailable.");
    }
    const result = await this.repository.appendEntriesIdempotently({
      userId: input.userId,
      date,
      author,
      entries,
      idempotencyKey,
      requestHash: hashMcpWriteRequest({ date, author, entries }),
    });
    if (result.outcome === "committed" || result.outcome === "replayed") {
      const entryOutcome = result.outcome === "committed" ? "applied" : "replayed";
      return {
        entries: result.entries.map((entry) => ({
          ...entry,
          outcome: entryOutcome,
        })),
        paperRevision: result.paperRevision,
        metadata: {
          committed: result.outcome === "committed",
          idempotent_replay: result.outcome === "replayed",
        },
      };
    }
    if (result.outcome === "idempotency_conflict") {
      throw new TodoServiceError(
        "IDEMPOTENCY_CONFLICT",
        "The idempotency key was already used for a different Todo entry append.",
      );
    }
    if (result.outcome === "entry_limit") {
      throw new TodoServiceError(
        "TODO_ENTRY_LIMIT",
        "The Todo batch would exceed the maximum number of entries.",
      );
    }
    if (result.outcome === "entry_not_found") {
      throw new TodoServiceError(
        "TODO_ENTRY_NOT_FOUND",
        "One or more replayed Todo entries are no longer available.",
      );
    }
    throw new Error("Unknown Todo batch append persistence outcome.");
  }

  async updateEntryIdempotently(input: {
    userId: string;
    date: unknown;
    author: unknown;
    entryId: unknown;
    expectedRevision: unknown;
    kind?: unknown;
    text?: unknown;
    idempotencyKey: string;
  }): Promise<TodoEntryMutationServiceResult> {
    await this.requireActiveUser(input.userId);
    const date = normalizeTodoDate(input.date);
    const author = normalizeTodoAuthor(input.author);
    const entryId = normalizeTodoEntryId(input.entryId);
    const expectedRevision = normalizeTodoEntryRevision(input.expectedRevision);
    if (input.kind === undefined && input.text === undefined) {
      throw new TodoServiceError("TODO_ENTRY_INVALID", "Todo entry update must change kind or text.");
    }
    const kind = input.kind === undefined ? undefined : normalizeTodoKind(input.kind);
    const text = input.text === undefined ? undefined : normalizeTodoEntryText(input.text);
    const idempotencyKey = normalizeTodoIdempotencyKey(input.idempotencyKey);
    if (!this.repository.updateEntryIdempotently) {
      throw new Error("Todo entry update persistence is unavailable.");
    }
    const result = await this.repository.updateEntryIdempotently({
      userId: input.userId,
      date,
      author,
      entryId,
      expectedRevision,
      kind,
      text,
      idempotencyKey,
      requestHash: hashMcpWriteRequest({
        date,
        author,
        entry_id: entryId,
        expected_revision: expectedRevision,
        kind: kind ?? null,
        text: text ?? null,
      }),
    });
    return mapTodoEntryMutationResult(result, "update");
  }

  async deleteEntryIdempotently(input: {
    userId: string;
    date: unknown;
    author: unknown;
    entryId: unknown;
    expectedRevision: unknown;
    idempotencyKey: string;
  }): Promise<TodoEntryDeleteServiceResult> {
    await this.requireActiveUser(input.userId);
    const date = normalizeTodoDate(input.date);
    const author = normalizeTodoAuthor(input.author);
    const entryId = normalizeTodoEntryId(input.entryId);
    const expectedRevision = normalizeTodoEntryRevision(input.expectedRevision);
    const idempotencyKey = normalizeTodoIdempotencyKey(input.idempotencyKey);
    if (!this.repository.deleteEntryIdempotently) {
      throw new Error("Todo entry delete persistence is unavailable.");
    }
    const result = await this.repository.deleteEntryIdempotently({
      userId: input.userId,
      date,
      author,
      entryId,
      expectedRevision,
      idempotencyKey,
      requestHash: hashMcpWriteRequest({
        date,
        author,
        entry_id: entryId,
        expected_revision: expectedRevision,
      }),
    });
    if (result.outcome === "committed" || result.outcome === "replayed") {
      return {
        entryId: result.entryId,
        paperRevision: result.paperRevision,
        metadata: {
          committed: result.outcome === "committed",
          idempotent_replay: result.outcome === "replayed",
        },
      };
    }
    if (result.outcome === "idempotency_conflict") {
      throw new TodoServiceError("IDEMPOTENCY_CONFLICT", "The idempotency key was already used for a different Todo entry delete.");
    }
    if (result.outcome === "entry_not_found") {
      throw new TodoServiceError("TODO_ENTRY_NOT_FOUND", "Todo entry was not found.");
    }
    if (result.outcome === "entry_revision_conflict") {
      throw new TodoServiceError("TODO_ENTRY_CONFLICT", "Todo entry changed on another device.");
    }
    throw new Error("Unknown Todo entry delete persistence outcome.");
  }

  private async requireActiveUser(userId: string): Promise<void> {
    try {
      await requireActiveUser(this.repository, userId);
    } catch (error) {
      if (error instanceof ActiveUserAuthorizationError) {
        throw new TodoServiceError(error.code, "Todo is unavailable for the authenticated user.");
      }
      throw error;
    }
  }
}

function normalizeTodoDate(value: unknown): string {
  assertDate(value);
  return value;
}

function normalizeTodoAuthor(value: unknown): ContentAuthor {
  if (!isContentAuthor(value)) {
    throw new TodoServiceError("TODO_AUTHOR_INVALID", "Todo author is invalid.");
  }
  return value;
}

function normalizeTodoKind(value: unknown): TodoEntry["kind"] {
  if (typeof value !== "string" || !(TODO_ENTRY_KINDS as readonly string[]).includes(value)) {
    throw new TodoServiceError("TODO_ENTRY_INVALID", "Todo entry kind is invalid.");
  }
  return value as TodoEntry["kind"];
}

function normalizeTodoEntryId(value: unknown): string {
  if (typeof value !== "string") {
    throw new TodoServiceError("TODO_ENTRY_INVALID", "Todo entry id is invalid.");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_TODO_ENTRY_ID_LENGTH) {
    throw new TodoServiceError("TODO_ENTRY_INVALID", "Todo entry id is invalid.");
  }
  return normalized;
}

function normalizeTodoEntryText(value: unknown): string {
  if (typeof value !== "string") {
    throw new TodoServiceError("TODO_ENTRY_INVALID", "Todo entry text is invalid.");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_TODO_ENTRY_TEXT_LENGTH) {
    throw new TodoServiceError("TODO_ENTRY_INVALID", "Todo entry text is invalid.");
  }
  return normalized;
}

function normalizeTodoBatchEntries(
  value: unknown,
): Array<{ kind: TodoEntry["kind"]; text: string }> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TodoServiceError(
      "TODO_ENTRY_INVALID",
      "Todo batch must contain at least one entry.",
    );
  }
  if (value.length > MAX_TODO_ENTRIES) {
    throw new TodoServiceError(
      "TODO_ENTRY_LIMIT",
      "Todo batch exceeds the maximum number of entries.",
    );
  }
  return value.map((row) => {
    if (!row || typeof row !== "object") {
      throw new TodoServiceError("TODO_ENTRY_INVALID", "Todo batch entry is invalid.");
    }
    const candidate = row as Record<string, unknown>;
    return {
      kind: normalizeTodoKind(candidate.kind),
      text: normalizeTodoEntryText(candidate.text),
    };
  });
}

function normalizeTodoEntryRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new TodoServiceError("TODO_REVISION_INVALID", "Todo entry revision is invalid.");
  }
  return value;
}

function normalizeTodoIdempotencyKey(value: string): string {
  try {
    return normalizeMcpIdempotencyKey(value);
  } catch {
    throw new TodoServiceError("INVALID_IDEMPOTENCY_KEY", "The idempotency key is invalid.");
  }
}

function mapTodoEntryMutationResult(
  result: Awaited<ReturnType<NonNullable<TodoRepository["updateEntryIdempotently"]>>>,
  operation: "update",
): TodoEntryMutationServiceResult {
  if (result.outcome === "committed" || result.outcome === "replayed") {
    return {
      entry: result.entry,
      paperRevision: result.paperRevision,
      metadata: {
        committed: result.outcome === "committed",
        idempotent_replay: result.outcome === "replayed",
      },
    };
  }
  if (result.outcome === "idempotency_conflict") {
    throw new TodoServiceError("IDEMPOTENCY_CONFLICT", `The idempotency key was already used for a different Todo entry ${operation}.`);
  }
  if (result.outcome === "entry_not_found") {
    throw new TodoServiceError("TODO_ENTRY_NOT_FOUND", "Todo entry was not found.");
  }
  if (result.outcome === "entry_revision_conflict") {
    throw new TodoServiceError("TODO_ENTRY_CONFLICT", "Todo entry changed on another device.");
  }
  if (result.outcome === "entry_limit") {
    throw new TodoServiceError("TODO_ENTRY_LIMIT", "The Todo paper already has the maximum number of entries.");
  }
  throw new Error("Unknown Todo entry mutation persistence outcome.");
}

function searchDate(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try { assertDate(value); return value; } catch { throw new TodoServiceError("TODO_SEARCH_INVALID", "Todo search is invalid."); }
}
