import { useRef, useState } from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { PaperDetailDialog } from "./PaperDetailDialog";
import {
  getMemory,
  memoryLocalTime,
  memoryTimestamp,
  saveMemory,
  type MemoryItem,
} from "./memory-api";

export function MemoryDetail({
  api,
  initial,
  onSaved,
  onClose,
  onDelete,
}: {
  api: WebApiClient;
  initial: MemoryItem;
  onSaved: (item: MemoryItem) => void;
  onClose: () => void;
  onDelete?: () => Promise<void>;
}) {
  const [item, setItem] = useState(initial);
  const [text, setText] = useState(initial.text ?? "");
  const [date, setDate] = useState(memoryLocalTime(initial.occurredAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unresolved, setUnresolved] = useState(false);
  const [conflict, setConflict] = useState<MemoryItem | null>(null);
  const trigger = useRef<HTMLElement | null>(
    document.activeElement as HTMLElement,
  );
  const dirty =
    text !== (item.text ?? "") || date !== memoryLocalTime(item.occurredAt);
  useUnsavedChanges(dirty);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await saveMemory(api, item, text, memoryTimestamp(date));
      if (result.status === "conflict") {
        setUnresolved(true);
        setConflict(result.latest);
        setError("内容已被修改。草稿已保留，请对照最新内容处理冲突。");
      } else {
        setItem(result.item);
        setText(result.item.text ?? "");
        setDate(memoryLocalTime(result.item.occurredAt));
        onSaved(result.item);
      }
    } catch {
      setError("无法保存，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <PaperDetailDialog
      id={`memory-${item.id}`}
      label="Memory"
      open
      dateLabel="北京时间"
      signature="Memory"
      triggerRef={trigger}
      onRequestClose={() => {
        if (busy || (dirty && !window.confirm("放弃未保存的修改？")))
          return false;
        onClose();
        return true;
      }}
      errorMessage={error}
      topRight={
        <button
          className="memory-paper-control"
          disabled={
            busy || unresolved || !dirty || !text.trim() || text.length > 20000
          }
          onClick={() => void save()}
        >
          保存
        </button>
      }
      bottomLeft={
        onDelete ? (
          <button
            className="memory-paper-control"
            disabled={busy}
            onClick={() => {
              if (window.confirm("删除这条 Memory？")) {
                setBusy(true);
                void onDelete().catch(() => {
                  setError("无法删除，请重试。");
                  setBusy(false);
                });
              }
            }}
          >
            删除
          </button>
        ) : null
      }
    >
      <div className="memory-editor">
        <label>
          正文
          <textarea
            aria-label="Memory 正文"
            value={text}
            disabled={busy}
            maxLength={20000}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <label>
          发生时间（北京时间）
          <input
            aria-label="发生时间（北京时间）"
            type="datetime-local"
            step="0.001"
            value={date}
            disabled={busy}
            onChange={(e) => setDate(e.target.value)}
            onInput={(e) => setDate(e.currentTarget.value)}
          />
        </label>
        <button
          className="memory-paper-control"
          disabled={busy || !date}
          onClick={() => setDate("")}
        >
          未指定日期
        </button>
        {unresolved && !conflict ? (
          <button
            className="memory-paper-control"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void getMemory(api, item.id)
                .then(setConflict)
                .catch(() => setError("无法读取最新内容，草稿已保留。请重试。"))
                .finally(() => setBusy(false));
            }}
          >
            读取最新内容
          </button>
        ) : null}
        {conflict ? (
          <section role="alert">
            <p>最新内容：</p>
            <p className="memory-paper-content">{conflict.text}</p>
            <p>{memoryLocalTime(conflict.occurredAt) || "未指定日期"}</p>
            <button
              className="memory-paper-control"
              onClick={() => {
                setItem(conflict);
                setText(conflict.text ?? "");
                setDate(memoryLocalTime(conflict.occurredAt));
                setConflict(null);
                setUnresolved(false);
                setError(null);
              }}
            >
              使用最新内容
            </button>
            <button
              className="memory-paper-control"
              onClick={() => {
                setItem(conflict);
                setConflict(null);
                setUnresolved(false);
                setError("已保留草稿，请核对后再次保存。");
              }}
            >
              保留草稿继续编辑
            </button>
          </section>
        ) : null}
      </div>
    </PaperDetailDialog>
  );
}
