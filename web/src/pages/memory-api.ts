import type { WebApiClient } from "../api/useWebApiClient";
import { WebApiError } from "../api/web-api-error";
export type MemoryItem = {
  id: string;
  text: string | null;
  occurredAt: string | null;
  contentVersion: string;
  source: string;
  createdAt: string;
  updatedAt: string;
};
export type MemorySummary = {
  id: string;
  snippet: string;
  date: string | null;
  occurredAt: string | null;
};
export type MemoryPage<T> = { items: T[]; nextCursor: string | null };
type Envelope<T> = { data: T };
export function memoryDay(value: string | null): string | null {
  return value ? memoryLocalTime(value).slice(0, 10) : null;
}
export function memoryLocalTime(value: string | null): string {
  return value
    ? new Date(new Date(value).getTime() + 8 * 3600000)
        .toISOString()
        .slice(0, -1)
    : "";
}
export function memoryTimestamp(value: string): string | null {
  return value ? new Date(`${value}+08:00`).toISOString() : null;
}
export async function getMemory(
  api: WebApiClient,
  id: string,
  signal?: AbortSignal,
): Promise<MemoryItem> {
  return (
    await api.request<Envelope<MemoryItem>>(`/mind/${encodeURIComponent(id)}`, {
      signal,
    })
  ).data;
}
export async function searchMemory(
  api: WebApiClient,
  undated: boolean,
  cursor?: string | null,
  signal?: AbortSignal,
): Promise<MemoryPage<MemorySummary>> {
  const query = new URLSearchParams({ limit: "50", undated: String(undated) });
  if (cursor) query.set("cursor", cursor);
  return (
    await api.request<Envelope<MemoryPage<MemorySummary>>>(
      `/mind/search?${query}`,
      { signal },
    )
  ).data;
}
export async function loadMemoryDay(
  api: WebApiClient,
  date: string,
  signal?: AbortSignal,
): Promise<MemoryItem[]> {
  const items: MemoryItem[] = [];
  let cursor: string | null = null;
  do {
    signal?.throwIfAborted();
    const query = new URLSearchParams({ limit: "200" });
    if (cursor) query.set("cursor", cursor);
    const page: MemoryPage<MemoryItem> = (
      await api.request<Envelope<MemoryPage<MemoryItem>>>(
        `/mind/days/${encodeURIComponent(date)}?${query}`,
        { signal },
      )
    ).data;
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}
export async function saveMemory(
  api: WebApiClient,
  item: MemoryItem,
  text: string,
  occurredAt: string | null,
): Promise<
  | { status: "saved"; item: MemoryItem }
  | { status: "conflict"; latest: MemoryItem | null }
> {
  try {
    const response = await api.request<Envelope<MemoryItem>>(
      `/mind/${encodeURIComponent(item.id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          expected_version: item.contentVersion,
          ...(text !== (item.text ?? "") ? { text } : {}),
          ...(occurredAt !== item.occurredAt
            ? { occurred_at: occurredAt }
            : {}),
        }),
      },
    );
    return { status: "saved", item: response.data };
  } catch (error) {
    if (error instanceof WebApiError && error.status === 409) {
      try {
        return { status: "conflict", latest: await getMemory(api, item.id) };
      } catch {
        return { status: "conflict", latest: null };
      }
    }
    throw error;
  }
}

export async function listMemoryDates(api: WebApiClient, signal?: AbortSignal): Promise<string[]> {
  return (await api.request<Envelope<{dates: string[]}>>("/mind/dates", {signal})).data.dates;
}
export function memoryPreviewDensity(items: readonly Pick<MemoryItem,"text">[]): number {
  return Math.max(1, Math.min(6, Math.max(items.length, Math.ceil(items.reduce((n,item) => n+(item.text?.length ?? 0),0)/44))));
}
