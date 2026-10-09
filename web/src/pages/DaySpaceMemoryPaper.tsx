import type { RefObject } from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import { MemoryPaper } from "./MemoryDetail";
import type { MemoryItem } from "./memory-api";

export function DaySpaceMemoryDialog({
  api,
  date,
  items,
  triggerRef,
  onSaved,
  onClose,
}: {
  api: WebApiClient;
  date: string;
  items: MemoryItem[];
  triggerRef: RefObject<HTMLElement | null>;
  onSaved(item: MemoryItem): void;
  onClose(): void;
}) {
  return (
    <MemoryPaper
      api={api}
      date={date}
      initial={items}
      showEntryDates={false}
      triggerRef={triggerRef}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
}
