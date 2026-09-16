import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { WebApiClient } from "../api/useWebApiClient";
import { PageState } from "../components/StateSurface";
import { PageHeader } from "./PageHeader";
import { ConversationSearchPanel } from "./ConversationSearchPanel";
import { ConversationBatchImportPreview } from "./ConversationBatchImportPreview";
import { ConversationImportHistoryPanel } from "./ConversationImportHistoryPanel";
import { ConversationFavoritesPanel } from "./ConversationFavoritesPanel";
import {
  createConversationArchiveApi,
  type ConversationDailyStat,
  type ConversationDetail,
  type ConversationImportBatchPreview,
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
      contextual: boolean;
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

function detailViewParams(view: "default" | "all"): Record<string, string> {
  return view === "all" ? { view: "all" } : {};
}

function shortBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function favoriteTagsFromText(value: string): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const part of value.split(",")) {
    const tag = part.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(tag);
  }
  return output;
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
  const [batchPreview, setBatchPreview] = useState<ConversationImportBatchPreview | null>(null);
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

  const onFiles = async (fileList: FileList | null) => {
    const files = fileList ? Array.from(fileList) : [];
    if (files.length === 0) return;
    if (files.length > 20) {
      setImportMessage("一次最多选择 20 份 Conversation export。");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setImporting(true);
    setImportMessage("");
    setPreview(null);
    setBatchPreview(null);
    try {
      if (files.length === 1) {
        const result = await client.preview(files[0]!);
        setPreview(result);
        if (result.already_executed) {
          setImportMessage("这份原始导出已经导入过，不会重复写入。");
        }
        return;
      }

      const runIds: string[] = [];
      for (const file of files) {
        const result = await client.preview(file);
        runIds.push(result.import_run_id);
      }
      const result = await client.previewBatch(runIds);
      setBatchPreview(result);
      if (result.files.pending === 0) {
        setImportMessage("这批文件都已经导入过或属于批内重复，不会产生新的写入。");
      }
    } catch {
      setImportMessage(
        "无法生成整批 Preview。已经成功读取的 source 只会保留在 Import history，不会自动执行写入。",
      );
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

  const executeBatchImport = async () => {
    if (!batchPreview || batchPreview.files.pending === 0) return;
    setImporting(true);
    setImportMessage("");
    try {
      const result = await client.executeBatch(batchPreview);
      setImportMessage(
        result.outcome === "executed"
          ? "整批导入完成。"
          : "这批导出已经处理过，没有重复写入。",
      );
      setBatchPreview(null);
      setRefreshKey((value) => value + 1);
    } catch {
      setImportMessage(
        "整批导入前数据已经变化，或执行失败。请重新选择这些文件生成新的 Batch Preview。",
      );
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
              multiple
              onChange={(event) => void onFiles(event.target.files)}
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
            {(preview.exclusions?.conversations ?? 0) > 0 || (preview.exclusions?.messages ?? 0) > 0 ? (
              <p className="conversation-import-note">
                已按你的删除规则跳过 {preview.exclusions?.conversations ?? 0} 个窗口、
                {" "}{preview.exclusions?.messages ?? 0} 个消息节点；后续导入也不会加回来。
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

      {batchPreview ? (
        <ConversationBatchImportPreview
          preview={batchPreview}
          importing={importing}
          onCancel={() => setBatchPreview(null)}
          onExecute={() => void executeBatchImport()}
        />
      ) : null}

      {importMessage ? (
        <p className="conversation-inline-status" role="status">{importMessage}</p>
      ) : null}

      <ConversationFavoritesPanel client={client} />

      <ConversationImportHistoryPanel
        client={client}
        refreshKey={refreshKey}
        onPreview={(result) => {
          setBatchPreview(null);
          setPreview(result);
          setImportMessage("");
        }}
      />

      <ConversationSearchPanel
        client={client}
        conversations={list.status === "ready" ? list.items : []}
      />

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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const view: "default" | "all" = searchParams.get("view") === "all" ? "all" : "default";
  const anchorId = searchParams.get("anchor");
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [pruningMessageId, setPruningMessageId] = useState<string | null>(null);
  const [pruneStatus, setPruneStatus] = useState("");
  const [favoriteRangeMode, setFavoriteRangeMode] = useState(false);
  const [favoriteRangeStartId, setFavoriteRangeStartId] = useState<string | null>(null);
  const [favoriteDraft, setFavoriteDraft] = useState<{
    startMessageId: string;
    endMessageId: string;
    title: string;
    note: string;
    tags: string;
  } | null>(null);
  const [favoriteSaving, setFavoriteSaving] = useState(false);
  const [favoriteStatus, setFavoriteStatus] = useState("");

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const detail = await client.detail(conversationId);
      if (anchorId) {
        const context = await client.messageContext({
          conversationId,
          messageId: anchorId,
          view,
          radius: 20,
        });
        setState({
          status: "ready",
          detail,
          messages: context.items,
          totalMessages: context.total,
          contextual: true,
        });
      } else {
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
          contextual: false,
        });
      }
    } catch {
      setState({ status: "error" });
    }
  }, [anchorId, client, conversationId, view]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    setFavoriteRangeMode(false);
    setFavoriteRangeStartId(null);
    setFavoriteDraft(null);
    setFavoriteStatus("");
  }, [conversationId, view]);

  useEffect(() => {
    if (state.status !== "ready" || !anchorId) return;
    const handle = window.requestAnimationFrame(() => {
      document.getElementById(`message-${anchorId}`)?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    });
    return () => window.cancelAnimationFrame(handle);
  }, [anchorId, state]);

  const loadMore = async () => {
    if (state.status !== "ready" || state.contextual || loadingMore) return;
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
        contextual: false,
      });
    } finally {
      setLoadingMore(false);
    }
  };

  const deleteWindow = async () => {
    if (!window.confirm(
      "从 Conversation Archive 删除整个窗口，并记住以后导入也跳过它？\n\n原始 export 文件仍会保留。",
    )) return;
    setPruneStatus("");
    try {
      const result = await client.deleteConversation(conversationId);
      setPruneStatus(`已删除 ${result.deletedMessages} 个保存节点。`);
      navigate("/conversations", { replace: true });
    } catch {
      setPruneStatus("窗口删除失败。");
    }
  };

  const deleteBranch = async (message: ConversationMessage) => {
    if (!window.confirm(
      "从这条消息开始删除整个分支，并记住以后导入也跳过这个分支？\n\n原始 export 文件仍会保留。",
    )) return;
    setPruningMessageId(message.id);
    setPruneStatus("");
    try {
      const result = await client.deleteBranch({
        conversationId,
        messageId: message.id,
      });
      setPruneStatus(
        `已删除这个分支的 ${result.deletedMessages} 个保存节点；后续导入不会加回来。`,
      );
      if (anchorId) {
        setSearchParams(
          detailViewParams(view),
          { replace: true },
        );
      } else {
        await load();
      }
    } catch {
      setPruneStatus("这个分支无法删除；如果它包含整个窗口，请直接删除窗口。");
    } finally {
      setPruningMessageId(null);
    }
  };

  const openSingleFavorite = (messageId: string) => {
    setFavoriteRangeMode(false);
    setFavoriteRangeStartId(null);
    setFavoriteStatus("");
    setFavoriteDraft({
      startMessageId: messageId,
      endMessageId: messageId,
      title: "",
      note: "",
      tags: "",
    });
  };

  const toggleFavoriteRangeMode = () => {
    setFavoriteDraft(null);
    setFavoriteStatus("");
    setFavoriteRangeStartId(null);
    setFavoriteRangeMode((current) => !current);
  };

  const chooseFavoriteMessage = (messageId: string) => {
    if (!favoriteRangeMode) {
      openSingleFavorite(messageId);
      return;
    }
    if (!favoriteRangeStartId) {
      setFavoriteRangeStartId(messageId);
      setFavoriteStatus("已选收藏范围起点，再选一条消息作为终点。");
      return;
    }
    setFavoriteDraft({
      startMessageId: favoriteRangeStartId,
      endMessageId: messageId,
      title: "",
      note: "",
      tags: "",
    });
    setFavoriteRangeMode(false);
    setFavoriteRangeStartId(null);
    setFavoriteStatus("");
  };

  const saveFavorite = async () => {
    if (!favoriteDraft || favoriteSaving) return;
    setFavoriteSaving(true);
    setFavoriteStatus("");
    try {
      const result = await client.createFavorite({
        conversationId,
        startMessageId: favoriteDraft.startMessageId,
        endMessageId: favoriteDraft.endMessageId,
        view,
        title: favoriteDraft.title,
        note: favoriteDraft.note,
        tags: favoriteTagsFromText(favoriteDraft.tags),
      });
      setFavoriteDraft(null);
      setFavoriteRangeMode(false);
      setFavoriteRangeStartId(null);
      setFavoriteStatus(`已保存 Favorite snapshot（${result.messageCount} 条消息）。`);
    } catch {
      setFavoriteStatus(
        "Favorite 保存失败。连续范围最多 200 条；标题最多 200 字，备注最多 4000 字，最多 20 个标签。",
      );
    } finally {
      setFavoriteSaving(false);
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
          <div className="conversation-detail-actions">
            {detail.provider === "chatgpt" ? (
              <div className="conversation-view-toggle">
                <button
                  className={view === "default" ? "active" : ""}
                  type="button"
                  onClick={() => setSearchParams({})}
                >
                  当前路径
                </button>
                <button
                  className={view === "all" ? "active" : ""}
                  type="button"
                  onClick={() => setSearchParams({ view: "all" })}
                >
                  全部分支
                </button>
              </div>
            ) : null}
            <button
              className={`secondary-button conversation-favorite-range-toggle${favoriteRangeMode ? " active" : ""}`}
              type="button"
              onClick={toggleFavoriteRangeMode}
            >
              {favoriteRangeMode ? "取消范围选择" : "选择收藏范围"}
            </button>
            <button
              className="conversation-danger-button"
              type="button"
              aria-label="删除整个对话窗口并在后续导入中排除"
              title="删除窗口；原始 export 仍保留"
              onClick={() => void deleteWindow()}
            >
              删除窗口
            </button>
          </div>
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

      {favoriteStatus ? (
        <p className="conversation-inline-status" role="status">{favoriteStatus}</p>
      ) : null}

      {favoriteRangeMode ? (
        <div className="conversation-favorite-range-banner" role="status">
          {favoriteRangeStartId
            ? "已选起点。再点一条消息作为连续范围终点。"
            : "点一条消息作为收藏范围起点，再点另一条作为终点。"}
        </div>
      ) : null}

      {favoriteDraft ? (
        <section className="conversation-favorite-composer" aria-label="保存 Conversation Favorite">
          <div>
            <p className="eyebrow">Favorite snapshot</p>
            <h2>
              {favoriteDraft.startMessageId === favoriteDraft.endMessageId
                ? "收藏这条消息"
                : "收藏连续消息范围"}
            </h2>
            <p>保存后会保留独立 snapshot；以后即使原窗口或分支被删除，这份 Favorite 仍保留。</p>
          </div>
          <div className="conversation-favorite-composer-fields">
            <label>
              <span>标题（可选）</span>
              <input
                value={favoriteDraft.title}
                maxLength={200}
                onChange={(event) => setFavoriteDraft({
                  ...favoriteDraft,
                  title: event.target.value,
                })}
              />
            </label>
            <label>
              <span>备注（可选）</span>
              <textarea
                value={favoriteDraft.note}
                maxLength={4000}
                rows={3}
                onChange={(event) => setFavoriteDraft({
                  ...favoriteDraft,
                  note: event.target.value,
                })}
              />
            </label>
            <label>
              <span>标签（逗号分隔，可选）</span>
              <input
                value={favoriteDraft.tags}
                onChange={(event) => setFavoriteDraft({
                  ...favoriteDraft,
                  tags: event.target.value,
                })}
              />
            </label>
          </div>
          <div className="conversation-import-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={favoriteSaving}
              onClick={() => setFavoriteDraft(null)}
            >
              取消
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={favoriteSaving}
              onClick={() => void saveFavorite()}
            >
              {favoriteSaving ? "保存中…" : "保存 Favorite"}
            </button>
          </div>
        </section>
      ) : null}

      {pruneStatus ? (
        <p className="conversation-inline-status" role="status">{pruneStatus}</p>
      ) : null}

      {state.contextual && anchorId ? (
        <div className="conversation-context-banner">
          <span>已定位到搜索结果，显示前后上下文。</span>
          <button
            type="button"
            onClick={() => setSearchParams(view === "all" ? { view: "all" } : {})}
          >
            从头查看
          </button>
        </div>
      ) : null}

      <div className="conversation-message-list">
        {state.messages.map((message) => (
          <article
            className={`conversation-message conversation-message--${message.role}${message.id === anchorId ? " conversation-message--anchor" : ""}`}
            id={`message-${message.id}`}
            key={message.id}
          >
            <div className="conversation-message-meta">
              <strong>{message.role === "user" ? "You" : providerLabel(detail.provider)}</strong>
              <span>{message.model ?? ""}</span>
              <time>{formatDateTime(message.sourceCreatedAt)}</time>
              <button
                className={`conversation-message-favorite${favoriteRangeStartId === message.id ? " active" : ""}`}
                type="button"
                disabled={favoriteSaving}
                aria-label={favoriteRangeMode
                  ? favoriteRangeStartId
                    ? "选择这条消息作为 Favorite 范围终点"
                    : "选择这条消息作为 Favorite 范围起点"
                  : "收藏这条消息"}
                onClick={() => chooseFavoriteMessage(message.id)}
              >
                {favoriteRangeMode
                  ? favoriteRangeStartId === message.id
                    ? "起点"
                    : favoriteRangeStartId
                      ? "选终点"
                      : "选起点"
                  : "收藏"}
              </button>
              {(detail.provider === "claude" || view === "all") ? (
                <button
                  className="conversation-message-prune"
                  type="button"
                  aria-label="从这条消息开始删除整个分支并在后续导入中排除"
                  title="删除此分支；原始 export 仍保留"
                  disabled={pruningMessageId !== null}
                  onClick={() => void deleteBranch(message)}
                >
                  {pruningMessageId === message.id ? "删除中…" : "删此分支"}
                </button>
              ) : null}
            </div>
            <div className="conversation-message-text">{message.displayText || "（无可见文本）"}</div>
          </article>
        ))}
      </div>

      {!state.contextual && state.messages.length < state.totalMessages ? (
        <button className="secondary-button conversation-load-more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? "读取中…" : `继续加载（${state.messages.length}/${state.totalMessages}）`}
        </button>
      ) : null}
    </div>
  );
}
