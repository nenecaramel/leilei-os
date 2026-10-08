import { useEffect, useRef, useState } from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import { MemoryDetail } from "./MemoryDetail";
import {
  getMemory,
  searchMemory,
  type MemoryItem,
  type MemorySummary,
} from "./memory-api";
export function MindPageContent({ api }: { api: WebApiClient }) {
  const [undated, setUndated] = useState(false);
  const [rows, setRows] = useState<MemorySummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [item, setItem] = useState<MemoryItem | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const generation = useRef(0);
  const createIdentity = useRef<{ text: string; id: string } | null>(null);
  useEffect(() => {
    const ticket = ++generation.current;
    const abort = new AbortController();
    setBusy(true);
    setRows([]);
    setCursor(null);
    setError(false);
    void searchMemory(api, undated, null, abort.signal)
      .then((page) => {
        if (ticket === generation.current) {
          setRows(page.items);
          setCursor(page.nextCursor);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      })
      .finally(() => {
        if (ticket === generation.current) setBusy(false);
      });
    return () => abort.abort();
  }, [api, undated, revision]);
  async function more() {
    const ticket = generation.current;
    setBusy(true);
    try {
      const page = await searchMemory(api, undated, cursor);
      if (ticket === generation.current) {
        setRows((old) => [
          ...old,
          ...page.items.filter((row) => !old.some((x) => x.id === row.id)),
        ]);
        setCursor(page.nextCursor);
      }
    } catch {
      if (ticket === generation.current) setError(true);
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }
  return (
    <div className="page memory-page">
      <header className="memory-page-header">
        <div className="memory-page-title">Mind</div>
        <div className="memory-page-tools">
          <button
            className="memory-paper-control"
            onClick={() => setUndated(!undated)}
          >
            {undated ? "全部 Memory" : "未指定日期"}
          </button>
          <button
            className="memory-paper-control"
            onClick={() => setAdding(true)}
          >
            新增 Memory
          </button>
        </div>
      </header>
      {adding ? (
        <form
          className="memory-editor"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            if (createIdentity.current?.text !== draft)
              createIdentity.current = { text: draft, id: crypto.randomUUID() };
            void api
              .request("/mind", {
                method: "POST",
                headers: { "Idempotency-Key": createIdentity.current!.id },
                body: JSON.stringify({ kind: "memory", text: draft }),
              })
              .then(() => {
                setAdding(false);
                setDraft("");
                createIdentity.current = null;
                setRevision((n) => n + 1);
              })
              .catch(() => setError(true))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            正文
            <textarea
              required
              maxLength={20000}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <button
            className="memory-paper-control"
            disabled={busy || !draft.trim()}
          >
            保存
          </button>
          <button
            type="button"
            className="memory-paper-control"
            disabled={busy}
            onClick={() => setAdding(false)}
          >
            取消
          </button>
        </form>
      ) : null}
      {error ? (
        <p role="alert">
          无法读取 Memory。
          <button onClick={() => setRevision((n) => n + 1)}>重试</button>
        </p>
      ) : null}
      {busy && rows.length === 0 ? <p role="status">Reading...</p> : null}
      {!busy && !error && rows.length === 0 ? <p>没有 Memory</p> : null}
      <div className="memory-month-card">
        {rows.map((row) => (
          <button
            className="memory-row"
            key={row.id}
            onClick={() => {
              void getMemory(api, row.id)
                .then(setItem)
                .catch(() => setError(true));
            }}
          >
            <span className="memory-row-title">{row.snippet}</span>
            <span className="memory-row-meta">{row.date ?? "未指定日期"}</span>
          </button>
        ))}
      </div>
      {cursor ? (
        <button
          className="memory-paper-control"
          disabled={busy}
          onClick={() => void more()}
        >
          更多
        </button>
      ) : null}
      {item ? (
        <MemoryDetail
          key={item.id}
          api={api}
          initial={item}
          onClose={() => setItem(null)}
          onSaved={() => setRevision((n) => n + 1)}
          onDelete={async () => {
            await api.request(`/mind/${encodeURIComponent(item.id)}`, {
              method: "DELETE",
            });
            setItem(null);
            setRevision((n) => n + 1);
          }}
        />
      ) : null}
    </div>
  );
}
