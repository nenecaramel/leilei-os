import { useRef, useState, type RefObject } from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { PaperDetailDialog } from "./PaperDetailDialog";
import { PaperBodyEditor } from "./PaperBodyEditor";
import {
  getMemory,
  memoryDay,
  memoryLocalTime,
  memoryTimestamp,
  saveMemory,
  type MemoryItem,
} from "./memory-api";

type Draft = {
  item: MemoryItem;
  text: string;
  date: string;
  conflict?: MemoryItem | null;
  unresolved?: boolean;
};
const changed = (draft: Draft) =>
  draft.text !== (draft.item.text ?? "") ||
  draft.date !== memoryLocalTime(draft.item.occurredAt);

export function MemoryPaper({
  api,
  initial,
  date,
  triggerRef,
  onSaved,
  onClose,
  onDelete,
}: {
  api: WebApiClient;
  initial: MemoryItem[];
  date?: string;
  triggerRef: RefObject<HTMLElement | null>;
  onSaved(item: MemoryItem): void;
  onClose(): void;
  onDelete?: () => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    initial.map((item) => ({
      item,
      text: item.text ?? "",
      date: memoryLocalTime(item.occurredAt),
    })),
  );
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = drafts.some(changed);
  useUnsavedChanges(dirty);
  const patch = (id: string, values: Partial<Draft>) =>
    setDrafts((old) =>
      old.map((d) => (d.item.id === id ? { ...d, ...values } : d)),
    );
  async function save() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      for (const draft of drafts.filter(changed)) {
        if (draft.unresolved) return;
        const result = await saveMemory(
          api,
          draft.item,
          draft.text,
          memoryTimestamp(draft.date),
        );
        if (result.status === "conflict") {
          patch(draft.item.id, { unresolved: true, conflict: result.latest });
          setError("内容已被修改。草稿已保留，请对照最新内容处理冲突。");
          return;
        }
        patch(draft.item.id, {
          item: result.item,
          text: result.item.text ?? "",
          date: memoryLocalTime(result.item.occurredAt),
        });
        onSaved(result.item);
      }
      onClose();
    } catch {
      setError("保存失败，请重试");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function close() {
    if (inFlight.current || (dirty && !window.confirm("放弃未保存的修改？")))
      return false;
    onClose();
    return true;
  }
  return (
    <PaperDetailDialog
      id={`memory-${date ?? initial[0]?.id}`}
      label="Memory"
      open
      dateLabel={
        (date ?? memoryDay(initial[0]?.occurredAt ?? null))?.replaceAll(
          "-",
          ".",
        ) ?? "未指定日期"
      }
      signature="Memory"
      triggerRef={triggerRef}
      onRequestClose={close}
      errorMessage={error}
      topRight={
        <>
          <button
            className="memory-paper-control"
            disabled={busy}
            onClick={close}
          >
            取消
          </button>
          <span>·</span>
          <button
            className="memory-paper-control"
            disabled={
              busy ||
              !dirty ||
              drafts.some(
                (d) => d.unresolved || !d.text.trim() || d.text.length > 20000,
              )
            }
            onClick={() => void save()}
          >
            {busy ? "保存中…" : "保存"}
          </button>
        </>
      }
      bottomLeft={
        onDelete ? (
          <button
            className="memory-paper-control"
            disabled={busy}
            onClick={() => {
              if (!window.confirm("删除这条 Memory？")) return;
              inFlight.current = true;
              setBusy(true);
              void onDelete()
                .catch(() => setError("删除失败，请重试"))
                .finally(() => {
                  inFlight.current = false;
                  setBusy(false);
                });
            }}
          >
            删除
          </button>
        ) : null
      }
    >
      <div className="memory-paper-entries">
        {drafts.map((draft, index) => (
          <section className="memory-paper-entry" key={draft.item.id}>
            <div className="memory-entry-date">
              <label className="diary-paper-date-editor memory-entry-date-editor">
                <span>
                  {draft.date
                    ? draft.date
                        .replace("T", " ")
                        .slice(0, 16)
                        .replaceAll("-", ".")
                    : "未指定日期"}
                </span>
                <input
                  type="datetime-local"
                  aria-label={`Memory ${index + 1} 发生时间（北京时间）`}
                  step="60"
                  value={draft.date}
                  disabled={busy}
                  onChange={(e) => {
                    patch(draft.item.id, { date: e.target.value });
                    setError(null);
                  }}
                  onInput={(e) => {
                    patch(draft.item.id, { date: e.currentTarget.value });
                    setError(null);
                  }}
                />
              </label>
              {draft.date ? (
                <button
                  className="memory-paper-control"
                  disabled={busy}
                  onClick={() => {
                    patch(draft.item.id, { date: "" });
                    setError(null);
                  }}
                >
                  未指定日期
                </button>
              ) : null}
            </div>
            <PaperBodyEditor
              label={`Memory ${index + 1} 正文`}
              value={draft.text}
              disabled={busy}
              minimumHeight={30}
              onChange={(text) => {
                patch(draft.item.id, { text });
                setError(null);
              }}
            />
            {draft.unresolved ? (
              <div className="memory-paper-conflict" role="alert">
                {draft.conflict ? (
                  <>
                    <p>最新内容：</p>
                    <p className="memory-paper-conflict-text">
                      {draft.conflict.text}
                    </p>
                    <p>
                      {memoryLocalTime(draft.conflict.occurredAt)
                        .replace("T", " ")
                        .slice(0, 16) || "未指定日期"}
                    </p>
                    <button
                      className="memory-paper-control"
                      disabled={busy}
                      onClick={() => {
                        const latest = draft.conflict!;
                        patch(draft.item.id, {
                          item: latest,
                          text: latest.text ?? "",
                          date: memoryLocalTime(latest.occurredAt),
                          conflict: null,
                          unresolved: false,
                        });
                        setError(null);
                      }}
                    >
                      使用最新内容
                    </button>
                    <button
                      className="memory-paper-control"
                      disabled={busy}
                      onClick={() => {
                        patch(draft.item.id, {
                          item: draft.conflict!,
                          conflict: null,
                          unresolved: false,
                        });
                        setError("草稿已保留，请核对后保存。");
                      }}
                    >
                      保留草稿继续编辑
                    </button>
                  </>
                ) : (
                  <button
                    className="memory-paper-control"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      inFlight.current = true;
                      void getMemory(api, draft.item.id)
                        .then((conflict) => patch(draft.item.id, { conflict }))
                        .catch(() =>
                          setError("无法读取最新内容，草稿已保留。请重试。"),
                        )
                        .finally(() => {
                          inFlight.current = false;
                          setBusy(false);
                        });
                    }}
                  >
                    读取最新内容
                  </button>
                )}
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </PaperDetailDialog>
  );
}

export function MemoryDetail({
  api,
  initial,
  onSaved,
  onClose,
  onDelete,
}: {
  api: WebApiClient;
  initial: MemoryItem;
  onSaved(item: MemoryItem): void;
  onClose(): void;
  onDelete?: () => Promise<void>;
}) {
  const trigger = useRef<HTMLElement | null>(
    document.activeElement as HTMLElement,
  );
  return (
    <MemoryPaper
      api={api}
      initial={[initial]}
      triggerRef={trigger}
      onSaved={onSaved}
      onClose={onClose}
      onDelete={onDelete}
    />
  );
}
