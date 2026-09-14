import type { WebApiClient } from "../api/useWebApiClient";

export type SharedPaperAuthor = "L" | "G" | "C";
export type SharedPaperScope = "active" | "archived";
export type SharedPaper = {
  id: string; userId: string; title: string; content: string; revision: number;
  createdBy: SharedPaperAuthor; updatedBy: SharedPaperAuthor;
  createdAt: string; updatedAt: string; archivedAt: string | null;
};
export type SharedPaperEdit = {
  id: string; userId: string; paperId: string; baseRevision: number; revision: number;
  author: SharedPaperAuthor; target: "content" | "title"; startOffset: number; endOffset: number;
  deletedText: string; insertedText: string; createdAt: string;
};
type Envelope<T> = { success: true; data: T };

export function createSharedPaperApi(api: WebApiClient) {
  return {
    async list(limit?: number, scope: SharedPaperScope = "active"): Promise<SharedPaper[]> {
      const params = new URLSearchParams();
      if (limit) params.set("limit", String(limit));
      if (scope !== "active") params.set("scope", scope);
      const suffix = params.size ? `?${params}` : "";
      const result = await api.request<Envelope<SharedPaper[]>>(`/shared-papers${suffix}`);
      return result.data;
    },
    async search(query: string, limit?: number, scope: SharedPaperScope = "active"): Promise<SharedPaper[]> {
      const params = new URLSearchParams({ query });
      if (limit) params.set("limit", String(limit));
      if (scope !== "active") params.set("scope", scope);
      const result = await api.request<Envelope<SharedPaper[]>>(`/shared-papers/search?${params}`);
      return result.data;
    },
    async get(id: string): Promise<SharedPaper> {
      const result = await api.request<Envelope<SharedPaper>>(`/shared-papers/${encodeURIComponent(id)}`);
      return result.data;
    },
    async create(input: { title: string; content: string; author: SharedPaperAuthor }): Promise<SharedPaper> {
      const result = await api.request<Envelope<SharedPaper>>("/shared-papers", { method: "POST", body: JSON.stringify(input) });
      return result.data;
    },
    async edit(id: string, input: { expected_revision: number; author: SharedPaperAuthor; target?: "content" | "title"; start: number; end: number; replacement: string }): Promise<{ paper: SharedPaper; edit: SharedPaperEdit }> {
      const body = input.target === "title"
        ? input
        : {
            expected_revision: input.expected_revision,
            author: input.author,
            start: input.start,
            end: input.end,
            replacement: input.replacement,
          };
      const result = await api.request<Envelope<{ paper: SharedPaper; edit: SharedPaperEdit }>>(`/shared-papers/${encodeURIComponent(id)}/content`, { method: "PATCH", body: JSON.stringify(body) });
      return result.data;
    },
    async archive(id: string): Promise<SharedPaper> {
      const result = await api.request<Envelope<SharedPaper>>(`/shared-papers/${encodeURIComponent(id)}/archive`, { method: "POST" });
      return result.data;
    },
    async restore(id: string): Promise<SharedPaper> {
      const result = await api.request<Envelope<SharedPaper>>(`/shared-papers/${encodeURIComponent(id)}/restore`, { method: "POST" });
      return result.data;
    },
    async remove(id: string): Promise<{ paperId: string }> {
      const result = await api.request<Envelope<{ paperId: string }>>(`/shared-papers/${encodeURIComponent(id)}/permanent`, { method: "DELETE" });
      return result.data;
    },
    async edits(id: string, limit = 100): Promise<SharedPaperEdit[]> {
      const result = await api.request<Envelope<SharedPaperEdit[]>>(`/shared-papers/${encodeURIComponent(id)}/edits?limit=${limit}`);
      return result.data;
    },
  };
}
