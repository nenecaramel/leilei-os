import { createHash, randomUUID } from "node:crypto";
import type {
  DiaryAuditRequestSummary,
  DiaryEntryRecord,
  DiaryRecord,
  DiaryRepository,
  DiaryListQuery,
  NormalizedDiaryCreate,
} from "./diary-repository.js";

const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 20_000;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;
const MAX_MOOD_LENGTH = 50;
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
};

export type CreateDiaryResult = {
  diary: {
    id: string;
    title: string;
    date: string;
    tags: string[];
    mood: string | null;
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
  dateFrom?: string;
  dateTo?: string;
};

export type ListDiariesResult = {
  diaries: DiaryEntryResult[];
  metadata: {
    count: number;
  };
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
};

export type UpdateWebDiaryInput = {
  userId: string;
  id: string;
  title: string;
  content: string;
  date: string;
  tags?: readonly string[];
  mood?: string | null;
};

export type DiaryDomainErrorCode =
  | "INVALID_AUTHENTICATED_USER"
  | "USER_NOT_FOUND"
  | "USER_DISABLED"
  | "DIARY_NOT_FOUND"
  | "INVALID_DIARY_LIMIT"
  | "INVALID_DIARY_QUERY"
  | "INVALID_TITLE"
  | "INVALID_CONTENT"
  | "INVALID_DATE"
  | "INVALID_TAGS"
  | "INVALID_MOOD"
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

  async listDiaries(
    input: ListDiariesInput,
  ): Promise<ListDiariesResult> {
    const userId = await this.requireActiveUser(input.userId);
    const limit = this.resolveLimit(input.limit);
    const query = this.normalizeListQuery(input.query ?? {});

    const diaries = await this.repository.findDiaryEntries(
      userId,
      limit,
      query,
    );

    return {
      diaries: diaries.map((diary) =>
        this.toEntryResult(diary),
      ),
      metadata: {
        count: diaries.length,
      },
    };
  }

  async readDiary(
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
    const diaries = await this.repository.findArchivedDiaries(
      userId,
      limit,
    );

    return {
      diaries: diaries.map((diary) => this.toEntryResult(diary)),
      metadata: { count: diaries.length },
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
      actorType: "user",
      channel: "web",
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
      actorType: "user",
      channel: "web",
    });
    if (!restored) {
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

    const updated = await this.repository.updateDiary({
      userId,
      id,
      title: normalized.title,
      content: normalized.content,
      date: normalized.date,
      tags: normalized.tags,
      mood: normalized.mood,
    });

    if (!updated) {
      throw new DiaryDomainError(
        "DIARY_NOT_FOUND",
        "Diary entry was not found.",
      );
    }

    return this.toEntryResult(updated);
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

  private normalizeInput(
    userId: string,
    input: CreateDiaryInput,
  ): NormalizedDiaryCreate {
    const normalized = this.normalizeDiaryFields(input);
    const idempotencyKey = this.normalizeIdempotencyKey(
      input.idempotencyKey,
    );

    const hashPayload = {
      title: normalized.title,
      content: normalized.content,
      date: normalized.date,
      tags: normalized.tags,
      mood: normalized.mood,
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
      idempotencyKey,
      requestHash,
    };
  }

  private normalizeDiaryFields(input: {
    title: string;
    content: string;
    date: string;
    tags: readonly string[];
    mood?: string | null;
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
      created_at: diary.createdAt.toISOString(),
      updated_at: diary.updatedAt.toISOString(),
    };
  }
}
