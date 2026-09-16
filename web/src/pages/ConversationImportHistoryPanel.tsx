import { useCallback, useEffect, useState } from "react";
import type {
  ConversationImportPreview,
  ConversationImportSourceHistoryDetail,
  ConversationImportSourceHistoryItem,
} from "./conversation-archive-api";
import { createConversationArchiveApi } from "./conversation-archive-api";

type Client = ReturnType<typeof createConversationArchiveApi>;

type HistoryState =
  | { status: "loading" }
  | { status: "ready"; items: ConversationImportSourceHistoryItem[]; total: number }
  | { status: "error" };

function dateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function bytes(value: number | null): string {
  if (value === null) return "—";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function statusLabel(status: string): string {
  if (status === "executed") return "已执行";
  if (status === "processing") return "待确认";
  if (status === "superseded") return "已被替代";
  return "失败";
}

export function ConversationImportHistoryPanel({
  client,
  refreshKey,
  onPreview,
}: {
  client: Client;
  refreshKey: number;
  onPreview: (preview: ConversationImportPreview) => void;
}) {
  const [state, setState] = useState<HistoryState>({ status: "loading" });
  const [detail, setDetail] = useState<ConversationImportSourceHistoryDetail | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [reapplyId, setReapplyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setState({ status: "loading" });
    setDetail(null);
    try {
      const result = await client.importSources({ limit: 20, offset: 0 });
      setState({ status: "ready", ...result });
    } catch {
      setState({ status: "error" });
    }
  }, [client, refreshKey]);

  useEffect(() => { void load(); }, [load]);

  const toggleDetail = async (sourceId: string) => {
    if (detail?.sourceId === sourceId) {
      setDetail(null);
      return;
    }
    setDetail(null);
    setDetailLoadingId(sourceId);
    setMessage("");
    try {
      setDetail(await client.importSource(sourceId));
    } catch {
      setMessage("这份导入源的 run history 暂时无法读取。");
    } finally {
      setDetailLoadingId(null);
    }
  };

  const reapply = async (source: ConversationImportSourceHistoryItem) => {
    if (!source.rawSource.retained || reapplyId) return;
    setReapplyId(source.sourceId);
    setMessage("");
    try {
      const preview = await client.previewStoredSource(source.sourceId);
      onPreview(preview);
      setMessage("已从保留的原始导出生成新的 Preview；只有确认导入后才会写入 Archive。");
    } catch {
      setMessage("无法从这份保留的原始导出重新生成 Preview。");
    } finally {
      setReapplyId(null);
    }
  };

  return (
    <section className="conversation-section conversation-import-history">
      <div className="conversation-section-heading">
        <div>
          <p className="eyebrow">Import history</p>
          <h2>原始导入记录</h2>
        </div>
        {state.status === "ready" ? <span>共 {state.total.toLocaleString()} 份 source</span> : null}
      </div>

      {message ? <p className="conversation-inline-status" role="status">{message}</p> : null}

      {state.status === "loading" ? (
        <div className="conversation-muted-card">正在读取导入记录…</div>
      ) : state.status === "error" ? (
        <div className="conversation-muted-card">
          导入记录暂时不可用。
          <button className="conversation-history-inline-action" type="button" onClick={() => void load()}>
            重试
          </button>
        </div>
      ) : state.items.length === 0 ? (
        <div className="conversation-muted-card">还没有保存过 Conversation import source。</div>
      ) : (
        <div className="conversation-import-history-list">
          {state.items.map((source) => {
            const latest = source.latestRun;
            const expanded = detail?.sourceId === source.sourceId;
            return (
              <article className="conversation-import-source-card" key={source.sourceId}>
                <div className="conversation-import-source-main">
                  <div className="conversation-import-source-topline">
                    <span className={`conversation-provider conversation-provider--${source.provider}`}>
                      {source.provider === "chatgpt" ? "ChatGPT" : "Claude"}
                    </span>
                    <time>{dateTime(source.receivedAt)}</time>
                  </div>
                  <h3>{source.filename}</h3>
                  <p>
                    {bytes(source.rawBytes)} · {source.runCount} 次 Preview/Execute
                    {source.supersededRunCount ? ` · ${source.supersededRunCount} 次被替代` : ""}
                  </p>
                  <small title={source.rawSha256}>
                    SHA-256 {source.rawSha256.slice(0, 12)}… ·
                    {" "}{source.rawSource.retained
                      ? `raw 已保留 · ${source.rawSource.encoding ?? "unknown"} · ${bytes(source.rawSource.storedBytes)}`
                      : "raw 不可用"}
                  </small>
                  {latest ? (
                    <small>
                      最近：{statusLabel(latest.status)} ·
                      {" "}{latest.executionMode === "reapply" ? "显式 reapply" : "标准导入"} ·
                      {" "}{dateTime(latest.completedAt ?? latest.createdAt)}
                    </small>
                  ) : null}
                </div>
                <div className="conversation-import-source-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={detailLoadingId === source.sourceId}
                    onClick={() => void toggleDetail(source.sourceId)}
                  >
                    {detailLoadingId === source.sourceId
                      ? "读取中…"
                      : expanded ? "收起 runs" : "查看 runs"}
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!source.rawSource.retained || reapplyId !== null}
                    title={source.rawSource.retained
                      ? "只生成新的 Preview；仍需再次确认导入"
                      : "原始 source 已不在 storage 中"}
                    onClick={() => void reapply(source)}
                  >
                    {reapplyId === source.sourceId ? "生成中…" : "重新 Preview"}
                  </button>
                </div>

                {expanded && detail ? (
                  <div className="conversation-import-run-list">
                    {detail.runs.map((run) => (
                      <div className="conversation-import-run" key={run.id}>
                        <div>
                          <strong>{statusLabel(run.status)}</strong>
                          <span>
                            {run.executionMode === "reapply" ? "显式 reapply" : "标准导入"}
                            {" · "}{run.parserVersion}
                          </span>
                        </div>
                        <time>{dateTime(run.completedAt ?? run.createdAt)}</time>
                        <small>
                          {run.warningCount ? `${run.warningCount} warnings · ` : ""}
                          run {run.id.slice(0, 8)}
                          {run.supersededByImportRunId
                            ? ` · superseded by ${run.supersededByImportRunId.slice(0, 8)}`
                            : ""}
                        </small>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
