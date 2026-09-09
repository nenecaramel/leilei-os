import { createHash, randomUUID } from "node:crypto";
import type {
  DiaryAuditRequestSummary,
  DiaryEntryRecord,
  DiaryRecord,
  DiaryRepository,
  DiaryListQuery,
  NormalizedDiaryCreate,
  UpdateDiaryInput,
} from "./diary-repository.js";
import { createBodyMatchSnippet } from "../compact-text.js";
import { WEB_USER_LIFECYCLE_CONTEXT } from "../lifecycle/lifecycle-audit-repository.js";
import { hashMcpWriteRequest } from "../mcp-write/mcp-write-idempotency.js";
import {
  isContentAuthor,
  type ContentAuthor,
} from "../content-author.js";
import {
  DIARY_CONTENT_MAX_LENGTH,
  DIARY_MOOD_MAX_LENGTH,
  DIARY_TAGS_MAX_COUNT,
  DIARY_TAG_MAX_LENGTH,
  DIARY_TITLE_MAX_LENGTH,
} from "../resource-limits.js";

const MAX_TITLE_LENGTH = DIARY_TITLE_MAX_LENGTH;
const MAX_CONTENT_LENGTH = DIARY_CONTENT_MAX_LENGTH;
const MAX_TAGS = DIARY_TAGS_MAX_COUNT;
const MAX_TAG_LENGTH = DIARY_TAG_MAX_LENGTH;
const MAX_MOOD_LENGTH = DIARY_MOOD_MAX_LENGTH;
const MIN_IDEMPOTENCY_KEY_LENGTH = 16;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const DEFAULT_DIARY_LIMIT = 50;
const MAX_DIARY_LIMIT = 100;
const MAX_SEARCH_LENGTH = 200;

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type AuthenticatedDiaryContext = {
  userId: string;
};

export type CreateDiaryInput = {
  title: string;
  content: string;
  date: string;
  tags: readonly string[];
  mood?: string | null;
  idempotencyKey: string;
  author?: ContentAuthor;
};

export type CreateDiaryResult = {
  diary: {
    id: string;
    title: string;
    date: string;
    tags: string[];
    mood: string | null;
    author: ContentAuthor | null;
    created_at: string;
  };
  metadata: {
    created: boolean;
    idempotent_replay: boolean;
  };
};

export type DiaryEntryResult = {
  id: string;
  title: string;
  content: string;
  date: string;
  tags: string[];
  mood: string | null;
  author: ContentAuthor | null;
  created_at: string;
  updated_at: string;
};

export type ListDiariesInput = {
  userId: string;
  limit?: number;
  query?: RawDiaryListQuery;
};

export type RawDiaryListQuery = {
  q?: string;
  tag?: string;
  mood?: string;
  author?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type ListDiariesResult = {
  diaries: DiaryEntryResult[];
  metadata: {
    count: number;
  };
};

export type DiarySearchDiscoveryItem = {
  id: string;
  title: string;
  date: string;
  tags: string[];
  mood: string | null;
  created_at: string;
  updated_at: string;
  author: ContentAuthor | null;
  snippet: string | null;
};

export type SearchDiaryDiscoveryResult = {
  diaries: DiarySearchDiscoveryItem[];
  metadata: { count: number };
};

export type DiaryContentDatesResult = {
  dates: string[];
};

export type DiariesByDateResult = {
  date: string;
  diaries: DiaryEntryResult[];
};

export type ReadDiaryInput = {
  userId: string;
  id: string;
};

export type CreateWebDiaryInput = {
  userId: string;
  title: string;
  content: string;
  date: string;
  tags?: readonly string[];
  mood?: string | null;
  author?: ContentAuthor;
};

export type UpdateWebDiaryInput = {
  userId: string;
  id: string;
  title: string;
  content: string;
  date: string;
  tags?: readonly string[];
  mood?: string | null;
  author?: ContentAuthor;
};

export type UpdateMcpDiaryInput = {
  id: string;
  title?: string;
  content?: string;
  date?: string;
  tags?: readonly string[];
  mood?: string | null;
  author?: ContentAuthor;
};

export type DiaryDomainErrorCode =
  | "AUTHOR_REQUIRED"
  | "INVALID_AUTHENTICATED_USER"
  | "USER_NOT_FOUND"
  | "USER_DISABLED"
  | "DIARY_NOT_FOUND"
  | "INVALID_DIARY_ID"
  | "INVALID_DIARY_LIMIT"
  | "INVALID_DIARY_QUERY"
  | "INVALID_TITLE"
  | "INVALID_CONTENT"
  | "INVALID_DATE"
  | "INVALID_TAGS"
  | "INVALID_MOOD"
  | "INVALID_DIARY_PATCH"
  | "INVALID_IDEMPOTENCY_KEY"
  | "IDEMPOTENCY_CONFLICT";

export class DiaryDomainError extends Error {
  constructor(
    readonly code: DiaryDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DiaryDomainError";
  }
}

export class DiaryService {
  constructor(private readonly repository: DiaryRepository) {}

  async createDiary(
    context: AuthenticatedDiaryContext,
    input: CreateDiaryInput,
  ): Promise<CreateDiaryResult> {
    const userId = await this.requireActiveUser(context.userId);
    const normalized = this.normalizeInput(userId, input);
    const requestSummary = this.createAuditSummary(normalized);

    const persisted = await this.repository.createDiaryWithAudit(
      normalized,
      requestSummary,
    );

    if (persisted.outcome === "conflict") {
      throw new DiaryDomainError(
        "IDEMPOTENCY_CONFLICT",
        "The idempotency key was already used for different diary content.",
      );
    }

    return this.toCreateResult(
      persisted.diary,
      persisted.outcome === "created",
      persisted.outcome === "replayed",
    );
  }

  async createMcpDiary(
    context: AuthenticatedDiaryContext,
    input: CreateDiaryInput,
  ): Promise<CreateDiaryResult> {
    const userId = await this.requireActiveUser(context.userId);
    const normalized = this.normalizeInput(userId, input);
    const requestSummary = this.createAuditSummary(normalized);
    const persisted = await this.repository.createDiaryWithAudit(
      normalized,
      requestSummary,
      { mcpWriteIdempotency: true },
    );

    if (persisted.outcome === "conflict") {
      throw new DiaryDomainError(
        "IDEMPOTENCY_CONFLICT",
        "The idempotency key was already used for different diary content.",
      );
    }

    return this.toCreateResult(
      persisted.diary,
      persisted.outcome === "created",
      persisted.outcome === "replayed",
    );
  }

  async listDiaries(
    input: ListDiariesInput,
  ): Promise<ListDiariesResult> {
    const userId = await this.requireActiveUser(input.userId);
    const limit = this.resolveLimit(input.limit);
    const query = this.normalizeListQuery(input.query ?? {});

    const [diaries, count] = await Promise.all([
      this.repository.findDiaryEntries(
        userId,
        limit,
        query,
      ),
      this.repository.countDiaryEntries(
        userId,
        query,
      ),
    ]);

    return {
      diaries: diaries.map((diary) =>
        this.toEntryResult(diary),
      ),
      metadata: {
        count,
      },
    };
  }

  async searchDiaryDiscovery(
    input: ListDiariesInput,
  ): Promise<SearchDiaryDiscoveryResult> {
    const userId = await this.requireActiveUser(input.userId);
    const limit = this.resolveLimit(input.limit);
    const query = this.normalizeListQuery(input.query ?? {});
    const [diaries, count] = await Promise.all([
      this.repository.findDiaryEntriesCompact(userId, limit, query),
      this.repository.countDiaryEntries(userId, query),
    ]);
    return {
      diaries: diaries.map((diary) => ({
        id: diary.id,
        title: diary.title,
        date: diary.date,
        tags: diary.tags,
        mood: diary.mood,
        created_at: diary.createdAt.toISOString(),
        updated_at: diary.updatedAt.toISOString(),
        author: diary.author ?? null,
        snippet: diary.bodyMatched
          ? createBodyMatchSnippet(diary.bodyExcerpt, query.q ?? "")
          : null,
      })),
      metadata: { count },
    };
  }

  async listDiaryContentDates(
    input: { userId: string },
  ): Promise<DiaryContentDatesResult> {
    const userId = await this.requireActiveUser(input.userId);
    return {
      dates: await this.repository.listActiveContentDates(userId),
    };
  }

  async listDiariesByDate(
    input: { userId: string; date: string },
  ): Promise<DiariesByDateResult> {
    const userId = await this.requireActiveUser(input.userId);
    const date = this.normalizeDate(input.date);
    const diaries = await this.repository.findActiveByDate(userId, date);
    return {
      date,
      diaries: diaries.map((diary) => this.toEntryResult(diary)),
    };
  }

  async readDiary(
    input: ReadDiaryInput,
  ): Promise<DiaryEntryResult> {
    const id = input.id.trim();

    if (!isUuid(id)) {
      throw new DiaryDomainError(
        "INVALID_DIARY_ID",
        "Diary id must be a UUID returned by search_diary or global_search.",
      );
    }

    const userId = await this.requireActiveUser(input.userId);

    const diary = await this.repository.findDiaryById(
      userId,
      id,
    );

    if (!diary) {
      throw new DiaryDomainError(
        "DIARY_NOT_FOUND",
        "Diary entry was not found.",
      );
    }

    return this.toEntryResult(diary);
  }

  async listArchivedDiaries(input: {
    userId: string;
    limit?: number;
  }): Promise<ListDiariesResult> {
    const userId = await this.requireActiveUser(input.userId);
    const limit = this.resolveLimit(input.limit);
    const [diaries, count] = await Promise.all([
      this.repository.findArchivedDiaries(
        userId,
        limit,
      ),
      this.repository.countArchivedDiaries(userId),
    ]);

    return {
      diaries: diaries.map((diary) => this.toEntryResult(diary)),
      metadata: { count },
    };
  }

  async readArchivedDiary(
    input: ReadDiaryInput,
  ): Promise<DiaryEntryResult> {
    const userId = await this.requireActiveUser(input.userId);
    const id = input.id.trim();

    if (!id) {
      throw new DiaryDomainError(
        "DIARY_NOT_FOUND",
        "Diary entry was not found.",
      );
    }

    const diary = await this.repository.findArchivedDiaryById(
      userId,
      id,
    );
    if (!diary) {
      throw new DiaryDomainError(
        "DIARY_NOT_FOUND",
        "Diary entry was not found.",
      );
    }

    return this.toEntryResult(diary);
  }

  async archiveDiary(input: ReadDiaryInput): Promise<void> {
    const userId = await this.requireActiveUser(input.userId);
    const id = input.id.trim();
    if (!id) {
      throw new DiaryDomainError(
        "DIARY_NOT_FOUND",
        "Diary entry was not found.",
      );
    }

    const archived = await this.repository.archiveDiary({
      userId,
      id,
      ...WEB_USER_LIFECYCLE_CONTEXT,
    });
    if (!archived) {
      throw new DiaryDomainError(
        "DIARY_NOT_FOUND",
        "Diary entry was not found.",
      );
    }
  }

  async restoreDiary(input: ReadDiaryInput): Promise<void> {
    const userId = await this.requireActiveUser(input.userId);
    const id = input.id.trim();
    if (!id) {
      throw new DiaryDomainError(
        "DIARY_NOT_FOUND",
        "Diary entry was not found.",
      );
    }

    const restored = await this.repository.restoreDiary({
      userId,
      id,
      ...WEB_USER_LIFECYCLE_CONTEXT,
    });
    if (!restored) {
      throw new DiaryDomainError(
        "DIARY_NOT_FOUND",
        "Diary entry was not found.",
      );
    }
  }

  async permanentlyDeleteDiary(input: ReadDiaryInput): Promise<void> {
    const userId = await this.requireActiveUser(input.userId);
    const id = input.id.trim();
    if (!id) {
      throw new DiaryDomainError(
        "DIARY_NOT_FOUND",
        "Diary entry was not found.",
      );
    }

    const permanentlyDelete = this.repository.permanentlyDeleteDiary;
    if (!permanentlyDelete) {
      throw new DiaryDomainError(
        "DIARY_NOT_FOUND",
        "Diary entry was not found.",
      );
    }

    const deleted = await permanentlyDelete.call(this.repository, {
      userId,
      id,
      ...WEB_USER_LIFECYCLE_CONTEXT,
    });
    if (!deleted) {
      throw new DiaryDomainError(
        "DIARY_NOT_FOUND",
        "Diary entry was not found.",
      );
    }
  }

  async createWebDiary(
    input: CreateWebDiaryInput,
  ): Promise<DiaryEntryResult> {
    const created = await this.createDiary(
      {
        userId: input.userId,
      },
      {
        title: input.title,
        content: input.content,
        date: input.date,
        tags: input.tags ?? [],
        mood: input.mood,
        idempotencyKey: `web:${randomUUID()}`,
        author: input.author,
      },
    );

    const diary = await this.repository.findDiaryById(
      input.userId.trim(),
      created.diary.id,
    );

    if (!diary) {
      throw new DiaryDomainError(
        "DIARY_NOT_FOUND",
        "Created diary entry could not be read.",
      );
    }

    return this.toEntryResult(diary);
  }

  async updateWebDiary(
    input: UpdateWebDiaryInput,
  ): Promise<DiaryEntryResult> {
    const userId = await this.requireActiveUser(input.userId);
    const id = input.id.trim();

    if (!id) {
      throw new DiaryDomainError(
        "DIARY_NOT_FOUND",
        "Diary entry was not found.",
      );
    }

    const normalized = this.normalizeDiaryFields({
      title: input.title,
      content: input.content,
      date: input.date,
      tags: input.tags ?? [],
      mood: input.mood,
    });

    const existing = await this.repository.findDiaryById(userId, id);
    if (!existing) {
      throw new DiaryDomainError(
        "DIARY_NOT_FOUND",
        "Diary entry was not found.",
      );
    }
    const author = input.author ?? existing.author ?? null;
    this.requireAuthor(author);

    const updated = await this.repository.updateDiary({
      userId,
      id,
      title: normalized.title,
      content: normalized.content,
      date: normalized.date,
      tags: normalized.tags,
      mood: normalized.mood,
      author,
    });

    if (!updated) {
      throw new DiaryDomainError(
        "DIARY_NOT_FOUND",
        "Diary entry was not found.",
      );
    }

    return this.toEntryResult(updated);
  }

  async updateMcpDiary(
    context: AuthenticatedDiaryContext,
    input: UpdateMcpDiaryInput,
  ): Promise<DiaryEntryResult> {
    const userId = await this.requireActiveUser(context.userId);
    const id = input.id.trim();
    if (!id) {
      throw new DiaryDomainError("DIARY_NOT_FOUND", "Diary entry was not found.");
    }

    let hasPatch = false;
    const patch: Omit<UpdateDiaryInput, "userId" | "id"> = {};
    if (input.title !== undefined) {
      patch.title = this.normalizeRequiredText(input.title, MAX_TITLE_LENGTH, "INVALID_TITLE", "Diary title");
      hasPatch = true;
    }
    if (input.content !== undefined) {
      patch.content = this.normalizeRequiredText(input.content, MAX_CONTENT_LENGTH, "INVALID_CONTENT", "Diary content");
      hasPatch = true;
    }
    if (input.date !== undefined) {
      patch.date = this.normalizeDate(input.date);
      hasPatch = true;
    }
    if (input.tags !== undefined) {
      patch.tags = this.normalizeTags(input.tags);
      hasPatch = true;
    }
    if (input.mood !== undefined) {
      patch.mood = this.normalizeMood(input.mood);
      hasPatch = true;
    }
    if (input.author !== undefined) {
      if (!isContentAuthor(input.author)) {
        throw new DiaryDomainError("AUTHOR_REQUIRED", "Diary author must be L, G, or C.");
      }
      patch.author = input.author;
      hasPatch = true;
    }
    if (!hasPatch) {
      throw new DiaryDomainError(
        "INVALID_DIARY_PATCH",
        "At least one Diary field must be supplied.",
      );
    }

    const updated = await this.repository.updateDiary({ userId, id, ...patch });
    if (!updated) {
      throw new DiaryDomainError("DIARY_NOT_FOUND", "Diary entry was not found.");
    }
    return this.readDiary({ userId, id });
  }

  private async requireActiveUser(
    userId: string,
  ): Promise<string> {
    const normalized = this.requireAuthenticatedUserId(userId);
    const user = await this.repository.findUserById(normalized);

    if (!user) {
      throw new DiaryDomainError(
        "USER_NOT_FOUND",
        "User was not found.",
      );
    }

    if (user.status !== "active") {
      throw new DiaryDomainError(
        "USER_DISABLED",
        "User is disabled.",
      );
    }

    return normalized;
  }

  private requireAuthenticatedUserId(userId: string): string {
    const normalized = userId.trim();

    if (normalized.length === 0) {
      throw new DiaryDomainError(
        "INVALID_AUTHENTICATED_USER",
        "Authenticated user is required.",
      );
    }

    return normalized;
  }

  private requireAuthor(value: unknown): asserts value is ContentAuthor {
    if (!isContentAuthor(value)) {
      throw new DiaryDomainError(
        "AUTHOR_REQUIRED",
        "A content author must be selected.",
      );
    }
  }

  private normalizeInput(
    userId: string,
    input: CreateDiaryInput,
  ): NormalizedDiaryCreate {
    const normalized = this.normalizeDiaryFields(input);
    this.requireAuthor(input.author);
    const idempotencyKey = this.normalizeIdempotencyKey(
      input.idempotencyKey,
    );

    const hashPayload = {
      title: normalized.title,
      content: normalized.content,
      date: normalized.date,
      tags: normalized.tags,
      mood: normalized.mood,
      author: input.author!,
    };

    const requestHash = createHash("sha256")
      .update(JSON.stringify(hashPayload), "utf8")
      .digest("hex");

    return {
      userId,
      title: normalized.title,
      content: normalized.content,
      date: normalized.date,
      tags: normalized.tags,
      mood: normalized.mood,
      author: input.author,
      idempotencyKey,
      requestHash,
      mcpRequestHash: hashMcpWriteRequest(hashPayload),
    };
  }

  private normalizeDiaryFields(input: {
    title: string;
    content: string;
    date: string;
    tags: readonly string[];
    mood?: string | null;
    author?: ContentAuthor;
  }): {
    title: string;
    content: string;
    date: string;
    tags: string[];
    mood: string | null;
  } {
    return {
      title: this.normalizeRequiredText(
        input.title,
        MAX_TITLE_LENGTH,
        "INVALID_TITLE",
        "Diary title",
      ),
      content: this.normalizeRequiredText(
        input.content,
        MAX_CONTENT_LENGTH,
        "INVALID_CONTENT",
        "Diary content",
      ),
      date: this.normalizeDate(input.date),
      tags: this.normalizeTags(input.tags),
      mood: this.normalizeMood(input.mood),
    };
  }

  private normalizeRequiredText(
    value: string,
    maxLength: number,
    code: "INVALID_TITLE" | "INVALID_CONTENT",
    label: string,
  ): string {
    const normalized = value.normalize("NFC").trim();

    if (
      normalized.length === 0 ||
      normalized.length > maxLength
    ) {
      throw new DiaryDomainError(
        code,
        `${label} must contain between 1 and ${maxLength} characters.`,
      );
    }

    return normalized;
  }

  private normalizeDate(value: string): string {
    const normalized = value.trim();

    if (!DATE_PATTERN.test(normalized)) {
      throw new DiaryDomainError(
        "INVALID_DATE",
        "Diary date must use YYYY-MM-DD format.",
      );
    }

    const [year, month, day] = normalized
      .split("-")
      .map(Number);

    const parsed = new Date(
      Date.UTC(year!, month! - 1, day!),
    );

    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() + 1 !== month ||
      parsed.getUTCDate() !== day
    ) {
      throw new DiaryDomainError(
        "INVALID_DATE",
        "Diary date is not valid.",
      );
    }

    return normalized;
  }

  private normalizeTags(tags: readonly string[]): string[] {
    if (!Array.isArray(tags)) {
      throw new DiaryDomainError(
        "INVALID_TAGS",
        "Diary tags must be an array.",
      );
    }

    const normalized = [
      ...new Set(
        tags.map((tag) => {
          const value = tag.normalize("NFC").trim();

          if (
            value.length === 0 ||
            value.length > MAX_TAG_LENGTH
          ) {
            throw new DiaryDomainError(
              "INVALID_TAGS",
              `Each diary tag must contain between 1 and ${MAX_TAG_LENGTH} characters.`,
            );
          }

          return value;
        }),
      ),
    ];

    if (normalized.length > MAX_TAGS) {
      throw new DiaryDomainError(
        "INVALID_TAGS",
        `Diary entries may contain at most ${MAX_TAGS} tags.`,
      );
    }

    return normalized;
  }

  private normalizeMood(
    mood?: string | null,
  ): string | null {
    if (mood === undefined || mood === null) {
      return null;
    }

    const normalized = mood.normalize("NFC").trim();

    if (
      normalized.length === 0 ||
      normalized.length > MAX_MOOD_LENGTH
    ) {
      throw new DiaryDomainError(
        "INVALID_MOOD",
        `Diary mood must contain between 1 and ${MAX_MOOD_LENGTH} characters.`,
      );
    }

    return normalized;
  }

  private normalizeListQuery(
    input: RawDiaryListQuery,
  ): DiaryListQuery {
    const q = this.normalizeOptionalQueryText(
      input.q,
      MAX_SEARCH_LENGTH,
      "search query",
    );
    const tag = this.normalizeOptionalQueryText(
      input.tag,
      MAX_TAG_LENGTH,
      "tag",
    );
    const mood = this.normalizeOptionalQueryText(
      input.mood,
      MAX_MOOD_LENGTH,
      "mood",
    );
    const author = this.normalizeOptionalQueryAuthor(input.author);
    const dateFrom = this.normalizeOptionalQueryDate(
      input.dateFrom,
      "date_from",
    );
    const dateTo = this.normalizeOptionalQueryDate(
      input.dateTo,
      "date_to",
    );

    if (dateFrom && dateTo && dateFrom > dateTo) {
      throw new DiaryDomainError(
        "INVALID_DIARY_QUERY",
        "date_from cannot be later than date_to.",
      );
    }

    return {
      ...(q ? { q } : {}),
      ...(tag ? { tag } : {}),
      ...(mood ? { mood } : {}),
      ...(author ? { author } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    };
  }

  private normalizeOptionalQueryText(
    value: string | undefined,
    maxLength: number,
    label: string,
  ): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") {
      throw new DiaryDomainError(
        "INVALID_DIARY_QUERY",
        `Diary ${label} is invalid.`,
      );
    }

    const normalized = value.normalize("NFC").trim();
    if (!normalized) return undefined;
    if (normalized.length > maxLength) {
      throw new DiaryDomainError(
        "INVALID_DIARY_QUERY",
        `Diary ${label} is too long.`,
      );
    }
    return normalized;
  }

  private normalizeOptionalQueryAuthor(
    value: unknown,
  ): ContentAuthor | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") {
      throw new DiaryDomainError(
        "INVALID_DIARY_QUERY",
        "Diary author is invalid.",
      );
    }

    const normalized = value.normalize("NFC").trim();
    if (!isContentAuthor(normalized)) {
      throw new DiaryDomainError(
        "INVALID_DIARY_QUERY",
        "Diary author is invalid.",
      );
    }

    return normalized;
  }

  private normalizeOptionalQueryDate(
    value: string | undefined,
    label: string,
  ): string | undefined {
    if (value === undefined || value.trim() === "") return undefined;
    try {
      return this.normalizeDate(value);
    } catch {
      throw new DiaryDomainError(
        "INVALID_DIARY_QUERY",
        `Diary ${label} is invalid.`,
      );
    }
  }

  private normalizeIdempotencyKey(value: string): string {
    const normalized = value.trim();

    if (
      normalized.length < MIN_IDEMPOTENCY_KEY_LENGTH ||
      normalized.length > MAX_IDEMPOTENCY_KEY_LENGTH ||
      !IDEMPOTENCY_KEY_PATTERN.test(normalized)
    ) {
      throw new DiaryDomainError(
        "INVALID_IDEMPOTENCY_KEY",
        "Idempotency key must be 16-128 characters using letters, numbers, dot, underscore, colon, or hyphen.",
      );
    }

    return normalized;
  }

  private resolveLimit(limit?: number): number {
    if (limit === undefined) {
      return DEFAULT_DIARY_LIMIT;
    }

    if (!Number.isInteger(limit) || limit < 1) {
      throw new DiaryDomainError(
        "INVALID_DIARY_LIMIT",
        "Diary limit must be a positive integer.",
      );
    }

    return Math.min(limit, MAX_DIARY_LIMIT);
  }

  private createAuditSummary(
    diary: NormalizedDiaryCreate,
  ): DiaryAuditRequestSummary {
    return {
      title_length: diary.title.length,
      content_length: diary.content.length,
      date: diary.date,
      tag_count: diary.tags.length,
      has_mood: diary.mood !== null,
    };
  }

  private toCreateResult(
    diary: DiaryRecord,
    created: boolean,
    idempotentReplay: boolean,
  ): CreateDiaryResult {
    return {
      diary: {
        id: diary.id,
        title: diary.title,
        date: diary.date,
        tags: diary.tags,
        mood: diary.mood,
        author: diary.author ?? null,
        created_at: diary.createdAt.toISOString(),
      },
      metadata: {
        created,
        idempotent_replay: idempotentReplay,
      },
    };
  }

  private toEntryResult(
    diary: DiaryEntryRecord,
  ): DiaryEntryResult {
    return {
      id: diary.id,
      title: diary.title,
      content: diary.content,
      date: diary.date,
      tags: diary.tags,
      mood: diary.mood,
      author: diary.author ?? null,
      created_at: diary.createdAt.toISOString(),
      updated_at: diary.updatedAt.toISOString(),
    };
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
