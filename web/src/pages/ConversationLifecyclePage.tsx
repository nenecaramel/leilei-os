import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { WebApiClient } from "../api/useWebApiClient";
import { PageState } from "../components/StateSurface";
import {
  createConversationArchiveApi,
  type ConversationDeletedBranch,
  type ConversationListItem,
  type ConversationProvider,
} from "./conversation-archive-api";
import { groupConversationsByMonth } from "./conversation-presentation";
import { PaperDetailDialog } from "./PaperDetailDialog";
import "./conversations.css";

type Client = ReturnType<typeof createConversationArchiveApi>;

type ConversationArchiveItem = {
  kind: "conversation";
  source: "archived" | "deleted";
  item: ConversationListItem;
  removalTime: string | null;
};

type BranchArchiveItem = {
  kind: "branch";
  item: ConversationDeletedBranch;
  removalTime: string | null;
};

type ArchiveItem = ConversationArchiveItem | BranchArchiveItem;

type ReadyState = {
  status: "ready";
  items: ArchiveItem[];
  total: number;
};

function providerLabel(provider: ConversationProvider): string {
  return provider === "chatgpt" ? "ChatGPT" : "Claude";
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatRowDateTime(value: string | null): string {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatPaperDateTime(value: string | null): string {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function title(value: string | null): string {
  return value?.trim() || "Untitled conversation";
}

function branchText(value: string | null): string {
  return value?.trim() || "（无可见文本）";
}

function itemKey(entry: ArchiveItem): string {
  return entry.kind === "conversation"
    ? `conversation:${entry.source}:${entry.item.id}`
    : `branch:${entry.item.id}`;
}

export function ConversationLifecyclePageContent({ api }: { api: WebApiClient }) {
  const client = useMemo(() => createConversationArchiveApi(api), [api]);
  const navigate = useNavigate();
  const triggerRef = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<{ status: "loading" } | ReadyState | { status: "error" }>({
    status: "loading",
  });
  const [selected, setSelected] = useState<ArchiveItem | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const [archived, deleted] = await Promise.all([
        client.listArchive({ limit: 100, offset: 0 }),
        client.listDeleted({ limit: 100, offset: 0 }),
      ]);
      const items: ArchiveItem[] = [
        ...archived.items.map((item) => ({
          kind: "conversation" as const,
          source: "archived" as const,
          item,
          removalTime: item.archivedAt ?? null,
        })),
        ...deleted.conversations.items.map((item) => ({
          kind: "conversation" as const,
          source: "deleted" as const,
          item,
          removalTime: item.deletedAt ?? null,
        })),
        ...deleted.branches.items.map((item) => ({
          kind: "branch" as const,
          item,
          removalTime: item.deletedAt ?? null,
        })),
      ];
      setState({
        status: "ready",
        items,
        total: archived.total + deleted.conversations.total + deleted.branches.total,
      });
    } catch {
      setState({ status: "error" });
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const count = state.status === "ready" ? state.total : 0;
  const groups = state.status === "ready"
    ? groupConversationsByMonth(state.items, (entry) => entry.removalTime)
    : [];

  function openDetail(entry: ArchiveItem, trigger: HTMLElement) {
    triggerRef.current = trigger;
    setActionError("");
    setConfirmingDelete(false);
    setSelected(entry);
  }

  function closeDetail(): boolean {
    if (busyKey) return false;
    setSelected(null);
    setConfirmingDelete(false);
    setActionError("");
    return true;
  }

  async function restoreSelected() {
    if (!selected) return;
    const key = itemKey(selected);
    setBusyKey(key);
    setActionError("");
    try {
      if (selected.kind === "branch") {
        await client.restoreBranch({
          conversationId: selected.item.conversationId,
          branchId: selected.item.id,
        });
      } else if (selected.source === "deleted") {
        await client.restoreDeletedConversation(selected.item.id);
      } else {
        await client.restoreConversation(selected.item.id);
      }
      setSelected(null);
      setConfirmingDelete(false);
      await load();
    } catch {
      setActionError("恢复失败。");
    } finally {
      setBusyKey(null);
    }
  }

  async function permanentlyDeleteSelected() {
    if (!selected) return;
    const key = itemKey(selected);
    setBusyKey(key);
    setActionError("");
    try {
      if (selected.kind === "branch") {
        await client.permanentlyDeleteBranch({
          conversationId: selected.item.conversationId,
          branchId: selected.item.id,
        });
      } else if (selected.source === "archived") {
        await client.restoreConversation(selected.item.id);
        try {
          await client.deleteConversation(selected.item.id);
        } catch (error) {
          try {
            await client.archiveConversation(selected.item.id);
          } catch {
            // Keep the original error; a reload below will reflect the actual lifecycle state.
          }
          throw error;
        }
        await client.permanentlyDeleteConversation(selected.item.id);
      } else {
        await client.permanentlyDeleteConversation(selected.item.id);
      }
      setSelected(null);
      setConfirmingDelete(false);
      await load();
    } catch {
      setActionError("永久删除失败。");
      if (selected.kind === "conversation" && selected.source === "archived") {
        setSelected(null);
        setConfirmingDelete(false);
        await load();
      }
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="page memory-page conversation-page conversation-lifecycle-page">
      <header className="memory-page-header memory-archive-header">
        <div className="memory-page-heading">
          <div className="memory-page-title">Archive</div>
          <div className="memory-page-count">{count.toLocaleString()}项</div>
        </div>
        <button className="memory-archive-back" type="button" onClick={() => navigate("/conversations")}>
          Return
        </button>
      </header>

      {state.status === "loading" ? <PageState state="loading" message="Reading..." /> : null}
      {state.status === "error" ? (
        <PageState
          state="error"
          message="Unable to read conversation archive."
          retryLabel="Retry"
          onRetry={() => void load()}
        />
      ) : null}
      {state.status === "ready" && groups.length === 0 ? (
        <PageState state="empty" message="还没有归档 Conversation 或 Branch。" />
      ) : null}

      {state.status === "ready" && groups.length > 0 ? (
        <section className="memory-months" aria-label="Conversation Archive">
          {groups.map((group) => (
            <section className="memory-month-section" key={group.key}>
              <h2 className="memory-month-label">{group.label}</h2>
              <div className="memory-month-card conversation-list">
                {group.items.map((entry) => {
                  if (entry.kind === "conversation") {
                    return (
                      <button
                        type="button"
                        className="memory-row conversation-card"
                        key={itemKey(entry)}
                        onClick={(event) => openDetail(entry, event.currentTarget)}
                      >
                        <span className="memory-row-title">{title(entry.item.title)}</span>
                        <span className="memory-row-meta">
                          <span>{formatRowDateTime(entry.item.sourceCreatedAt)}</span>
                          <span>Conversation</span>
                        </span>
                      </button>
                    );
                  }

                  return (
                    <button
                      type="button"
                      className="memory-row conversation-card"
                      key={itemKey(entry)}
                      onClick={(event) => openDetail(entry, event.currentTarget)}
                    >
                      <span className="memory-row-title">{branchText(entry.item.rootSnippet)}</span>
                      <span className="memory-row-meta">
                        <span>{formatRowDateTime(entry.item.rootSourceCreatedAt)}</span>
                        <span>{title(entry.item.title)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </section>
      ) : null}

      {selected ? (
        <PaperDetailDialog
          id="conversation-archive-detail-paper"
          open
          label={selected.kind === "conversation"
            ? `Archived Conversation ${title(selected.item.title)}`
            : `Archived Branch ${title(selected.item.title)}`}
          dateLabel={`${formatPaperDateTime(selected.removalTime)} · ${providerLabel(selected.item.provider)}`}
          signature=""
          triggerRef={triggerRef}
          errorMessage={actionError || null}
          onRequestClose={closeDetail}
          topRight={
            confirmingDelete ? (
              <>
                <button
                  className="memory-paper-control"
                  disabled={Boolean(busyKey)}
                  onClick={() => setConfirmingDelete(false)}
                >
                  取消
                </button>
                <span>·</span>
                <button
                  className="memory-paper-control"
                  disabled={Boolean(busyKey)}
                  onClick={() => void permanentlyDeleteSelected()}
                >
                  {busyKey ? "删除中…" : "确认永久删除"}
                </button>
              </>
            ) : (
              <>
                <button
                  className="memory-paper-control"
                  disabled={Boolean(busyKey)}
                  onClick={() => void restoreSelected()}
                >
                  {busyKey ? "恢复中…" : "恢复"}
                </button>
                <span>·</span>
                <button
                  className="memory-paper-control"
                  disabled={Boolean(busyKey)}
                  onClick={() => setConfirmingDelete(true)}
                >
                  删除
                </button>
              </>
            )
          }
          bottomLeft={selected.kind === "conversation" ? "Conversation" : "Branch"}
        >
          <h2 className="memory-paper-title">{title(selected.item.title)}</h2>
          {selected.kind === "conversation" ? (
            <p className="memory-paper-content">{formatPaperDateTime(selected.item.sourceCreatedAt)}</p>
          ) : (
            <>
              <p className="memory-paper-content">{branchText(selected.item.rootSnippet)}</p>
              <p className="conversation-lifecycle-source-time">
                {formatPaperDateTime(selected.item.rootSourceCreatedAt)}
              </p>
            </>
          )}
        </PaperDetailDialog>
      ) : null}
    </div>
  );
}
