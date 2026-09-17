import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { WebApiClient } from "../api/useWebApiClient";
import { ModuleSearchButton, ModuleSearchField } from "../components/ModuleSearch";
import { PageState } from "../components/StateSurface";
import { PageHeader } from "./PageHeader";
import { ConversationSearchPanel } from "./ConversationSearchPanel";
import { ConversationBatchImportPreview } from "./ConversationBatchImportPreview";
import { ConversationImportHistoryPanel } from "./ConversationImportHistoryPanel";
import { ConversationFavoritesPanel } from "./ConversationFavoritesPanel";
import {
  createConversationArchiveApi,
  type ConversationDetail,
  type ConversationFavoriteListItem,
  type ConversationImportBatchPreview,
  type ConversationImportPreview,
  type ConversationListItem,
  type ConversationMessage,
  type ConversationProvider,
} from "./conversation-archive-api";
import "./conversations.css";

type ListState =
  | { status: "loading" }
  | { status: "ready"; items: ConversationListItem[]; total: number }
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

type PendingScrollRestore = {
  anchorMessageId: string;
  viewportOffset: number;
  loadedPages: number;
};

const MESSAGE_PAGE_SIZE = 200;

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatRowDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(date);
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
  const [surface, setSurface] = useState<"archive" | "favorites" | "sources">("archive");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [list, setList] = useState<ListState>({ status: "loading" });
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

  useEffect(() => { void load(); }, [load]);

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
      <input
        ref={fileInputRef}
        className="conversation-file-input"
        type="file"
        accept=".json,.zip,application/json,application/zip"
        multiple
        onChange={(event) => void onFiles(event.target.files)}
      />

      <header
        className="memory-page-header conversation-page-header"
        onKeyDown={(event) => {
          if (event.key === "Escape") setSearchOpen(false);
        }}
      >
        <div className="memory-page-heading">
          <div className="memory-page-title">Conversations</div>
          <div className="memory-page-count">
            {list.status === "ready" ? `${list.total.toLocaleString()}个窗口` : "0个窗口"}
          </div>
        </div>

        <div className="memory-page-tools conversation-page-tools">
          <ModuleSearchButton
            label="搜索对话"
            expanded={searchOpen}
            onClick={() => setSearchOpen((value) => !value)}
          />
        </div>

        {searchOpen ? (
          <ModuleSearchField
            ariaLabel="搜索 Conversation Archive"
            placeholder="搜索你或 AI 说过的话"
            value={searchQuery}
            onChange={setSearchQuery}
            className="conversation-page-search"
          />
        ) : null}
      </header>

      {searchOpen ? (
        <ConversationSearchPanel
          client={client}
          conversations={list.status === "ready" ? list.items : []}
          query={searchQuery}
        />
      ) : null}

      <nav className="conversation-surface-tabs" aria-label="Conversation Archive sections">
        <button
          className={surface === "archive" ? "active" : ""}
          type="button"
          onClick={() => setSurface("archive")}
        >
          Conversations
        </button>
        <button
          className={surface === "favorites" ? "active" : ""}
          type="button"
          onClick={() => setSurface("favorites")}
        >
          Favorites
        </button>
        <button
          className={surface === "sources" ? "active" : ""}
          type="button"
          onClick={() => setSurface("sources")}
        >
          Sources
        </button>
      </nav>

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
              <p className="conversation-import-note">有较旧记录会保留现有新版本，不会回退。</p>
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
            <button className="secondary-button" type="button" onClick={() => setPreview(null)}>取消</button>
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

      {importMessage ? <p className="conversation-inline-status" role="status">{importMessage}</p> : null}

      {surface === "favorites" ? <ConversationFavoritesPanel client={client} /> : null}

      {surface === "sources" ? (
        <>
          <section className="conversation-source-import" aria-label="导入 Conversation export">
            <div className="conversation-source-import-row">
              <span>ChatGPT / Claude export</span>
              <button
                type="button"
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
              >
                {importing ? "处理中…" : "选择文件"}
              </button>
            </div>
          </section>
          <ConversationImportHistoryPanel
            client={client}
            refreshKey={refreshKey}
            onImportExecuted={() => setRefreshKey((value) => value + 1)}
            onPreview={(result) => {
              setBatchPreview(null);
              setPreview(result);
              setImportMessage("");
            }}
          />
        </>
      ) : null}

      {surface === "archive" ? (
        <section className="conversation-section conversation-archive-section">
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
            <p className="system-state-copy" role="status" aria-live="polite">正在读取 Conversation Archive…</p>
          ) : list.status === "error" ? (
            <PageState state="error" message="Conversation Archive 暂时无法读取。" onRetry={() => setRefreshKey((value) => value + 1)} />
          ) : list.items.length === 0 ? (
            <PageState
              state="empty"
              message="还没有导入对话。"
              description="可以在 Sources 里导入 ChatGPT conversations.json 或 Claude conversations ZIP。"
            />
          ) : (
            <>
              <div className="conversation-list">
                {list.items.map((item) => (
                  <Link className="conversation-card" to={`/conversations/${item.id}`} key={item.id}>
                    <h3>{item.title?.trim() || "Untitled conversation"}</h3>
                    <div className="conversation-card-meta">
                      <span>{formatRowDate(item.sourceUpdatedAt ?? item.sourceCreatedAt)}</span>
                      <span>
                        {providerLabel(item.provider)} · {item.messageCount.toLocaleString()} 条 ·
                        {" "}{item.turnCount.toLocaleString()} 轮
                        {item.totalNodeCount > item.messageCount ? ` · ${item.totalNodeCount.toLocaleString()} nodes` : ""}
                        {item.defaultModel ? ` · ${item.defaultModel}` : ""}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
              <p className="conversation-list-total">共 {list.total.toLocaleString()} 个窗口</p>
            </>
          )}
        </section>
      ) : null}
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
  const [favoriteRangeNotice, setFavoriteRangeNotice] = useState("");
  const [favoriteItems, setFavoriteItems] = useState<ConversationFavoriteListItem[]>([]);
  const [favoriteBusyId, setFavoriteBusyId] = useState<string | null>(null);
  const [favoriteErrorIds, setFavoriteErrorIds] = useState<Set<string>>(() => new Set());
  const pendingScrollRestoreRef = useRef<PendingScrollRestore | null>(null);

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
        const pendingRestore = pendingScrollRestoreRef.current;
        if (pendingRestore) {
          const restoredMessages: ConversationMessage[] = [];
          let totalMessages = 0;
          let loadedPages = 0;
          let foundAnchor = false;

          while (loadedPages < pendingRestore.loadedPages && !foundAnchor) {
            const page = await client.messages({
              conversationId,
              view,
              limit: MESSAGE_PAGE_SIZE,
              offset: restoredMessages.length,
            });
            totalMessages = page.total;
            restoredMessages.push(...page.items);
            loadedPages += 1;
            foundAnchor = restoredMessages.some((item) => item.id === pendingRestore.anchorMessageId);
            if (page.items.length === 0 || restoredMessages.length >= page.total) break;
          }

          setState({
            status: "ready",
            detail,
            messages: restoredMessages,
            totalMessages,
            contextual: false,
          });
        } else {
          const messages = await client.messages({
            conversationId,
            view,
            limit: MESSAGE_PAGE_SIZE,
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
      }
    } catch {
      setState({ status: "error" });
    }
  }, [anchorId, client, conversationId, view]);

  const loadFavorites = useCallback(async () => {
    try {
      const result = await client.listFavorites({ conversationId, limit: 100, offset: 0 });
      setFavoriteItems(result.items);
    } catch {
      setFavoriteItems([]);
    }
  }, [client, conversationId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadFavorites(); }, [loadFavorites]);

  useEffect(() => {
    setFavoriteRangeMode(false);
    setFavoriteRangeStartId(null);
    setFavoriteRangeNotice("");
    setFavoriteErrorIds(new Set());
  }, [conversationId, view]);

  useEffect(() => {
    if (state.status !== "ready" || !anchorId || pendingScrollRestoreRef.current) return;
    const handle = window.requestAnimationFrame(() => {
      document.getElementById(`message-${anchorId}`)?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    });
    return () => window.cancelAnimationFrame(handle);
  }, [anchorId, state]);

  useEffect(() => {
    if (state.status !== "ready") return;
    const pending = pendingScrollRestoreRef.current;
    if (!pending) return;
    const element = document.getElementById(`message-${pending.anchorMessageId}`);
    if (!element) {
      pendingScrollRestoreRef.current = null;
      return;
    }
    const first = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const delta = element.getBoundingClientRect().top - pending.viewportOffset;
        window.scrollBy({ top: delta, left: 0, behavior: "auto" });
        pendingScrollRestoreRef.current = null;
      });
    });
    return () => window.cancelAnimationFrame(first);
  }, [state]);

  const singleFavoriteByMessageId = useMemo(() => {
    const map = new Map<string, ConversationFavoriteListItem>();
    for (const item of favoriteItems) {
      if (item.startMessageId === item.endMessageId) map.set(item.startMessageId, item);
    }
    return map;
  }, [favoriteItems]);

  const loadMore = async () => {
    if (state.status !== "ready" || state.contextual || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await client.messages({
        conversationId,
        view,
        limit: MESSAGE_PAGE_SIZE,
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

  const captureScrollRestore = async (
    message: ConversationMessage,
  ): Promise<PendingScrollRestore | null> => {
    if (state.status !== "ready") return null;

    const deletedSourceNodeIds = new Set<string>([message.sourceNodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of state.messages) {
        if (
          item.parentSourceNodeId
          && deletedSourceNodeIds.has(item.parentSourceNodeId)
          && !deletedSourceNodeIds.has(item.sourceNodeId)
        ) {
          deletedSourceNodeIds.add(item.sourceNodeId);
          changed = true;
        }
      }
    }

    const survivors = state.messages.filter((item) => !deletedSourceNodeIds.has(item.sourceNodeId));
    const viewportAnchor = survivors.find((item) => {
      const element = document.getElementById(`message-${item.id}`);
      return Boolean(element && element.getBoundingClientRect().bottom > 0);
    }) ?? survivors.at(-1);
    if (!viewportAnchor) return null;

    const element = document.getElementById(`message-${viewportAnchor.id}`);
    if (!element) return null;

    let loadedPages = Math.max(1, Math.ceil(state.messages.length / MESSAGE_PAGE_SIZE));
    if (state.contextual) {
      try {
        const context = await client.messageContext({
          conversationId,
          messageId: viewportAnchor.id,
          view,
          radius: 0,
        });
        loadedPages = Math.max(
          loadedPages,
          Math.ceil((context.anchorIndex + 1) / MESSAGE_PAGE_SIZE),
        );
      } catch {
        // Fall back to the rendered slice. Deletion itself must not depend on this read.
      }
    }

    return {
      anchorMessageId: viewportAnchor.id,
      viewportOffset: element.getBoundingClientRect().top,
      loadedPages,
    };
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
    const pendingRestore = await captureScrollRestore(message);
    try {
      const result = await client.deleteBranch({
        conversationId,
        messageId: message.id,
      });
      setPruneStatus(
        `已删除这个分支的 ${result.deletedMessages} 个保存节点；后续导入不会加回来。`,
      );
      pendingScrollRestoreRef.current = pendingRestore;
      setState({ status: "loading" });
      if (anchorId) {
        setSearchParams(detailViewParams(view), { replace: true });
      } else {
        await load();
      }
    } catch {
      pendingScrollRestoreRef.current = null;
      setPruneStatus("这个分支无法删除；如果它包含整个窗口，请直接删除窗口。");
    } finally {
      setPruningMessageId(null);
    }
  };

  const toggleSingleFavorite = async (messageId: string) => {
    if (favoriteBusyId) return;
    const existing = singleFavoriteByMessageId.get(messageId);
    setFavoriteBusyId(messageId);
    setFavoriteErrorIds((current) => {
      const next = new Set(current);
      next.delete(messageId);
      return next;
    });
    try {
      if (existing) {
        await client.deleteFavorite(existing.id);
        setFavoriteItems((current) => current.filter((item) => item.id !== existing.id));
      } else {
        const created = await client.createFavorite({
          conversationId,
          startMessageId: messageId,
          endMessageId: messageId,
          view,
        });
        setFavoriteItems((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      }
    } catch {
      setFavoriteErrorIds((current) => new Set(current).add(messageId));
    } finally {
      setFavoriteBusyId(null);
    }
  };

  const toggleFavoriteRangeMode = () => {
    setFavoriteRangeStartId(null);
    setFavoriteRangeNotice("");
    setFavoriteRangeMode((current) => !current);
  };

  const chooseFavoriteMessage = async (messageId: string) => {
    if (!favoriteRangeMode) {
      await toggleSingleFavorite(messageId);
      return;
    }
    if (!favoriteRangeStartId) {
      setFavoriteRangeStartId(messageId);
      setFavoriteRangeNotice("已选起点，再点一条消息作为终点。");
      return;
    }
    if (favoriteBusyId) return;
    setFavoriteBusyId(messageId);
    setFavoriteRangeNotice("正在收藏这个范围…");
    try {
      const created = await client.createFavorite({
        conversationId,
        startMessageId: favoriteRangeStartId,
        endMessageId: messageId,
        view,
      });
      setFavoriteItems((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setFavoriteRangeNotice("已收藏这个范围。");
      setFavoriteRangeMode(false);
      setFavoriteRangeStartId(null);
    } catch {
      setFavoriteRangeNotice("收藏失败，再点一次终点重试。");
    } finally {
      setFavoriteBusyId(null);
    }
  };

  if (state.status === "loading") {
    return (
      <div className="page conversation-page conversation-detail-page conversation-detail-state">
        <PageState state="loading" message="正在读取对话…" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="page conversation-page conversation-detail-page conversation-detail-state">
        <PageState state="error" message="这段对话暂时无法读取。" onRetry={() => void load()} />
      </div>
    );
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
                <button className={view === "default" ? "active" : ""} type="button" onClick={() => setSearchParams({})}>当前路径</button>
                <button className={view === "all" ? "active" : ""} type="button" onClick={() => setSearchParams({ view: "all" })}>全部分支</button>
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

      {favoriteRangeMode || favoriteRangeNotice ? (
        <div className="conversation-favorite-range-banner" role="status">
          {favoriteRangeNotice || "点一条消息作为收藏范围起点，再点另一条作为终点。"}
        </div>
      ) : null}

      {pruneStatus ? <p className="conversation-inline-status" role="status">{pruneStatus}</p> : null}

      {state.contextual && anchorId ? (
        <div className="conversation-context-banner">
          <span>已定位到搜索结果，显示前后上下文。</span>
          <button type="button" onClick={() => setSearchParams(view === "all" ? { view: "all" } : {})}>从头查看</button>
        </div>
      ) : null}

      <div className="conversation-message-list">
        {state.messages.map((message) => {
          const singleFavorite = singleFavoriteByMessageId.get(message.id);
          const favoriteBusy = favoriteBusyId === message.id;
          const favoriteError = favoriteErrorIds.has(message.id);
          return (
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
                  className={`conversation-message-favorite${singleFavorite || favoriteRangeStartId === message.id ? " active" : ""}`}
                  type="button"
                  disabled={favoriteBusyId !== null}
                  aria-label={favoriteRangeMode
                    ? favoriteRangeStartId
                      ? "选择这条消息作为收藏范围终点"
                      : "选择这条消息作为收藏范围起点"
                    : singleFavorite
                      ? "取消收藏这条消息"
                      : "收藏这条消息"}
                  onClick={() => void chooseFavoriteMessage(message.id)}
                >
                  {favoriteBusy
                    ? "处理中…"
                    : favoriteRangeMode
                      ? favoriteRangeStartId === message.id
                        ? "起点"
                        : favoriteRangeStartId
                          ? "选终点"
                          : "选起点"
                      : favoriteError
                        ? "重试"
                        : singleFavorite
                          ? "取消收藏"
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
          );
        })}
      </div>

      {!state.contextual && state.messages.length < state.totalMessages ? (
        <button
          className="secondary-button conversation-load-more"
          type="button"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? "读取中…" : `继续加载（${state.messages.length}/${state.totalMessages}）`}
        </button>
      ) : null}
    </div>
  );
}
