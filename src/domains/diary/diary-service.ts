import { createHash } from "node:crypto";
import type {
  DiaryAuditRequestSummary,
  DiaryRecord,
  DiaryRepository,
  NormalizedDiaryCreate,
} from "./diary-repository.js";

const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 20_000;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;
const MAX_MOOD_LENGTH = 50;
const MIN_IDEMPOTENCY_KEY_LENGTH = 16;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
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

export type DiaryDomainErrorCode =
  | "INVALID_AUTHENTICATED_USER"
  | "USER_NOT_FOUND"
  | "USER_DISABLED"
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
    const userId = this.requireAuthenticatedUserId(context.userId);
    const user = await this.repository.findUserById(userId);

    if (!user) {
      throw new DiaryDomainError("USER_NOT_FOUND", "User was not found.");
    }

    if (user.status !== "active") {
      throw new DiaryDomainError("USER_DISABLED", "User is disabled.");
    }

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

    return this.toResult(
      persisted.diary,
      persisted.outcome === "created",
      persisted.outcome === "replayed",
    );
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
    const title = this.normalizeRequiredText(
      input.title,
      MAX_TITLE_LENGTH,
      "INVALID_TITLE",
      "Diary title",
    );
    const content = this.normalizeRequiredText(
      input.content,
      MAX_CONTENT_LENGTH,
      "INVALID_CONTENT",
      "Diary content",
    );
    const date = this.normalizeDate(input.date);
    const tags = this.normalizeTags(input.tags);
    const mood = this.normalizeMood(input.mood);
    const idempotencyKey = this.normalizeIdempotencyKey(input.idempotencyKey);
    const hashPayload = { title, content, date, tags, mood };
    const requestHash = createHash("sha256")
      .update(JSON.stringify(hashPayload), "utf8")
      .digest("hex");

    return {
      userId,
      title,
      content,
      date,
      tags,
      mood,
      idempotencyKey,
      requestHash,
    };
  }

  private normalizeRequiredText(
    value: string,
    maxLength: number,
    code: "INVALID_TITLE" | "INVALID_CONTENT",
    label: string,
  ): string {
    const normalized = value.normalize("NFC").trim();

    if (normalized.length === 0 || normalized.length > maxLength) {
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

    const [year, month, day] = normalized.split("-").map(Number);
    const parsed = new Date(Date.UTC(year!, month! - 1, day!));

    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() + 1 !== month ||
      parsed.getUTCDate() !== day
    ) {
      throw new DiaryDomainError("INVALID_DATE", "Diary date is not valid.");
    }

    return normalized;
  }

  private normalizeTags(tags: readonly string[]): string[] {
    if (!Array.isArray(tags)) {
      throw new DiaryDomainError("INVALID_TAGS", "Diary tags must be an array.");
    }

    const normalized = [
      ...new Set(
        tags.map((tag) => {
          const value = tag.normalize("NFC").trim();

          if (value.length === 0 || value.length > MAX_TAG_LENGTH) {
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

  private normalizeMood(mood?: string | null): string | null {
    if (mood === undefined || mood === null) {
      return null;
    }

    const normalized = mood.normalize("NFC").trim();

    if (normalized.length === 0 || normalized.length > MAX_MOOD_LENGTH) {
      throw new DiaryDomainError(
        "INVALID_MOOD",
        `Diary mood must contain between 1 and ${MAX_MOOD_LENGTH} characters.`,
      );
    }

    return normalized;
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

  private toResult(
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
}
