import type { WebApiClient } from "../api/useWebApiClient";

export type ConversationProvider = "chatgpt" | "claude";
export type ConversationListItem = {
  id: string;
  provider: ConversationProvider;
  sourceConversationId: string;
  title: string | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  defaultModel: string | null;
  currentLeafSourceNodeId: string | null;
  messageCount: number;
  turnCount: number;
  totalNodeCount: number;
  archivedAt?: string | null;
  deletedAt?: string | null;
};
export type ConversationDetail = ConversationListItem & {
  providerMetadata: Record<string, unknown>;
};
export type ConversationMessage = {
  id: string;
  sourceNodeId: string;
  sourceMessageId: string | null;
  parentSourceNodeId: string | null;
  role: "user" | "assistant" | "system" | "tool" | "reasoning" | "unknown";
  rawRole: string | null;
  model: string | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  isCurrentPath: boolean;
  currentPathIndex: number | null;
  turnIndex: number | null;
  isPrimary: boolean;
  displayText: string;
};
export type ConversationSearchResult = {
  messageId: string;
  conversationId: string;
  provider: ConversationProvider;
  conversationTitle: string | null;
  sourceNodeId: string;
  role: "user" | "assistant";
  model: string | null;
  sourceCreatedAt: string | null;
  isCurrentPath: boolean;
  snippet: string;
};

export type ConversationMessageContext = {
  items: ConversationMessage[];
  total: number;
  offset: number;
  anchorIndex: number;
};

export type MergeCounts = {
  create: number;
  update: number;
  unchanged: number;
  stale: number;
};
export type ConversationImportSummary = {
  conversations: MergeCounts;
  messages: MergeCounts & { path_changed: number };
};
export type ConversationImportPreview = {
  import_run_id: string;
  source_id: string;
  provider: ConversationProvider;
  parser_version: string;
  filename: string;
  raw_sha256: string;
  raw_bytes: number;
  source_reused: boolean;
  already_executed: boolean;
  preview_fingerprint: string;
  summary: ConversationImportSummary;
  warning_count: number;
  warning_codes: Record<string, number>;
  exclusions: ConversationExclusionSummary;
};
export type ConversationExclusionSummary = {
  conversations: number;
  messages: number;
  branch_roots: number;
};

export type ConversationPruneConversationResult = {
  provider: ConversationProvider;
  sourceConversationId: string;
  deletedMessages: number;
  rawSourcePreserved: true;
  deletedAt?: string;
};

export type ConversationPruneBranchResult = {
  provider: ConversationProvider;
  sourceConversationId: string;
  sourceNodeId: string;
  deletedMessages: number;
  remainingMessages: number;
  currentLeafSourceNodeId: string | null;
  rawSourcePreserved: true;
  deletedAt?: string;
};

export type ConversationDeletedBranch = {
  id: string;
  conversationId: string;
  provider: ConversationProvider;
  sourceConversationId: string;
  sourceNodeId: string;
  deletedAt: string;
  createdAt: string;
  deletedMessages: number;
  canonicalConversationExists: boolean;
};

export type ConversationImportExecute = {
  outcome: "executed" | "replayed" | "already_executed";
  import_run_id: string;
  source_id: string;
  provider: ConversationProvider;
  parser_version: string;
  preview_fingerprint: string;
  summary: ConversationImportSummary;
  warning_count: number;
  warning_codes: Record<string, number>;
  exclusions: ConversationExclusionSummary;
};

export type ConversationImportHistoryStatus =
  | "processing"
  | "executed"
  | "failed"
  | "superseded";

export type ConversationImportHistoryRun = {
  id: string;
  sourceId: string;
  parserVersion: string;
  executionKey: string;
  executionMode: "standard" | "reapply";
  status: ConversationImportHistoryStatus;
  rawStatus: "processing" | "executed" | "failed";
  previewFingerprint: string | null;
  warningCount: number;
  createdAt: string;
  completedAt: string | null;
  supersededByImportRunId: string | null;
  summary: Record<string, unknown>;
};

export type ConversationImportSourceHistoryItem = {
  sourceId: string;
  provider: ConversationProvider;
  filename: string;
  rawSha256: string;
  rawBytes: number;
  receivedAt: string;
  rawSource: {
    kind: string | null;
    retained: boolean;
    encoding: "raw" | "gzip" | null;
    storedBytes: number | null;
  };
  runCount: number;
  processingRunCount: number;
  executedRunCount: number;
  failedRunCount: number;
  supersededRunCount: number;
  latestRun: Omit<ConversationImportHistoryRun, "summary"> | null;
};

export type ConversationImportSourceHistoryDetail =
  ConversationImportSourceHistoryItem & {
    runs: ConversationImportHistoryRun[];
  };

export type ConversationImportBatchFileStatus =
  | "pending"
  | "already_executed"
  | "duplicate_in_batch";

export type ConversationImportBatchCounts = {
  total: number;
  unique: number;
  duplicate: number;
  already_executed: number;
  pending: number;
};

export type ConversationImportBatchFilePreview = {
  input_index: number;
  import_run_id: string;
  source_id: string;
  provider: ConversationProvider;
  parser_version: string;
  filename: string;
  raw_sha256: string;
  raw_bytes: number;
  status: ConversationImportBatchFileStatus;
  duplicate_of_import_run_id: string | null;
  executed_run_id: string | null;
  preview_fingerprint: string | null;
  summary: ConversationImportSummary;
  warning_count: number;
  warning_codes: Record<string, number>;
  exclusions: ConversationExclusionSummary;
};

export type ConversationImportBatchPreview = {
  batch_fingerprint: string;
  files: ConversationImportBatchCounts;
  summary: ConversationImportSummary;
  warning_count: number;
  warning_codes: Record<string, number>;
  exclusions: ConversationExclusionSummary;
  items: ConversationImportBatchFilePreview[];
};

export type ConversationImportBatchExecuteResult = {
  outcome: "executed" | "already_executed";
  batch_fingerprint: string;
  files: ConversationImportBatchCounts;
  summary: ConversationImportSummary;
  warning_count: number;
  warning_codes: Record<string, number>;
  exclusions: ConversationExclusionSummary;
  items: Array<{
    input_index: number;
    import_run_id: string;
    source_id: string;
    outcome: "executed" | "already_executed" | "duplicate_in_batch";
    executed_run_id: string;
  }>;
};

export type ConversationFavoriteView = "default" | "all";

export type ConversationFavoriteListItem = {
  id: string;
  provider: ConversationProvider;
  sourceConversationId: string;
  conversationId: string;
  view: ConversationFavoriteView;
  title: string | null;
  note: string | null;
  tags: string[];
  conversationTitleSnapshot: string | null;
  startMessageId: string;
  endMessageId: string;
  startSourceNodeId: string;
  endSourceNodeId: string;
  messageCount: number;
  canonicalConversationExists: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ConversationFavoriteMessage = {
  ordinal: number;
  messageId: string;
  sourceNodeId: string;
  sourceMessageId: string | null;
  role: ConversationMessage["role"];
  model: string | null;
  sourceCreatedAt: string | null;
  displayText: string;
  snapshot: Record<string, unknown>;
  canonicalMessageExists: boolean;
};

export type ConversationFavoriteDetail = ConversationFavoriteListItem & {
  messages: ConversationFavoriteMessage[];
};

type Envelope<T> = { success: true; data: T };

export function createConversationArchiveApi(api: WebApiClient) {
  return {
    async list(input: {
      provider?: ConversationProvider;
      limit?: number;
      offset?: number;
      scope?: "active" | "archived" | "deleted";
    } = {}): Promise<{ items: ConversationListItem[]; total: number }> {
      const params = new URLSearchParams();
      if (input.provider) params.set("provider", input.provider);
      if (input.limit !== undefined) params.set("limit", String(input.limit));
      if (input.offset !== undefined) params.set("offset", String(input.offset));
      if (input.scope && input.scope !== "active") params.set("scope", input.scope);
      const suffix = params.size ? `?${params}` : "";
      const result = await api.request<Envelope<{ items: ConversationListItem[]; total: number }>>(
        `/conversations${suffix}`,
      );
      return result.data;
    },

    async detail(id: string, scope: "active" | "archived" | "deleted" = "active", branchId?: string): Promise<ConversationDetail> {
      const params = new URLSearchParams();
      if (scope !== "active") params.set("scope", scope);
      if (branchId) params.set("branch_id", branchId);
      const suffix = params.size ? `?${params}` : "";
      const result = await api.request<Envelope<ConversationDetail>>(
        `/conversations/${encodeURIComponent(id)}${suffix}`,
      );
      return result.data;
    },

    async messages(input: {
      conversationId: string;
      view?: "default" | "all";
      limit?: number;
      offset?: number;
      scope?: "active" | "archived" | "deleted";
      branchId?: string;
    }): Promise<{ items: ConversationMessage[]; total: number }> {
      const params = new URLSearchParams();
      if (input.view && input.view !== "default") params.set("view", input.view);
      if (input.limit !== undefined) params.set("limit", String(input.limit));
      if (input.offset !== undefined) params.set("offset", String(input.offset));
      if (input.scope && input.scope !== "active") params.set("scope", input.scope);
      if (input.branchId) params.set("branch_id", input.branchId);
      const suffix = params.size ? `?${params}` : "";
      const result = await api.request<Envelope<{ items: ConversationMessage[]; total: number }>>(
        `/conversations/${encodeURIComponent(input.conversationId)}/messages${suffix}`,
      );
      return result.data;
    },

    async search(input: {
      query: string;
      provider?: ConversationProvider;
      role?: "user" | "assistant";
      conversationId?: string;
      from?: string;
      to?: string;
      timeZone?: string;
      limit?: number;
      offset?: number;
      scope?: "active" | "archived" | "deleted";
    }): Promise<{ items: ConversationSearchResult[]; total: number }> {
      const params = new URLSearchParams({ q: input.query });
      if (input.provider) params.set("provider", input.provider);
      if (input.role) params.set("role", input.role);
      if (input.conversationId) params.set("conversation_id", input.conversationId);
      if (input.from) params.set("from", input.from);
      if (input.to) params.set("to", input.to);
      if (input.timeZone) params.set("time_zone", input.timeZone);
      if (input.limit !== undefined) params.set("limit", String(input.limit));
      if (input.offset !== undefined) params.set("offset", String(input.offset));
      if (input.scope && input.scope !== "active") params.set("scope", input.scope);
      const result = await api.request<Envelope<{ items: ConversationSearchResult[]; total: number }>>(
        `/conversations/search?${params}`,
      );
      return result.data;
    },

    async messageContext(input: {
      conversationId: string;
      messageId: string;
      view?: "default" | "all";
      radius?: number;
      scope?: "active" | "archived" | "deleted";
      branchId?: string;
    }): Promise<ConversationMessageContext> {
      const params = new URLSearchParams();
      if (input.view && input.view !== "default") params.set("view", input.view);
      if (input.radius !== undefined) params.set("radius", String(input.radius));
      if (input.scope && input.scope !== "active") params.set("scope", input.scope);
      if (input.branchId) params.set("branch_id", input.branchId);
      const suffix = params.size ? `?${params}` : "";
      const result = await api.request<Envelope<ConversationMessageContext>>(
        `/conversations/${encodeURIComponent(input.conversationId)}/messages/${encodeURIComponent(input.messageId)}/context${suffix}`,
      );
      return result.data;
    },

    async deleteConversation(
      conversationId: string,
    ): Promise<ConversationPruneConversationResult> {
      const result = await api.request<Envelope<ConversationPruneConversationResult>>(
        `/conversations/${encodeURIComponent(conversationId)}`,
        { method: "DELETE" },
      );
      return result.data;
    },

    async deleteBranch(input: {
      conversationId: string;
      messageId: string;
    }): Promise<ConversationPruneBranchResult> {
      const result = await api.request<Envelope<ConversationPruneBranchResult>>(
        `/conversations/${encodeURIComponent(input.conversationId)}/branches/${encodeURIComponent(input.messageId)}`,
        { method: "DELETE" },
      );
      return result.data;
    },

    async archiveConversation(conversationId: string): Promise<{ archived: true }> {
      const result = await api.request<Envelope<{ archived: true }>>(
        `/conversations/${encodeURIComponent(conversationId)}/archive`, { method: "POST" },
      );
      return result.data;
    },

    async restoreConversation(conversationId: string): Promise<{ restored: true }> {
      const result = await api.request<Envelope<{ restored: true }>>(
        `/conversations/${encodeURIComponent(conversationId)}/restore`, { method: "POST" },
      );
      return result.data;
    },

    async restoreDeletedConversation(conversationId: string): Promise<{ restored: true }> {
      const result = await api.request<Envelope<{ restored: true }>>(
        `/conversations/${encodeURIComponent(conversationId)}/restore-deleted`, { method: "POST" },
      );
      return result.data;
    },

    async permanentlyDeleteConversation(conversationId: string): Promise<{ deleted: true; rawSourcePreserved: true }> {
      const result = await api.request<Envelope<{ deleted: true; rawSourcePreserved: true }>>(
        `/conversations/${encodeURIComponent(conversationId)}/permanent-delete`, { method: "POST" },
      );
      return result.data;
    },

    async listArchive(input: { limit?: number; offset?: number } = {}): Promise<{ items: ConversationListItem[]; total: number }> {
      const params = new URLSearchParams();
      if (input.limit !== undefined) params.set("limit", String(input.limit));
      if (input.offset !== undefined) params.set("offset", String(input.offset));
      const suffix = params.size ? `?${params}` : "";
      const result = await api.request<Envelope<{ items: ConversationListItem[]; total: number }>>(`/conversations/archive${suffix}`);
      return result.data;
    },

    async listDeleted(input: { limit?: number; offset?: number } = {}): Promise<{ conversations: { items: ConversationListItem[]; total: number }; branches: { items: ConversationDeletedBranch[]; total: number } }> {
      const params = new URLSearchParams();
      if (input.limit !== undefined) params.set("limit", String(input.limit));
      if (input.offset !== undefined) params.set("offset", String(input.offset));
      const suffix = params.size ? `?${params}` : "";
      const result = await api.request<Envelope<{ conversations: { items: ConversationListItem[]; total: number }; branches: { items: ConversationDeletedBranch[]; total: number } }>>(`/conversations/deleted${suffix}`);
      return result.data;
    },

    async restoreBranch(input: { conversationId: string; branchId: string }): Promise<{ restored: true }> {
      const result = await api.request<Envelope<{ restored: true }>>(`/conversations/${encodeURIComponent(input.conversationId)}/branches/${encodeURIComponent(input.branchId)}/restore`, { method: "POST" });
      return result.data;
    },

    async permanentlyDeleteBranch(input: { conversationId: string; branchId: string }): Promise<{ deleted: true; rawSourcePreserved: true }> {
      const result = await api.request<Envelope<{ deleted: true; rawSourcePreserved: true }>>(`/conversations/${encodeURIComponent(input.conversationId)}/branches/${encodeURIComponent(input.branchId)}/permanent-delete`, { method: "POST" });
      return result.data;
    },

    async restoreExclusion(input: { exclusionId: string; sourceId: string }): Promise<{ restored: true; sourceId: string }> {
      const result = await api.request<Envelope<{ restored: true; sourceId: string }>>(
        `/conversations/exclusions/${encodeURIComponent(input.exclusionId)}/restore`,
        { method: "POST", body: JSON.stringify({ source_id: input.sourceId }) },
      );
      return result.data;
    },

    async preview(file: File): Promise<ConversationImportPreview> {
      const result = await api.request<Envelope<ConversationImportPreview>>(
        "/conversations/import/preview",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Leilei-Filename": encodeURIComponent(file.name),
          },
          body: file,
        },
      );
      return result.data;
    },

    async previewBatch(importRunIds: string[]): Promise<ConversationImportBatchPreview> {
      const result = await api.request<Envelope<ConversationImportBatchPreview>>(
        "/conversations/import/batch/preview",
        {
          method: "POST",
          body: JSON.stringify({ import_run_ids: importRunIds }),
        },
      );
      return result.data;
    },

    async executeBatch(
      preview: ConversationImportBatchPreview,
    ): Promise<ConversationImportBatchExecuteResult> {
      const result = await api.request<Envelope<ConversationImportBatchExecuteResult>>(
        "/conversations/import/batch/execute",
        {
          method: "POST",
          body: JSON.stringify({
            import_run_ids: preview.items
              .slice()
              .sort((left, right) => left.input_index - right.input_index)
              .map((item) => item.import_run_id),
            expected_batch_fingerprint: preview.batch_fingerprint,
          }),
        },
      );
      return result.data;
    },

    async listFavorites(input: {
      provider?: ConversationProvider;
      conversationId?: string;
      tag?: string;
      limit?: number;
      offset?: number;
    } = {}): Promise<{ items: ConversationFavoriteListItem[]; total: number }> {
      const params = new URLSearchParams();
      if (input.provider) params.set("provider", input.provider);
      if (input.conversationId) params.set("conversation_id", input.conversationId);
      if (input.tag) params.set("tag", input.tag);
      if (input.limit !== undefined) params.set("limit", String(input.limit));
      if (input.offset !== undefined) params.set("offset", String(input.offset));
      const suffix = params.size ? `?${params}` : "";
      const result = await api.request<
        Envelope<{ items: ConversationFavoriteListItem[]; total: number }>
      >(`/conversations/favorites${suffix}`);
      return result.data;
    },

    async createFavorite(input: {
      conversationId: string;
      startMessageId: string;
      endMessageId?: string;
      view?: ConversationFavoriteView;
      title?: string;
      note?: string;
      tags?: string[];
    }): Promise<ConversationFavoriteDetail> {
      const result = await api.request<Envelope<ConversationFavoriteDetail>>(
        "/conversations/favorites",
        {
          method: "POST",
          body: JSON.stringify({
            conversation_id: input.conversationId,
            start_message_id: input.startMessageId,
            ...(input.endMessageId ? { end_message_id: input.endMessageId } : {}),
            view: input.view ?? "default",
            title: input.title ?? "",
            note: input.note ?? "",
            tags: input.tags ?? [],
          }),
        },
      );
      return result.data;
    },

    async favoriteDetail(favoriteId: string): Promise<ConversationFavoriteDetail> {
      const result = await api.request<Envelope<ConversationFavoriteDetail>>(
        `/conversations/favorites/${encodeURIComponent(favoriteId)}`,
      );
      return result.data;
    },

    async updateFavorite(input: {
      favoriteId: string;
      title?: string | null;
      note?: string | null;
      tags?: string[];
    }): Promise<ConversationFavoriteDetail> {
      const body: Record<string, unknown> = {};
      if ("title" in input) body.title = input.title;
      if ("note" in input) body.note = input.note;
      if ("tags" in input) body.tags = input.tags;
      const result = await api.request<Envelope<ConversationFavoriteDetail>>(
        `/conversations/favorites/${encodeURIComponent(input.favoriteId)}`,
        { method: "PATCH", body: JSON.stringify(body) },
      );
      return result.data;
    },

    async deleteFavorite(favoriteId: string): Promise<{ deleted: true }> {
      const result = await api.request<Envelope<{ deleted: true }>>(
        `/conversations/favorites/${encodeURIComponent(favoriteId)}`,
        { method: "DELETE" },
      );
      return result.data;
    },

    async importSources(input: {
      provider?: ConversationProvider;
      limit?: number;
      offset?: number;
    } = {}): Promise<{ items: ConversationImportSourceHistoryItem[]; total: number }> {
      const params = new URLSearchParams();
      if (input.provider) params.set("provider", input.provider);
      if (input.limit !== undefined) params.set("limit", String(input.limit));
      if (input.offset !== undefined) params.set("offset", String(input.offset));
      const suffix = params.size ? `?${params}` : "";
      const result = await api.request<
        Envelope<{ items: ConversationImportSourceHistoryItem[]; total: number }>
      >(`/conversations/import/sources${suffix}`);
      return result.data;
    },

    async importSource(sourceId: string): Promise<ConversationImportSourceHistoryDetail> {
      const result = await api.request<Envelope<ConversationImportSourceHistoryDetail>>(
        `/conversations/import/sources/${encodeURIComponent(sourceId)}`,
      );
      return result.data;
    },

    async previewStoredSource(sourceId: string): Promise<ConversationImportPreview> {
      const result = await api.request<Envelope<ConversationImportPreview>>(
        `/conversations/import/sources/${encodeURIComponent(sourceId)}/preview`,
        { method: "POST" },
      );
      return result.data;
    },

    async execute(preview: ConversationImportPreview): Promise<ConversationImportExecute> {
      const result = await api.request<Envelope<ConversationImportExecute>>(
        "/conversations/import/execute",
        {
          method: "POST",
          body: JSON.stringify({
            import_run_id: preview.import_run_id,
            expected_preview_fingerprint: preview.preview_fingerprint,
          }),
        },
      );
      return result.data;
    },
  };
}
