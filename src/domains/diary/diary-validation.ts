import { createHash } from "node:crypto";
import { isContentAuthor, type ContentAuthor } from "../content-author.js";
import type { DiaryListQuery, NormalizedDiaryCreate } from "./diary-repository.js";
import type { CreateDiaryInput, RawDiaryListQuery } from "./diary-service.js";
import { DiaryDomainError } from "./diary-domain-error.js";
import { hashMcpWriteRequest } from "../mcp-write/mcp-write-idempotency.js";
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

export function requireAuthenticatedUserId(userId: string): string {
  const normalized = userId.trim();

  if (normalized.length === 0) {
    throw new DiaryDomainError(
      "INVALID_AUTHENTICATED_USER",
      "Authenticated user is required.",
    );
  }

  return normalized;
}

export function requireAuthor(value: unknown): asserts value is ContentAuthor {
  if (!isContentAuthor(value)) {
    throw new DiaryDomainError(
      "AUTHOR_REQUIRED",
      "A content author must be selected.",
    );
  }
}

export function normalizeInput(
  userId: string,
  input: CreateDiaryInput,
): NormalizedDiaryCreate {
  const normalized = normalizeDiaryFields(input);
  requireAuthor(input.author);
  const idempotencyKey = normalizeIdempotencyKey(
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

export function normalizeDiaryFields(input: {
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
    title: normalizeRequiredText(
      input.title,
      MAX_TITLE_LENGTH,
      "INVALID_TITLE",
      "Diary title",
    ),
    content: normalizeRequiredText(
      input.content,
      MAX_CONTENT_LENGTH,
      "INVALID_CONTENT",
      "Diary content",
    ),
    date: normalizeDate(input.date),
    tags: normalizeTags(input.tags),
    mood: normalizeMood(input.mood),
  };
}

export function normalizeRequiredText(
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

export function normalizeDate(value: string): string {
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

export function normalizeTags(tags: readonly string[]): string[] {
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

export function normalizeMood(
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

export function normalizeListQuery(
  input: RawDiaryListQuery,
): DiaryListQuery {
  const q = normalizeOptionalQueryText(
    input.q,
    MAX_SEARCH_LENGTH,
    "search query",
  );
  const tag = normalizeOptionalQueryText(
    input.tag,
    MAX_TAG_LENGTH,
    "tag",
  );
  const mood = normalizeOptionalQueryText(
    input.mood,
    MAX_MOOD_LENGTH,
    "mood",
  );
  const author = normalizeOptionalQueryAuthor(input.author);
  const dateFrom = normalizeOptionalQueryDate(
    input.dateFrom,
    "date_from",
  );
  const dateTo = normalizeOptionalQueryDate(
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

function normalizeOptionalQueryText(
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

function normalizeOptionalQueryAuthor(
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

function normalizeOptionalQueryDate(
  value: string | undefined,
  label: string,
): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  try {
    return normalizeDate(value);
  } catch {
    throw new DiaryDomainError(
      "INVALID_DIARY_QUERY",
      `Diary ${label} is invalid.`,
    );
  }
}

function normalizeIdempotencyKey(value: string): string {
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

export function resolveOffset(offset?: number): number {
  if (offset === undefined) {
    return 0;
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new DiaryDomainError(
      "INVALID_DIARY_OFFSET",
      "Diary offset must be a non-negative integer.",
    );
  }

  return offset;
}

export function resolveLimit(limit?: number): number {
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
