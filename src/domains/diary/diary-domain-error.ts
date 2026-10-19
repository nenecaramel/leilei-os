export type DiaryDomainErrorCode =
  | "AUTHOR_REQUIRED"
  | "INVALID_AUTHENTICATED_USER"
  | "USER_NOT_FOUND"
  | "USER_DISABLED"
  | "DIARY_NOT_FOUND"
  | "INVALID_DIARY_ID"
  | "INVALID_DIARY_LIMIT"
  | "INVALID_DIARY_OFFSET"
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

