import { buildMemoryListRequest } from "./memory-list-request";
import {
  readMemoryFilters,
  type MemoryFilters,
} from "./memory-location";

type HistoryTarget = Pick<Window, "history" | "location">;
type ListenerTarget = HistoryTarget &
  Pick<Window, "addEventListener" | "removeEventListener">;

export function pushMemoryFilterHistory(
  target: HistoryTarget,
  filters: MemoryFilters,
): boolean {
  const next = buildMemoryListRequest(filters);
  const current = buildMemoryListRequest(
    readMemoryFilters(target.location.search),
  );
  const nextLocation = `${target.location.pathname}${next.search}`;
  const currentLocation =
    `${target.location.pathname}${current.search}`;
  if (nextLocation === currentLocation) return false;
  target.history.pushState(null, "", nextLocation);
  return true;
}

export function subscribeToMemoryFilterHistory(
  target: ListenerTarget,
  restore: (filters: MemoryFilters) => void,
): () => void {
  const listener = () =>
    restore(readMemoryFilters(target.location.search));
  target.addEventListener("popstate", listener);
  return () => target.removeEventListener("popstate", listener);
}

export function createMemoryFilterDebouncer(input: {
  delayMs: number;
  commit(value: string): void;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timer: number): void;
}) {
  let timer: number | null = null;
  return {
    schedule(value: string) {
      if (timer !== null) input.clearTimeout(timer);
      timer = input.setTimeout(() => {
        timer = null;
        input.commit(value);
      }, input.delayMs);
    },
    cancel() {
      if (timer !== null) {
        input.clearTimeout(timer);
        timer = null;
      }
    },
  };
}
