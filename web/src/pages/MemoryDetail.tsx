import { useEffect, useRef, useState, type RefObject } from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { PaperDetailDialog } from "./PaperDetailDialog";
import { PaperDetailActions } from "./PaperDetailActions";
import { PaperDateEditor } from "./PaperDateEditor";
import { PaperBodyEditor } from "./PaperBodyEditor";
import {
  getMemory,
  memoryDay,
  memoryLocalTime,
  memoryTimestamp,
  saveMemory,
  type MemoryItem,
} from "./memory-api";

export function MemoryPaperDateEditor({
  value,
  disabled,
  label,
  onChange,
}: {
  value: string;
  disabled: boolean;
  label: string;
  onChange(value: string): void;
}) {
  return (
    <PaperDateEditor
      value={value}
      disabled={disabled}
      label={label}
      type="datetime-local"
      display={value.replace("T", " ").slice(0, 16).replaceAll("-", ".")}
      onChange={onChange}
    />
  );
}

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
  showEntryDates = true,
  registerNavigationGuard,
  readFirst = false,
}: {
  readFirst?: boolean;
  api: WebApiClient;
  initial: MemoryItem[];
  date?: string;
  triggerRef: RefObject<HTMLElement | null>;
  onSaved(item: MemoryItem): void;
  onClose(): void;
  onDelete?: () => Promise<void>;
  showEntryDates?: boolean;
  registerNavigationGuard?(guard: (() => boolean) | null): void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    initial.map((item) => ({
      item,
      text: item.text ?? "",
      date: memoryLocalTime(item.occurredAt),
    })),
  );
  const [editing, setEditing] = useState(!readFirst);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = drafts.some(changed);
  useEffect(() => {
    registerNavigationGuard?.(
      () =>
        !inFlight.current && (!dirty || window.confirm("放弃未保存的修改？")),
    );
    return () => registerNavigationGuard?.(null);
  }, [dirty, busy, registerNavigationGuard]);
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
      if (readFirst) setEditing(false);
      else onClose();
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
  function cancelEdit() {
    if (inFlight.current || (dirty && !window.confirm("放弃未保存的修改？")))
      return;
    setDrafts((old) =>
      old.map(({ item }) => ({
        item,
        text: item.text ?? "",
        date: memoryLocalTime(item.occurredAt),
      })),
    );
    setError(null);
    setEditing(false);
  }
  return (
    <PaperDetailDialog
      id={`memory-${date ?? initial[0]?.id}`}
      label="Memory"
      open
      dateLabel={
        editing && showEntryDates && drafts.length === 1 ? (
          <MemoryPaperDateEditor
            value={drafts[0].date}
            disabled={busy}
            label="Memory 1 发生时间（北京时间）"
            onChange={(date) => {
              patch(drafts[0].item.id, { date });
              setError(null);
            }}
          />
        ) : (
          ((date ?? memoryDay(drafts[0]?.item.occurredAt ?? null))?.replaceAll(
            "-",
            ".",
          ) ?? "未指定日期")
        )
      }
      signature="Memory"
      triggerRef={triggerRef}
      onRequestClose={close}
      errorMessage={error}
      topRight={
        <PaperDetailActions
          editing={editing}
          busy={busy}
          invalid={
            !dirty ||
            drafts.some(
              (d) => d.unresolved || !d.text.trim() || d.text.length > 20000,
            )
          }
          onCancel={readFirst ? cancelEdit : close}
          onSave={() => void save()}
          onEdit={() => {
            setError(null);
            setEditing(true);
          }}
          readingAction={
            onDelete ? (
              <button
                className="memory-paper-control"
                disabled={busy}
                onClick={() => {
                  if (inFlight.current || !window.confirm("删除这条 Memory？"))
                    return;
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
                {busy ? "删除中…" : "删除"}
              </button>
            ) : undefined
          }
        />
      }
    >
      <div className="memory-paper-entries">
        {drafts.map((draft, index) => (
          <section className="memory-paper-entry" key={draft.item.id}>
            {showEntryDates && drafts.length > 1 ? (
              <div className="memory-entry-date">
                <MemoryPaperDateEditor
                  value={draft.date}
                  disabled={busy}
                  label={`Memory ${index + 1} 发生时间（北京时间）`}
                  onChange={(date) => {
                    patch(draft.item.id, { date });
                    setError(null);
                  }}
                />
              </div>
            ) : null}
            {editing ? (
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
            ) : (
              <p className="memory-paper-content">{draft.item.text}</p>
            )}
            {draft.unresolved ? (
              <div className="memory-paper-conflict" role="alert">
                {draft.conflict ? (
                  <>
                    <p>最新内容：</p>
                    <p className="memory-paper-conflict-text">
                      {draft.conflict.text}
                    </p>
                    {showEntryDates && draft.conflict.occurredAt ? (
                      <p>
                        {memoryLocalTime(draft.conflict.occurredAt)
                          .replace("T", " ")
                          .slice(0, 16)}
                      </p>
                    ) : null}
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
                          ...(!showEntryDates
                            ? {
                                date: memoryLocalTime(
                                  draft.conflict!.occurredAt,
                                ),
                              }
                            : {}),
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
  triggerRef,
  registerNavigationGuard,
}: {
  api: WebApiClient;
  initial: MemoryItem;
  registerNavigationGuard?(guard: (() => boolean) | null): void;
  triggerRef?: RefObject<HTMLElement | null>;
  onSaved(item: MemoryItem): void;
  onClose(): void;
  onDelete?: () => Promise<void>;
}) {
  const trigger = useRef<HTMLElement | null>(
    document.activeElement as HTMLElement,
  );
  return (
    <MemoryPaper
      readFirst
      registerNavigationGuard={registerNavigationGuard}
      api={api}
      initial={[initial]}
      triggerRef={triggerRef ?? trigger}
      onSaved={onSaved}
      onClose={onClose}
      onDelete={onDelete}
    />
  );
}
