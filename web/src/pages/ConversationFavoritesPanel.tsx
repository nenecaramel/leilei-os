import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type {
  ConversationFavoriteDetail,
  ConversationFavoriteListItem,
} from "./conversation-archive-api";
import { createConversationArchiveApi } from "./conversation-archive-api";
import { groupConversationsByMonth } from "./conversation-presentation";

type Client = ReturnType<typeof createConversationArchiveApi>;

type FavoriteRow = {
  item: ConversationFavoriteListItem;
  detail: ConversationFavoriteDetail | null;
};

type FavoriteListState =
  | { status: "loading" }
  | { status: "ready"; rows: FavoriteRow[]; total: number }
  | { status: "error" };

function formatDateTime(value: string | null): string {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function canonicalFavoriteLink(detail: ConversationFavoriteDetail): string | null {
  if (!detail.canonicalConversationExists) return null;
  const message = detail.messages.find((item) => item.canonicalMessageExists);
  if (!message) return null;
  const params = new URLSearchParams({ anchor: message.messageId });
  if (detail.view === "all") params.set("view", "all");
  return `/conversations/${detail.conversationId}?${params}`;
}

function favoriteExcerpt(detail: ConversationFavoriteDetail | null): string {
  if (!detail?.messages.length) return "原文暂时无法读取。";
  return detail.messages
    .map((message) => message.displayText || "（无可见文本）")
    .join("\n\n");
}

function FavoritesMonthLoading() {
  return (
    <section className="memory-months" aria-label="Favorites 加载中" aria-busy="true">
      <span className="visually-hidden" role="status" aria-live="polite">正在读取收藏…</span>
      {[0, 1].map((index) => (
        <div className="memory-month-skeleton" aria-hidden="true" key={index}>
          <span className="memory-month-skeleton-label" />
          <div className="memory-month-skeleton-card"><span /><span /></div>
        </div>
      ))}
    </section>
  );
}

export function ConversationFavoritesPanel({ client }: { client: Client }) {
  const [state, setState] = useState<FavoriteListState>({ status: "loading" });
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const result = await client.listFavorites({ limit: 50, offset: 0 });
      const details = await Promise.allSettled(
        result.items.map((item) => client.favoriteDetail(item.id)),
      );
      setState({
        status: "ready",
        total: result.total,
        rows: result.items.map((item, index) => ({
          item,
          detail: details[index]?.status === "fulfilled"
            ? (details[index] as PromiseFulfilledResult<ConversationFavoriteDetail>).value
            : null,
        })),
      });
    } catch {
      setState({ status: "error" });
    }
  }, [client]);

  useEffect(() => { void load(); }, [load]);

  const favoriteGroups = state.status === "ready"
    ? groupConversationsByMonth(state.rows, ({ item, detail }) => detail?.messages[0]?.sourceCreatedAt ?? item.createdAt)
    : [];

  const remove = async (favoriteId: string) => {
    if (removingId) return;
    setRemovingId(favoriteId);
    setStatus("");
    try {
      await client.deleteFavorite(favoriteId);
      setState((current) => current.status === "ready"
        ? {
            ...current,
            total: Math.max(0, current.total - 1),
            rows: current.rows.filter((row) => row.item.id !== favoriteId),
          }
        : current);
    } catch {
      setStatus("取消收藏失败，请重试。");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <section className="conversation-section conversation-favorites">
      {status ? <p className="conversation-inline-status" role="status">{status}</p> : null}

      {state.status === "loading" ? (
        <FavoritesMonthLoading />
      ) : state.status === "error" ? (
        <div className="conversation-muted-card">
          收藏暂时不可用。
          <button className="conversation-history-inline-action" type="button" onClick={() => void load()}>
            重试
          </button>
        </div>
      ) : state.rows.length === 0 ? (
        <div className="conversation-muted-card">还没有收藏。打开任意 Conversation，点消息旁边的“收藏”即可。</div>
      ) : (
        <section className="memory-months" aria-label="Favorites 列表">
          {favoriteGroups.map((group, index) => (
            <section className="memory-month-section" key={group.key}>
              <div
                className="conversation-favorites-month-heading"
                style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}
              >
                <h2 className="memory-month-label">{group.label}</h2>
                {index === 0 ? (
                  <span className="memory-month-label conversation-favorites-total" style={{ textAlign: "right" }}>
                    共 {state.total.toLocaleString()} 条
                  </span>
                ) : null}
              </div>
              <div className="memory-month-card conversation-favorite-list">
                {group.items.map(({ item, detail }) => {
                  const link = detail ? canonicalFavoriteLink(detail) : null;
                  const firstMessage = detail?.messages[0] ?? null;
                  return (
                    <article className="memory-row conversation-favorite-row" key={item.id} style={{ position: "relative" }}>
                      <span className="memory-row-title" style={{ paddingRight: 72 }}>{favoriteExcerpt(detail)}</span>
                      <span className="memory-row-meta">
                        <span><time>{formatDateTime(firstMessage?.sourceCreatedAt ?? null)}</time></span>
                        <span className="conversation-favorite-window">
                          窗口：{item.conversationTitleSnapshot?.trim() || "Untitled conversation"} · {link
                            ? <Link to={link}>定位原文</Link>
                            : <span>原窗口已删除</span>}
                        </span>
                      </span>
                      <button
                        className="conversation-message-favorite active conversation-favorite-remove"
                        style={{ position: "absolute", top: 11, right: 13 }}
                        type="button"
                        disabled={removingId !== null}
                        onClick={() => void remove(item.id)}
                      >
                        {removingId === item.id ? "处理中…" : "取消收藏"}
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </section>
      )}
    </section>
  );
}
