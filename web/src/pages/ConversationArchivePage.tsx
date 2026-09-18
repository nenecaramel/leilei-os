import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { WebApiClient } from "../api/useWebApiClient";
import { ModuleSearchButton, ModuleSearchField } from "../components/ModuleSearch";
import { ArchiveIcon, PlusIcon, TrashIcon } from "../components/icons";
import { PageState } from "../components/StateSurface";
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
import { groupConversationsByMonth } from "./conversation-presentation";
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

function detailViewParams(
  view: "default" | "all",
  scope: "active" | "archived" | "deleted" = "active",
  branchId?: string | null,
): Record<string, string> {
  return {
    ...(view === "all" ? { view: "all" } : {}),
    ...(scope !== "active" ? { scope } : {}),
    ...(branchId ? { branch: branchId } : {}),
  };
}

function shortBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function ConversationMonthLoading({ label }: { label: string }) {
  return (
    <section className="memory-months" aria-label={label} aria-busy="true">
      <span className="visually-hidden" role="status" aria-live="polite">正在读取…</span>
      {[0, 1].map((index) => (
        <div className="memory-month-skeleton" aria-hidden="true" key={index}>
          <span className="memory-month-skeleton-label" />
          <div className="memory-month-skeleton-card"><span /><span /></div>
        </div>
      ))}
    </section>
  );
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
  const navigate = useNavigate();
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

  const conversationGroups = useMemo(
    () => list.status === "ready"
      ? groupConversationsByMonth(list.items, (item) => item.sourceCreatedAt ?? item.sourceUpdatedAt)
      : [],
    [list],
  );

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
    <div className="page memory-page conversation-page">
      <input
        ref={fileInputRef}
        className="conversation-file-input"
        type="file"
        accept=".json,.zip,application/json,application/zip"
        multiple
        onChange={(event) => void onFiles(event.target.files)}
      />

      <header
        className="memory-page-header"
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

        <div className="memory-page-tools">
          <ModuleSearchButton
            label="搜索对话"
            expanded={searchOpen}
            onClick={() => setSearchOpen((value) => !value)}
          />
          <button type="button" aria-label="查看归档" title="Archive" onClick={() => navigate("/conversations/archive")}><ArchiveIcon /></button>
          <button type="button" aria-label="查看已删除" title="Deleted" onClick={() => navigate("/conversations/deleted")}><TrashIcon /></button>
          <button
            type="button"
            aria-label="导入 Conversation export"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
          >
            <PlusIcon className="memory-page-search-icon" />
          </button>
        </div>

        {searchOpen ? (
          <ModuleSearchField
            ariaLabel="搜索 Conversation Archive"
            placeholder="搜索你或 AI 说过的话"
            value={searchQuery}
            onChange={setSearchQuery}
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
            <div className="conversation-provider-filter" aria-label="Provider filter">
              <button className={!provider ? "active" : ""} type="button" onClick={() => setProvider(undefined)}>全部</button>
              <button className={provider === "chatgpt" ? "active" : ""} type="button" onClick={() => setProvider("chatgpt")}>ChatGPT</button>
              <button className={provider === "claude" ? "active" : ""} type="button" onClick={() => setProvider("claude")}>Claude</button>
            </div>
          </div>

          {list.status === "loading" ? (
            <ConversationMonthLoading label="Conversation 加载中" />
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
              <section className="memory-months" aria-label="Conversation 列表">
                {conversationGroups.map((group) => (
                  <section className="memory-month-section" key={group.key}>
                    <h2 className="memory-month-label">{group.label}</h2>
                    <div className="memory-month-card conversation-list">
                      {group.items.map((item) => (
                        <Link
                          className="memory-row conversation-card"
                          to={`/conversations/${item.id}`}
                          key={item.id}
                          aria-label={item.title?.trim() || "Untitled conversation"}
                        >
                          <span className="memory-row-title">
                            {item.title?.trim() || "Untitled conversation"}
                          </span>
                          <span className="memory-row-meta">
                            <span>{formatRowDate(item.sourceCreatedAt ?? item.sourceUpdatedAt)}</span>
                            <span>
                              {providerLabel(item.provider)}
                              {` · ${item.messageCount.toLocaleString()} 条 · ${item.turnCount.toLocaleString()} 轮`}
                              {item.totalNodeCount > item.messageCount ? ` · ${item.totalNodeCount.toLocaleString()} nodes` : ""}
                              {item.defaultModel ? ` · ${item.defaultModel}` : ""}
                            </span>
                          </span>
                        </Link>
                      ))}
                    </div>
                  </section>
                ))}
              </section>
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
  const scope: "active" | "archived" | "deleted" = searchParams.get("scope") === "archived"
    ? "archived"
    : searchParams.get("scope") === "deleted" ? "deleted" : "active";
  const branchId = searchParams.get("branch");
  const anchorId = searchParams.get("anchor");
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [pruningMessageId, setPruningMessageId] = useState<string | null>(null);
  const [pruneStatus, setPruneStatus] = useState("");
  const [confirmPermanentDelete, setConfirmPermanentDelete] = useState(false);
  const [favoriteItems, setFavoriteItems] = useState<ConversationFavoriteListItem[]>([]);
  const [favoriteBusyId, setFavoriteBusyId] = useState<string | null>(null);
  const [favoriteErrorIds, setFavoriteErrorIds] = useState<Set<string>>(() => new Set());
  const pendingScrollRestoreRef = useRef<PendingScrollRestore | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const detail = await client.detail(conversationId, scope, branchId ?? undefined);
      if (anchorId) {
        const context = await client.messageContext({
            conversationId,
            messageId: anchorId,
            view,
            radius: 20,
            scope,
            branchId: branchId ?? undefined,
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
              scope,
              branchId: branchId ?? undefined,
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
              scope,
              branchId: branchId ?? undefined,
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
  }, [anchorId, branchId, client, conversationId, scope, view]);

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
        scope,
        branchId: branchId ?? undefined,
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
          scope,
          branchId: branchId ?? undefined,
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
      "把整个 Conversation 移到 Deleted？之后可以恢复。\n\n原始 export 文件仍会保留。",
    )) return;
    setPruneStatus("");
    try {
      const result = await client.deleteConversation(conversationId);
      setPruneStatus(`已移到 Deleted（${result.deletedMessages} 个保存节点可恢复）。`);
      navigate("/conversations", { replace: true });
    } catch {
      setPruneStatus("窗口删除失败。");
    }
  };

  const archiveWindow = async () => {
    if (!window.confirm("归档这个 Conversation？之后可在 Archive 中恢复。")) return;
    setPruneStatus("");
    try {
      await client.archiveConversation(conversationId);
      navigate("/conversations", { replace: true });
    } catch {
      setPruneStatus("窗口归档失败。");
    }
  };

  const deleteBranch = async (message: ConversationMessage) => {
    if (!window.confirm(
      "把这个分支移到 Deleted？之后可以恢复。\n\n原始 export 文件仍会保留。",
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
        `已把这个分支移到 Deleted（${result.deletedMessages} 个保存节点可恢复）。`,
      );
      pendingScrollRestoreRef.current = pendingRestore;
      setState({ status: "loading" });
      if (anchorId) {
        setSearchParams(detailViewParams(view, scope, branchId), { replace: true });
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

  if (state.status === "loading") {
    return (
      <div className="page memory-page conversation-page conversation-detail-page conversation-detail-state">
        <p className="conversation-detail-loading" role="status" aria-live="polite">正在读取…</p>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="page memory-page conversation-page conversation-detail-page conversation-detail-state">
        <PageState state="error" message="这段对话暂时无法读取。" onRetry={() => void load()} />
      </div>
    );
  }

  const { detail } = state;
  return (
    <div className="page memory-page conversation-page conversation-detail-page">
      <header className="memory-page-header memory-archive-header conversation-detail-header">
        <div className="memory-page-heading">
          <div className="memory-page-title">{detail.title?.trim() || "Untitled conversation"}</div>
          <div className="memory-page-count">
            {detail.messageCount.toLocaleString()}条消息 · {detail.turnCount.toLocaleString()}轮 · {detail.totalNodeCount.toLocaleString()}个节点
          </div>
        </div>
        <div className="conversation-detail-header-actions">
          {scope === "active" ? (
            <button className="memory-archive-back" type="button" onClick={() => void archiveWindow()}>Archive</button>
          ) : null}
          {scope === "archived" ? (
            <button className="memory-archive-back" type="button" onClick={() => void client.restoreConversation(conversationId).then(() => navigate("/conversations/archive"))}>Restore</button>
          ) : null}
          {scope === "deleted" ? (
            <>
            {confirmPermanentDelete ? <>
              <span>{"永久从 Conversation Archive 删除并阻止后续重新导入；原始 export 仍保留。"}</span>
              <button className="memory-archive-back" type="button" onClick={() => {
                if (branchId) {
                  void client.permanentlyDeleteBranch({ conversationId, branchId }).then(() => navigate("/conversations/deleted"));
                } else {
                  void client.permanentlyDeleteConversation(conversationId).then(() => navigate("/conversations/deleted"));
                }
              }}>Confirm Permanently Delete</button>
              <button className="memory-archive-back" type="button" onClick={() => setConfirmPermanentDelete(false)}>Cancel</button>
            </> : <button className="memory-archive-back" type="button" onClick={() => setConfirmPermanentDelete(true)}>Permanently Delete</button>}
            <button className="memory-archive-back" type="button" onClick={() => {
              if (branchId) {
                void client.restoreBranch({ conversationId, branchId }).then(() => navigate("/conversations/deleted"));
              } else {
                void client.restoreDeletedConversation(conversationId).then(() => navigate("/conversations/deleted"));
              }
            }}>Restore</button>
            </>
          ) : (
            <button
              className="memory-archive-back conversation-detail-delete"
              type="button"
              aria-label="把整个对话窗口移到 Deleted"
              title="移到 Deleted；原始 export 仍保留"
              onClick={() => void deleteWindow()}
            >
              Delete
            </button>
          )}
          <button
            className="memory-archive-back"
            type="button"
            onClick={() => navigate(scope === "archived" ? "/conversations/archive" : scope === "deleted" ? "/conversations/deleted" : "/conversations")}
          >
            Return
          </button>
        </div>
      </header>

      {detail.provider === "chatgpt" ? (
        <div className="conversation-detail-view-row">
          <div className="conversation-view-toggle">
            <button className={view === "default" ? "active" : ""} type="button" onClick={() => setSearchParams(detailViewParams("default", scope, branchId))}>当前路径</button>
            <button className={view === "all" ? "active" : ""} type="button" onClick={() => setSearchParams(detailViewParams("all", scope, branchId))}>全部分支</button>
          </div>
        </div>
      ) : null}

      {detail.provider === "claude" ? (
        <p className="conversation-branch-note">
          Claude 官方导出没有 current leaf。这里按时间显示全部普通可见消息，因此可能包含不同分支。
        </p>
      ) : view === "all" ? (
        <p className="conversation-branch-note">
          当前正在显示 ChatGPT 保存下来的全部普通消息节点，包括非 current path 分支。
        </p>
      ) : null}

      {pruneStatus ? <p className="conversation-inline-status" role="status">{pruneStatus}</p> : null}

      {state.contextual && anchorId ? (
        <div className="conversation-context-banner">
          <span>已定位到搜索结果，显示前后上下文。</span>
          <button type="button" onClick={() => setSearchParams(detailViewParams(view, scope, branchId))}>从头查看</button>
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
                <time className="conversation-message-time">{formatDateTime(message.sourceCreatedAt)}</time>
                {scope === "active" && (detail.provider === "claude" || view === "all") ? (
                  <button
                    className="conversation-message-prune"
                    type="button"
                    aria-label="从这条消息开始把整个分支移到 Deleted"
                    title="删除此分支；原始 export 仍保留"
                    disabled={pruningMessageId !== null}
                    onClick={() => void deleteBranch(message)}
                  >
                    {pruningMessageId === message.id ? "删除中…" : "删此分支"}
                  </button>
                ) : null}
                <button
                  className="conversation-message-favorite active"
                  type="button"
                  disabled={favoriteBusyId !== null}
                  aria-label={singleFavorite ? "取消收藏这条消息" : "收藏这条消息"}
                  onClick={() => void toggleSingleFavorite(message.id)}
                >
                  {favoriteBusy
                    ? "处理中…"
                    : favoriteError
                      ? "重试"
                      : singleFavorite
                        ? "取消收藏"
                        : "收藏"}
                </button>
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
