import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { WebApiClient } from "../api/useWebApiClient";
import { PageState } from "../components/StateSurface";
import { PageHeader } from "./PageHeader";
import {
  createConversationArchiveApi,
  type ConversationDailyStat,
  type ConversationDetail,
  type ConversationImportPreview,
  type ConversationListItem,
  type ConversationMessage,
  type ConversationProvider,
} from "./conversation-archive-api";
import "./conversation-archive.css";

type ListState =
  | { status: "loading" }
  | { status: "ready"; items: ConversationListItem[]; total: number }
  | { status: "error" };

type StatsState =
  | { status: "loading" }
  | { status: "ready"; items: ConversationDailyStat[] }
  | { status: "error" };

type DetailState =
  | { status: "loading" }
  | {
      status: "ready";
      detail: ConversationDetail;
      messages: ConversationMessage[];
      totalMessages: number;
    }
  | { status: "error" };

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function dateInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function providerLabel(provider: ConversationProvider): string {
  return provider === "chatgpt" ? "ChatGPT" : "Claude";
}

function shortBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function ConversationArchivePageContent({ api }: { api: WebApiClient }) {
  const client = useMemo(() => createConversationArchiveApi(api), [api]);
  const { conversationId } = useParams<{ conversationId?: string }>();

  if (conversationId) {
    return <ConversationDetailView client={client} conversationId={conversationId} />;
  }
  return <ConversationListView client={client} />;
}

function ConversationListView({
  client,
}: {
  client: ReturnType<typeof createConversationArchiveApi>;
}) {
  const [provider, setProvider] = useState<ConversationProvider | undefined>();
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [stats, setStats] = useState<StatsState>({ status: "loading" });
  const [preview, setPreview] = useState<ConversationImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setList({ status: "loading" });
    try {
      const result = await client.list({ provider, limit: 100, offset: 0 });
      setList({ status: "ready", ...result });
    } catch {
      setList({ status: "error" });
    }
  }, [client, provider, refreshKey]);

  const loadStats = useCallback(async () => {
    setStats({ status: "loading" });
    const timeZone = browserTimeZone();
    const now = new Date();
    const from = dateInZone(new Date(now.getTime() - 29 * 86_400_000), timeZone);
    const to = dateInZone(now, timeZone);
    try {
      setStats({
        status: "ready",
        items: await client.dailyStats({ from, to, timeZone }),
      });
    } catch {
      setStats({ status: "error" });
    }
  }, [client, refreshKey]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadStats(); }, [loadStats]);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setImporting(true);
    setImportMessage("");
    setPreview(null);
    try {
      const result = await client.preview(file);
      setPreview(result);
      if (result.already_executed) {
        setImportMessage("这份原始导出已经导入过，不会重复写入。");
      }
    } catch {
      setImportMessage("无法读取这份 Conversation export。");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const executeImport = async () => {
    if (!preview || preview.already_executed) return;
    setImporting(true);
    setImportMessage("");
    try {
      const result = await client.execute(preview);
      setImportMessage(
        result.outcome === "executed"
          ? "导入完成。"
          : "这份导出已经处理过，没有重复写入。",
      );
      setPreview(null);
      setRefreshKey((value) => value + 1);
    } catch {
      setImportMessage("导入前数据已经变化，或执行失败。请重新选择文件 Preview。");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="page conversation-page">
      <PageHeader
        eyebrow="Conversation Archive"
        title="Conversations"
        description="保存 ChatGPT / Claude 的原始对话档案，按窗口与日期浏览。"
        action={
          <>
            <input
              ref={fileInputRef}
              className="conversation-file-input"
              type="file"
              accept=".json,.zip,application/json,application/zip"
              onChange={(event) => void onFile(event.target.files?.[0] ?? null)}
            />
            <button
              className="secondary-button conversation-import-button"
              type="button"
              disabled={importing}
              onClick={() => fileInputRef.current?.click()}
            >
              {importing ? "处理中…" : "导入对话"}
            </button>
          </>
        }
      />

      {preview ? (
        <section className="conversation-import-preview" aria-live="polite">
          <div>
            <p className="eyebrow">Import Preview</p>
            <h2>{preview.filename}</h2>
            <p>
              {providerLabel(preview.provider)} · {shortBytes(preview.raw_bytes)} ·
              {" "}{preview.summary.conversations.create} 新窗口 ·
              {" "}{preview.summary.conversations.update} 更新 ·
              {" "}{preview.summary.messages.create} 新消息
            </p>
            {preview.summary.conversations.stale || preview.summary.messages.stale ? (
              <p className="conversation-import-note">
                有较旧记录会保留现有新版本，不会回退。
              </p>
            ) : null}
            {preview.warning_count > 0 ? (
              <p className="conversation-import-note">
                {preview.warning_count} 个保留型解析提示；未知 block 仍会保存。
              </p>
            ) : null}
          </div>
          <div className="conversation-import-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setPreview(null)}
            >
              取消
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={importing || preview.already_executed}
              onClick={() => void executeImport()}
            >
              {preview.already_executed ? "已导入" : "确认导入"}
            </button>
          </div>
        </section>
      ) : null}

      {importMessage ? (
        <p className="conversation-inline-status" role="status">{importMessage}</p>
      ) : null}

      <section className="conversation-section">
        <div className="conversation-section-heading">
          <div>
            <p className="eyebrow">Recent 30 days</p>
            <h2>每天聊了多少</h2>
          </div>
          <span>{browserTimeZone()}</span>
        </div>
        {stats.status === "loading" ? (
          <div className="conversation-muted-card">正在读取日统计…</div>
        ) : stats.status === "error" ? (
          <div className="conversation-muted-card">日统计暂时不可用。</div>
        ) : stats.items.length === 0 ? (
          <div className="conversation-muted-card">导入后，这里会按日期显示消息数和轮数。</div>
        ) : (
          <DailyStats items={stats.items} />
        )}
      </section>

      <section className="conversation-section">
        <div className="conversation-section-heading conversation-list-heading">
          <div>
            <p className="eyebrow">Archive</p>
            <h2>对话窗口</h2>
          </div>
          <div className="conversation-provider-filter" aria-label="Provider filter">
            <button className={!provider ? "active" : ""} type="button" onClick={() => setProvider(undefined)}>全部</button>
            <button className={provider === "chatgpt" ? "active" : ""} type="button" onClick={() => setProvider("chatgpt")}>ChatGPT</button>
            <button className={provider === "claude" ? "active" : ""} type="button" onClick={() => setProvider("claude")}>Claude</button>
          </div>
        </div>

        {list.status === "loading" ? (
          <PageState state="loading" message="正在读取 Conversation Archive…" />
        ) : list.status === "error" ? (
          <PageState state="error" message="Conversation Archive 暂时无法读取。" onRetry={() => setRefreshKey((value) => value + 1)} />
        ) : list.items.length === 0 ? (
          <PageState
            state="empty"
            message="还没有导入对话。"
            description="可以直接选择 ChatGPT conversations.json 或 Claude conversations ZIP。"
          />
        ) : (
          <>
            <div className="conversation-list">
              {list.items.map((item) => (
                <Link className="conversation-card" to={`/conversations/${item.id}`} key={item.id}>
                  <div className="conversation-card-topline">
                    <span className={`conversation-provider conversation-provider--${item.provider}`}>
                      {providerLabel(item.provider)}
                    </span>
                    <time>{formatDateTime(item.sourceUpdatedAt ?? item.sourceCreatedAt)}</time>
                  </div>
                  <h3>{item.title?.trim() || "Untitled conversation"}</h3>
                  <p>
                    {item.messageCount.toLocaleString()} 条消息 ·
                    {" "}{item.turnCount.toLocaleString()} 轮
                    {item.totalNodeCount > item.messageCount
                      ? ` · ${item.totalNodeCount.toLocaleString()} nodes`
                      : ""}
                  </p>
                  {item.defaultModel ? <small>{item.defaultModel}</small> : null}
                </Link>
              ))}
            </div>
            <p className="conversation-list-total">共 {list.total.toLocaleString()} 个窗口</p>
          </>
        )}
      </section>
    </div>
  );
}

function DailyStats({ items }: { items: ConversationDailyStat[] }) {
  const grouped = new Map<string, ConversationDailyStat[]>();
  for (const item of items) {
    grouped.set(item.date, [...(grouped.get(item.date) ?? []), item]);
  }
  const dates = [...grouped.keys()].sort((left, right) => right.localeCompare(left));

  return (
    <div className="conversation-day-grid">
      {dates.map((date) => {
        const rows = grouped.get(date) ?? [];
        const messages = rows.reduce((sum, row) => sum + row.messages, 0);
        const turns = rows.reduce((sum, row) => sum + row.turns, 0);
        const windows = rows.reduce((sum, row) => sum + row.conversations, 0);
        return (
          <article className="conversation-day-card" key={date}>
            <time>{date}</time>
            <strong>{messages.toLocaleString()} 条</strong>
            <span>{turns.toLocaleString()} 轮 · {windows.toLocaleString()} 个窗口</span>
            <div>
              {rows.map((row) => (
                <small key={row.provider}>
                  {providerLabel(row.provider)} {row.messages} 条 / {row.turns} 轮
                  {row.pathBasis === "branch_inclusive" ? " · 含分支" : ""}
                </small>
              ))}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ConversationDetailView({
  client,
  conversationId,
}: {
  client: ReturnType<typeof createConversationArchiveApi>;
  conversationId: string;
}) {
  const [view, setView] = useState<"default" | "all">("default");
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const detail = await client.detail(conversationId);
      const messages = await client.messages({
        conversationId,
        view,
        limit: 200,
        offset: 0,
      });
      setState({
        status: "ready",
        detail,
        messages: messages.items,
        totalMessages: messages.total,
      });
    } catch {
      setState({ status: "error" });
    }
  }, [client, conversationId, view]);

  useEffect(() => { void load(); }, [load]);

  const loadMore = async () => {
    if (state.status !== "ready" || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await client.messages({
        conversationId,
        view,
        limit: 200,
        offset: state.messages.length,
      });
      setState({
        ...state,
        messages: [...state.messages, ...next.items],
        totalMessages: next.total,
      });
    } finally {
      setLoadingMore(false);
    }
  };

  if (state.status === "loading") {
    return <div className="page"><PageState state="loading" message="正在读取对话…" /></div>;
  }
  if (state.status === "error") {
    return <div className="page"><PageState state="error" message="这段对话暂时无法读取。" onRetry={() => void load()} /></div>;
  }

  const { detail } = state;
  return (
    <div className="page conversation-page conversation-detail-page">
      <div className="conversation-detail-back">
        <Link to="/conversations">← 返回 Conversations</Link>
      </div>
      <PageHeader
        eyebrow={providerLabel(detail.provider)}
        title={detail.title?.trim() || "Untitled conversation"}
        description={`${detail.messageCount.toLocaleString()} 条普通消息 · ${detail.turnCount.toLocaleString()} 轮 · ${detail.totalNodeCount.toLocaleString()} 个保存节点`}
        action={
          detail.provider === "chatgpt" ? (
            <div className="conversation-view-toggle">
              <button className={view === "default" ? "active" : ""} type="button" onClick={() => setView("default")}>当前路径</button>
              <button className={view === "all" ? "active" : ""} type="button" onClick={() => setView("all")}>全部分支</button>
            </div>
          ) : null
        }
      />

      {detail.provider === "claude" ? (
        <p className="conversation-branch-note">
          Claude 官方导出没有 current leaf。这里按时间显示全部普通可见消息，因此可能包含不同分支。
        </p>
      ) : view === "all" ? (
        <p className="conversation-branch-note">
          当前正在显示 ChatGPT 保存下来的全部普通消息节点，包括非 current path 分支。
        </p>
      ) : null}

      <div className="conversation-message-list">
        {state.messages.map((message) => (
          <article
            className={`conversation-message conversation-message--${message.role}`}
            id={`message-${message.id}`}
            key={message.id}
          >
            <div className="conversation-message-meta">
              <strong>{message.role === "user" ? "You" : providerLabel(detail.provider)}</strong>
              <span>{message.model ?? ""}</span>
              <time>{formatDateTime(message.sourceCreatedAt)}</time>
            </div>
            <div className="conversation-message-text">{message.displayText || "（无可见文本）"}</div>
          </article>
        ))}
      </div>

      {state.messages.length < state.totalMessages ? (
        <button className="secondary-button conversation-load-more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? "读取中…" : `继续加载（${state.messages.length}/${state.totalMessages}）`}
        </button>
      ) : null}
    </div>
  );
}
