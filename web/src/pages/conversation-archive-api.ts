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

export type ConversationDailyStat = {
  date: string;
  provider: ConversationProvider;
  conversations: number;
  messages: number;
  userMessages: number;
  assistantMessages: number;
  turns: number;
  pathBasis: "current_path" | "branch_inclusive";
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
};

export type ConversationPruneBranchResult = {
  provider: ConversationProvider;
  sourceConversationId: string;
  sourceNodeId: string;
  deletedMessages: number;
  remainingMessages: number;
  currentLeafSourceNodeId: string | null;
  rawSourcePreserved: true;
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

type Envelope<T> = { success: true; data: T };

export function createConversationArchiveApi(api: WebApiClient) {
  return {
    async list(input: {
      provider?: ConversationProvider;
      limit?: number;
      offset?: number;
    } = {}): Promise<{ items: ConversationListItem[]; total: number }> {
      const params = new URLSearchParams();
      if (input.provider) params.set("provider", input.provider);
      if (input.limit !== undefined) params.set("limit", String(input.limit));
      if (input.offset !== undefined) params.set("offset", String(input.offset));
      const suffix = params.size ? `?${params}` : "";
      const result = await api.request<Envelope<{ items: ConversationListItem[]; total: number }>>(
        `/conversations${suffix}`,
      );
      return result.data;
    },

    async detail(id: string): Promise<ConversationDetail> {
      const result = await api.request<Envelope<ConversationDetail>>(
        `/conversations/${encodeURIComponent(id)}`,
      );
      return result.data;
    },

    async messages(input: {
      conversationId: string;
      view?: "default" | "all";
      limit?: number;
      offset?: number;
    }): Promise<{ items: ConversationMessage[]; total: number }> {
      const params = new URLSearchParams();
      if (input.view && input.view !== "default") params.set("view", input.view);
      if (input.limit !== undefined) params.set("limit", String(input.limit));
      if (input.offset !== undefined) params.set("offset", String(input.offset));
      const suffix = params.size ? `?${params}` : "";
      const result = await api.request<Envelope<{ items: ConversationMessage[]; total: number }>>(
        `/conversations/${encodeURIComponent(input.conversationId)}/messages${suffix}`,
      );
      return result.data;
    },

    async dailyStats(input: {
      from: string;
      to: string;
      timeZone: string;
    }): Promise<ConversationDailyStat[]> {
      const params = new URLSearchParams({
        from: input.from,
        to: input.to,
        time_zone: input.timeZone,
      });
      const result = await api.request<Envelope<ConversationDailyStat[]>>(
        `/conversations/stats/daily?${params}`,
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
    }): Promise<ConversationMessageContext> {
      const params = new URLSearchParams();
      if (input.view && input.view !== "default") params.set("view", input.view);
      if (input.radius !== undefined) params.set("radius", String(input.radius));
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
