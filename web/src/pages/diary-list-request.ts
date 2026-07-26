import type { DiaryFilters } from "./diary-location";

export type DiaryRequestTicket = { isCurrent(): boolean };
export type DiaryRequestTracker = {
  begin(): DiaryRequestTicket;
  invalidate(): void;
};

export function buildDiaryListRequest(filters: DiaryFilters): {
  search: string;
  url: string;
} {
  const parameters = new URLSearchParams();
  setTrimmed(parameters, "q", filters.q);
  setTrimmed(parameters, "tag", filters.tag);
  setTrimmed(parameters, "mood", filters.mood);
  setTrimmed(parameters, "date_from", filters.dateFrom);
  setTrimmed(parameters, "date_to", filters.dateTo);
  const search = parameters.size ? `?${parameters.toString()}` : "";
  return { search, url: `/diary${search}` };
}

export function createLatestDiaryRequestTracker(): DiaryRequestTracker {
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

export async function settleLatestDiaryRequest<T>(input: {
  request: Promise<T>;
  ticket: DiaryRequestTicket;
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

function setTrimmed(
  parameters: URLSearchParams,
  name: string,
  value: string,
): void {
  const normalized = value.trim();
  if (normalized) parameters.set(name, normalized);
}
