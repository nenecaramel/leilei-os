import type { MemoryFilters } from "./memory-location";

export type MemoryRequestTicket = { isCurrent(): boolean };
export type MemoryRequestTracker = {
  begin(): MemoryRequestTicket;
  invalidate(): void;
};

export function buildMemoryListRequest(
  filters: MemoryFilters,
): { search: string; url: string } {
  const parameters = new URLSearchParams();
  const query = filters.q.trim();
  if (query) parameters.set("q", query);
  if (filters.category) {
    parameters.set("category", filters.category);
  }
  const tag = filters.tag.normalize("NFC").trim();
  if (tag) parameters.set("tag", tag);
  const search = parameters.size
    ? `?${parameters.toString()}`
    : "";
  return { search, url: `/memory${search}` };
}

export function createLatestMemoryRequestTracker():
  MemoryRequestTracker {
  let latest = 0;
  return {
    begin() {
      const ticket = ++latest;
      return { isCurrent: () => ticket === latest };
    },
    invalidate() {
      latest += 1;
    },
  };
}

export async function settleLatestMemoryRequest<T>(input: {
  request: Promise<T>;
  ticket: MemoryRequestTicket;
  signal: AbortSignal;
  onSuccess(value: T): void;
  onError(): void;
}): Promise<void> {
  try {
    const value = await input.request;
    if (input.ticket.isCurrent()) input.onSuccess(value);
  } catch {
    if (input.ticket.isCurrent() && !input.signal.aborted) {
      input.onError();
    }
  }
}
