import { DIARY_TITLE_MAX_LENGTH, DIARY_CONTENT_MAX_LENGTH } from "../resource-limits.js";
import { DiaryDomainError } from "./diary-domain-error.js";
export { DiaryDomainError, type DiaryDomainErrorCode } from "./diary-domain-error.js";
import {
  requireAuthenticatedUserId,
  requireAuthor,
  normalizeInput,
  normalizeDiaryFields,
  normalizeRequiredText,
  normalizeDate,
  normalizeTags,
  normalizeMood,
  normalizeListQuery,
  resolveOffset,
  resolveLimit,
} from "./diary-validation.js";
import { randomUUID } from "node:crypto";
import type {
  DiaryAuditRequestSummary,
  DiaryEntryRecord,
  DiaryRecord,
  DiaryRepository,
  DiaryLifecycleMutationInput,
  NormalizedDiaryCreate,
  UpdateDiaryInput,
} from "./diary-repository.js";
import { createBodyMatchSnippet } from "../compact-text.js";
import { WEB_USER_LIFECYCLE_CONTEXT } from "../lifecycle/lifecycle-audit-repository.js";
import {
  isContentAuthor,
  type ContentAuthor,
} from "../content-author.js";

type DiaryLifecycleAttribution = Pick<
  DiaryLifecycleMutationInput,
  "actorType" | "channel"
>;

const MCP_USER_LIFECYCLE_CONTEXT = {
  actorType: "user",
  channel: "mcp",
} as const satisfies DiaryLifecycleAttribution;

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
  offset?: number;
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

export class DiaryService {
  constructor(private readonly repository: DiaryRepository) {}

  async createDiary(
    context: AuthenticatedDiaryContext,
    input: CreateDiaryInput,
  ): Promise<CreateDiaryResult> {
    const userId = await this.requireActiveUser(context.userId);
    const normalized = normalizeInput(userId, input);
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
    const normalized = normalizeInput(userId, input);
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
    const limit = resolveLimit(input.limit);
    const offset = resolveOffset(input.offset);
    const query = normalizeListQuery(input.query ?? {});

    const [diaries, count] = await Promise.all([
      this.repository.findDiaryEntries(
        userId,
        limit,
        query,
        offset,
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
    const limit = resolveLimit(input.limit);
    const offset = resolveOffset(input.offset);
    const query = normalizeListQuery(input.query ?? {});
    const [diaries, count] = await Promise.all([
      this.repository.findDiaryEntriesCompact(userId, limit, query, offset),
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
    const date = normalizeDate(input.date);
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
    const limit = resolveLimit(input.limit);
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
    await this.archiveDiaryWithContext(
      input,
      WEB_USER_LIFECYCLE_CONTEXT,
    );
  }

  async archiveMcpDiary(
    context: AuthenticatedDiaryContext,
    input: { id: string },
  ): Promise<void> {
    await this.archiveDiaryWithContext(
      { userId: context.userId, id: input.id },
      MCP_USER_LIFECYCLE_CONTEXT,
    );
  }

  async restoreDiary(input: ReadDiaryInput): Promise<void> {
    await this.restoreDiaryWithContext(
      input,
      WEB_USER_LIFECYCLE_CONTEXT,
    );
  }

  async restoreMcpDiary(
    context: AuthenticatedDiaryContext,
    input: { id: string },
  ): Promise<void> {
    await this.restoreDiaryWithContext(
      { userId: context.userId, id: input.id },
      MCP_USER_LIFECYCLE_CONTEXT,
    );
  }

  async permanentlyDeleteDiary(input: ReadDiaryInput): Promise<void> {
    await this.permanentlyDeleteDiaryWithContext(
      input,
      WEB_USER_LIFECYCLE_CONTEXT,
    );
  }

  async permanentlyDeleteMcpDiary(
    context: AuthenticatedDiaryContext,
    input: { id: string },
  ): Promise<void> {
    await this.permanentlyDeleteDiaryWithContext(
      { userId: context.userId, id: input.id },
      MCP_USER_LIFECYCLE_CONTEXT,
    );
  }

  private async archiveDiaryWithContext(
    input: ReadDiaryInput,
    attribution: DiaryLifecycleAttribution,
  ): Promise<void> {
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
      ...attribution,
    });
    if (!archived) {
      throw new DiaryDomainError(
        "DIARY_NOT_FOUND",
        "Diary entry was not found.",
      );
    }
  }

  private async restoreDiaryWithContext(
    input: ReadDiaryInput,
    attribution: DiaryLifecycleAttribution,
  ): Promise<void> {
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
      ...attribution,
    });
    if (!restored) {
      throw new DiaryDomainError(
        "DIARY_NOT_FOUND",
        "Diary entry was not found.",
      );
    }
  }

  private async permanentlyDeleteDiaryWithContext(
    input: ReadDiaryInput,
    attribution: DiaryLifecycleAttribution,
  ): Promise<void> {
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
      ...attribution,
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

    const normalized = normalizeDiaryFields({
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
    requireAuthor(author);

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
      patch.title = normalizeRequiredText(input.title, DIARY_TITLE_MAX_LENGTH, "INVALID_TITLE", "Diary title");
      hasPatch = true;
    }
    if (input.content !== undefined) {
      patch.content = normalizeRequiredText(input.content, DIARY_CONTENT_MAX_LENGTH, "INVALID_CONTENT", "Diary content");
      hasPatch = true;
    }
    if (input.date !== undefined) {
      patch.date = normalizeDate(input.date);
      hasPatch = true;
    }
    if (input.tags !== undefined) {
      patch.tags = normalizeTags(input.tags);
      hasPatch = true;
    }
    if (input.mood !== undefined) {
      patch.mood = normalizeMood(input.mood);
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
    const normalized = requireAuthenticatedUserId(userId);
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
