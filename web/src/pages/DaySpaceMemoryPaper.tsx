import { useRef, useState } from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import { PaperDetailDialog } from "./PaperDetailDialog";
import { MemoryDetail } from "./MemoryDetail";
import { getMemory, type MemoryItem } from "./memory-api";

export function DaySpaceMemoryDialog({
  api,
  date,
  items,
  onRefresh,
  onSaved,
  onClose,
}: {
  api: WebApiClient;
  date: string;
  items: MemoryItem[];
  onRefresh: () => void;
  onSaved: (item: MemoryItem) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<MemoryItem | null>(null);
  const [error, setError] = useState(false);
  const trigger = useRef<HTMLElement | null>(
    document.activeElement as HTMLElement,
  );
  return (
    <>
      {!editing ? (
        <PaperDetailDialog
          id={`memory-day-${date}`}
          label={`${date} Memory`}
          open
          dateLabel={date}
          signature="Memory"
          triggerRef={trigger}
          errorMessage={error ? "无法读取，请重试。" : null}
          onRequestClose={() => {
            onClose();
            return true;
          }}
        >
          {items.map((item) => (
            <button
              className="memory-row"
              key={item.id}
              onClick={() => {
                void getMemory(api, item.id)
                  .then(setEditing)
                  .catch(() => setError(true));
              }}
            >
              <span className="memory-row-title">{item.text}</span>
              <span className="memory-row-meta">查看 / 编辑</span>
            </button>
          ))}
        </PaperDetailDialog>
      ) : null}
      {editing ? (
        <MemoryDetail
          key={editing.id}
          api={api}
          initial={editing}
          onClose={() => {
            setEditing(null);
            onRefresh();
          }}
          onSaved={(item) => {
            setEditing(null);
            onSaved(item);
          }}
        />
      ) : null}
    </>
  );
}
