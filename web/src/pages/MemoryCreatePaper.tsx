import { useEffect, useRef, useState, type RefObject } from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import { PaperDetailDialog } from "./PaperDetailDialog";
import { PaperBodyEditor } from "./PaperBodyEditor";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { confirmUnsavedChanges, createSubmissionGate } from "./submission-gate";
import { MemoryPaperDateEditor } from "./MemoryDetail";
import { memoryTimestamp } from "./memory-api";

export function MemoryCreatePaper({
  api,
  triggerRef,
  onCreated,
  onClose,
  registerNavigationGuard,
}: {
  api: WebApiClient;
  triggerRef: RefObject<HTMLElement | null>;
  onCreated(): void;
  onClose(): void;
  registerNavigationGuard?(guard: (() => boolean) | null): void;
}) {
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const gate = useRef(createSubmissionGate());
  const live = useRef(true);
  const identity = useRef<{ body: string; id: string } | null>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useUnsavedChanges(Boolean(text || date));
  useEffect(() => {
    registerNavigationGuard?.(
      () =>
        !inFlight.current &&
        confirmUnsavedChanges(Boolean(text || date), (message) =>
          window.confirm(message),
        ),
    );
    return () => registerNavigationGuard?.(null);
  }, [busy, text, date, registerNavigationGuard]);
  function close() {
    if (
      inFlight.current ||
      !confirmUnsavedChanges(Boolean(text || date), (message) =>
        window.confirm(message),
      )
    )
      return false;
    onClose();
    return true;
  }
  async function save() {
    if (!text.trim() || text.length > 20000 || !gate.current.enter()) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const body = JSON.stringify({
        kind: "memory",
        text,
        occurred_at: memoryTimestamp(date),
      });
      if (identity.current?.body !== body)
        identity.current = { body, id: crypto.randomUUID() };
      await api.request("/mind", {
        method: "POST",
        headers: { "Idempotency-Key": identity.current.id },
        body,
      });
      if (live.current) {
        onCreated();
        onClose();
      }
    } catch {
      if (live.current) setError("保存失败，请重试");
    } finally {
      inFlight.current = false;
      gate.current.leave();
      if (live.current) setBusy(false);
    }
  }
  return (
    <PaperDetailDialog
      id="memory-create-paper"
      label="创建 Memory"
      open
      dateLabel={
        <MemoryPaperDateEditor
          value={date}
          disabled={busy}
          label="Memory 发生时间（北京时间）"
          onChange={setDate}
        />
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
            disabled={busy || !text.trim() || text.length > 20000}
            onClick={() => void save()}
          >
            {busy ? "保存中…" : "保存"}
          </button>
        </>
      }
      bottomLeft={
        date ? (
          <button
            className="memory-paper-control"
            disabled={busy}
            onClick={() => setDate("")}
          >
            未指定日期
          </button>
        ) : null
      }
    >
      <div className="memory-paper-entries">
        <PaperBodyEditor
          value={text}
          disabled={busy}
          label="Memory 正文"
          placeholder="写下记忆…"
          onChange={setText}
        />
      </div>
    </PaperDetailDialog>
  );
}
