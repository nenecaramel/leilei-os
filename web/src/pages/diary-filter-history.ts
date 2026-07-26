import { buildDiaryListRequest } from "./diary-list-request";
import {
  readDiaryFilters,
  type DiaryFilters,
} from "./diary-location";

type HistoryTarget = Pick<Window, "history" | "location">;
type ListenerTarget = HistoryTarget &
  Pick<Window, "addEventListener" | "removeEventListener">;

export function pushDiaryFilterHistory(
  target: HistoryTarget,
  filters: DiaryFilters,
): boolean {
  const next = buildDiaryListRequest(filters);
  const current = buildDiaryListRequest(
    readDiaryFilters(target.location.search),
  );
  const nextLocation = `${target.location.pathname}${next.search}`;
  const currentLocation = `${target.location.pathname}${current.search}`;
  if (nextLocation === currentLocation) return false;
  target.history.pushState(null, "", nextLocation);
  return true;
}

export function subscribeToDiaryFilterHistory(
  target: ListenerTarget,
  restore: (filters: DiaryFilters) => void,
): () => void {
  const listener = () => restore(readDiaryFilters(target.location.search));
  target.addEventListener("popstate", listener);
  return () => target.removeEventListener("popstate", listener);
}

export function createDiaryFilterDebouncer(input: {
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
