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
} from "./todo-types.js";

export type TodoServiceErrorCode =
  | "TODO_DATE_INVALID"
  | "TODO_AUTHOR_INVALID"
  | "TODO_REVISION_INVALID"
  | "TODO_ENTRY_INVALID"
  | "TODO_ENTRY_ID_DUPLICATE"
  | "TODO_PAPER_CONFLICT"
  | "INVALID_IDEMPOTENCY_KEY"
  | "IDEMPOTENCY_CONFLICT";

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

export class TodoService {
  constructor(private readonly repository: TodoRepository) {}

  async readDay(userId: string, date: string) {
    assertDate(date);
    return { date, papers: await this.repository.readDay(userId, date) };
  }

  listDates(userId: string): Promise<string[]> {
    return this.repository.listContentDates(userId);
  }

  async replacePaper(input: ReplacePaperServiceInput): Promise<TodoPaper> {
    const result = await this.repository.replacePaper(
      normalizeReplacePaperInput(input),
    );
    if (result.outcome === "conflict") throw new TodoServiceError("TODO_PAPER_CONFLICT", "Todo paper changed on another device.");
    return result.paper;
  }

  async replacePaperIdempotently(
    input: ReplacePaperServiceInput & { idempotencyKey: string },
  ): Promise<ReplaceTodoPaperIdempotentlyServiceResult> {
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
}
