import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConversationImportHistoryRun,
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

function canConfirmImport(run: ConversationImportHistoryRun): boolean {
  return run.status === "processing" && Boolean(run.previewFingerprint?.trim());
}

export function ConversationImportHistoryPanel({
  client,
  refreshKey,
  onPreview,
  onImportExecuted,
}: {
  client: Client;
  refreshKey: number;
  onPreview: (preview: ConversationImportPreview) => void;
  onImportExecuted: () => void;
}) {
  const [state, setState] = useState<HistoryState>({ status: "loading" });
  const [detail, setDetail] = useState<ConversationImportSourceHistoryDetail | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [reapplyId, setReapplyId] = useState<string | null>(null);
  const [executingRunId, setExecutingRunId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const expandedSourceIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const result = await client.importSources({ limit: 20, offset: 0 });
      setState({ status: "ready", ...result });
    } catch {
      setState({ status: "error" });
    }
  }, [client, refreshKey]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const sourceId = expandedSourceIdRef.current;
    if (!sourceId) return;
    let cancelled = false;
    void client.importSource(sourceId).then((refreshed) => {
      if (!cancelled && expandedSourceIdRef.current === sourceId) setDetail(refreshed);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [client, refreshKey]);

  const toggleDetail = async (sourceId: string) => {
    if (detail?.sourceId === sourceId) {
      expandedSourceIdRef.current = null;
      setDetail(null);
      return;
    }
    expandedSourceIdRef.current = sourceId;
    setDetail(null);
    setDetailLoadingId(sourceId);
    setMessage("");
    try {
      setDetail(await client.importSource(sourceId));
    } catch {
      if (expandedSourceIdRef.current === sourceId) expandedSourceIdRef.current = null;
      setMessage("这份导入源的 run history 暂时无法读取。");
    } finally {
      setDetailLoadingId(null);
    }
  };

  const reapply = async (source: ConversationImportSourceHistoryItem) => {
    if (!source.rawSource.retained || reapplyId || executingRunId) return;
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

  const confirmImport = async (
    source: ConversationImportSourceHistoryItem,
    run: ConversationImportHistoryRun,
  ) => {
    if (!canConfirmImport(run) || executingRunId || reapplyId) return;
    const previewFingerprint = run.previewFingerprint!;
    setExecutingRunId(run.id);
    setMessage("");
    try {
      const result = await client.execute({
        import_run_id: run.id,
        preview_fingerprint: previewFingerprint,
      } as ConversationImportPreview);
      try {
        setDetail(await client.importSource(source.sourceId));
        setMessage(
          result.outcome === "executed"
            ? "导入完成；run history 已刷新。"
            : "这份导出已经处理过，没有重复写入；run history 已刷新。",
        );
      } catch {
        setMessage("导入已完成，但 run history 暂时刷新失败；父级列表会继续刷新。");
      }
      onImportExecuted();
    } catch {
      try {
        const refreshed = await client.importSource(source.sourceId);
        setDetail(refreshed);
        const refreshedRun = refreshed.runs.find((item) => item.id === run.id);
        if (refreshedRun?.status === "executed" || refreshedRun?.status === "superseded") {
          setMessage("导入请求结果已通过 run history 确认；列表已刷新。");
          onImportExecuted();
        } else {
          setMessage("确认导入没有完成。请根据当前 run 状态重新 Preview 后再确认。");
        }
      } catch {
        setMessage("暂时无法确认本次导入结果。请先刷新 Import history，避免重复点击确认导入。");
      }
    } finally {
      setExecutingRunId(null);
    }
  };

  return (
    <section className="conversation-section conversation-import-history">
      <div className="conversation-section-heading">
        <div>
          <p className="memory-month-label">原始导入记录</p>
        </div>
        {state.status === "ready" ? <span>共 {state.total.toLocaleString()} 份</span> : null}
      </div>

      {message ? <p className="conversation-inline-status" role="status">{message}</p> : null}

      {state.status === "loading" ? (
        <p className="system-state-copy" role="status" aria-live="polite">正在读取导入记录…</p>
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
                      className="secondary-button"
                      type="button"
                      disabled={!source.rawSource.retained || reapplyId !== null || executingRunId !== null}
                      title={source.rawSource.retained
                        ? "只生成新的 Preview；仍需再次确认导入"
                        : "原始 source 已不在 storage 中"}
                      onClick={() => void reapply(source)}
                    >
                      {reapplyId === source.sourceId ? "生成中…" : "重新 Preview"}
                    </button>
                  </div>
                </div>

                {expanded && detail ? (
                  <div className="conversation-import-run-list">
                    {detail.runs.map((run) => (
                      <div className="conversation-import-run" key={run.id}>
                        <strong>{statusLabel(run.status)}</strong>
                        <span className="conversation-import-run-parser">
                          {run.executionMode === "reapply" ? "显式 reapply" : "标准导入"}
                          {" · "}{run.parserVersion}
                        </span>
                        <small>
                          {run.warningCount ? `${run.warningCount} warnings · ` : ""}
                          run {run.id.slice(0, 8)}
                          {run.supersededByImportRunId
                            ? ` · superseded by ${run.supersededByImportRunId.slice(0, 8)}`
                            : ""}
                        </small>
                        <time>{dateTime(run.completedAt ?? run.createdAt)}</time>
                        {canConfirmImport(run) ? (
                          <button
                            className="conversation-history-inline-action"
                            type="button"
                            disabled={executingRunId !== null || reapplyId !== null}
                            onClick={() => void confirmImport(source, run)}
                          >
                            {executingRunId === run.id ? "确认中…" : "确认导入"}
                          </button>
                        ) : null}
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
