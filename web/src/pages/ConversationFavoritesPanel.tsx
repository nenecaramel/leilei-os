import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type {
  ConversationFavoriteDetail,
  ConversationFavoriteListItem,
} from "./conversation-archive-api";
import { createConversationArchiveApi } from "./conversation-archive-api";

type Client = ReturnType<typeof createConversationArchiveApi>;

type FavoriteListState =
  | { status: "loading" }
  | { status: "ready"; items: ConversationFavoriteListItem[]; total: number }
  | { status: "error" };

type EditState = {
  favoriteId: string;
  title: string;
  note: string;
  tags: string;
};

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function tagsFromText(value: string): string[] {
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

function canonicalFavoriteLink(detail: ConversationFavoriteDetail): string | null {
  if (!detail.canonicalConversationExists) return null;
  const message = detail.messages.find((item) => item.canonicalMessageExists);
  if (!message) return null;
  const params = new URLSearchParams({ anchor: message.messageId });
  if (detail.view === "all") params.set("view", "all");
  return `/conversations/${detail.conversationId}?${params}`;
}

export function ConversationFavoritesPanel({ client }: { client: Client }) {
  const [state, setState] = useState<FavoriteListState>({ status: "loading" });
  const [detail, setDetail] = useState<ConversationFavoriteDetail | null>(null);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const result = await client.listFavorites({ limit: 50, offset: 0 });
      setState({ status: "ready", ...result });
    } catch {
      setState({ status: "error" });
    }
  }, [client]);

  useEffect(() => { void load(); }, [load]);

  const openDetail = async (favoriteId: string) => {
    if (detail?.id === favoriteId) {
      setDetail(null);
      setEdit(null);
      return;
    }
    setLoadingDetailId(favoriteId);
    setDetail(null);
    setEdit(null);
    setStatus("");
    try {
      setDetail(await client.favoriteDetail(favoriteId));
    } catch {
      setStatus("这条 Favorite 暂时无法读取。");
    } finally {
      setLoadingDetailId(null);
    }
  };

  const startEdit = (item: ConversationFavoriteListItem) => {
    setEdit({
      favoriteId: item.id,
      title: item.title ?? "",
      note: item.note ?? "",
      tags: item.tags.join(", "),
    });
  };

  const saveEdit = async () => {
    if (!edit || saving) return;
    setSaving(true);
    setStatus("");
    try {
      const updated = await client.updateFavorite({
        favoriteId: edit.favoriteId,
        title: edit.title,
        note: edit.note,
        tags: tagsFromText(edit.tags),
      });
      setDetail((current) => current?.id === updated.id ? updated : current);
      setEdit(null);
      setStatus("Favorite 已更新。");
      await load();
    } catch {
      setStatus("Favorite 更新失败；标题最多 200 字，备注最多 4000 字，最多 20 个标签。");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (favoriteId: string) => {
    if (!window.confirm("删除这条 Favorite snapshot？这不会删除原 Conversation。")) return;
    setStatus("");
    try {
      await client.deleteFavorite(favoriteId);
      if (detail?.id === favoriteId) setDetail(null);
      if (edit?.favoriteId === favoriteId) setEdit(null);
      setStatus("Favorite 已删除。");
      await load();
    } catch {
      setStatus("Favorite 删除失败。");
    }
  };

  return (
    <section className="conversation-section conversation-favorites">
      <div className="conversation-section-heading">
        <div>
          <p className="eyebrow">Favorites</p>
          <h2>收藏片段</h2>
        </div>
        {state.status === "ready" ? <span>共 {state.total.toLocaleString()} 条</span> : null}
      </div>

      {status ? <p className="conversation-inline-status" role="status">{status}</p> : null}

      {state.status === "loading" ? (
        <div className="conversation-muted-card">正在读取 Favorites…</div>
      ) : state.status === "error" ? (
        <div className="conversation-muted-card">
          Favorites 暂时不可用。
          <button className="conversation-history-inline-action" type="button" onClick={() => void load()}>
            重试
          </button>
        </div>
      ) : state.items.length === 0 ? (
        <div className="conversation-muted-card">
          还没有 Favorite。打开任意 Conversation，可以收藏单条消息或连续范围。
        </div>
      ) : (
        <div className="conversation-favorite-list">
          {state.items.map((item) => {
            const expanded = detail?.id === item.id;
            const editing = edit?.favoriteId === item.id;
            return (
              <article className="conversation-favorite-card" key={item.id}>
                <div className="conversation-favorite-main">
                  <div className="conversation-favorite-topline">
                    <span className={`conversation-provider conversation-provider--${item.provider}`}>
                      {item.provider === "chatgpt" ? "ChatGPT" : "Claude"}
                    </span>
                    <time>{formatDateTime(item.createdAt)}</time>
                  </div>
                  <h3>{item.title?.trim() || item.conversationTitleSnapshot?.trim() || "Favorite"}</h3>
                  <p>{item.messageCount} 条消息 · {item.view === "all" ? "全部分支视图" : "默认视图"}</p>
                  {item.note ? <p className="conversation-favorite-note">{item.note}</p> : null}
                  {item.tags.length ? (
                    <div className="conversation-favorite-tags">
                      {item.tags.map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                  ) : null}
                  {!item.canonicalConversationExists ? (
                    <small>原窗口已删除；Favorite snapshot 仍完整保留。</small>
                  ) : null}
                </div>
                <div className="conversation-favorite-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={loadingDetailId === item.id}
                    onClick={() => void openDetail(item.id)}
                  >
                    {loadingDetailId === item.id ? "读取中…" : expanded ? "收起" : "查看"}
                  </button>
                  <button className="secondary-button" type="button" onClick={() => startEdit(item)}>
                    编辑
                  </button>
                  <button className="conversation-danger-button" type="button" onClick={() => void remove(item.id)}>
                    删除
                  </button>
                </div>

                {editing && edit ? (
                  <div className="conversation-favorite-editor">
                    <label>
                      <span>标题</span>
                      <input
                        value={edit.title}
                        maxLength={200}
                        onChange={(event) => setEdit({ ...edit, title: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>备注</span>
                      <textarea
                        value={edit.note}
                        maxLength={4000}
                        rows={3}
                        onChange={(event) => setEdit({ ...edit, note: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>标签（逗号分隔）</span>
                      <input
                        value={edit.tags}
                        onChange={(event) => setEdit({ ...edit, tags: event.target.value })}
                      />
                    </label>
                    <div className="conversation-favorite-editor-actions">
                      <button className="secondary-button" type="button" onClick={() => setEdit(null)}>
                        取消
                      </button>
                      <button className="primary-button" type="button" disabled={saving} onClick={() => void saveEdit()}>
                        {saving ? "保存中…" : "保存"}
                      </button>
                    </div>
                  </div>
                ) : null}

                {expanded && detail ? (
                  <div className="conversation-favorite-detail">
                    <div className="conversation-favorite-detail-heading">
                      <span>Snapshot · {detail.messages.length} 条</span>
                      {canonicalFavoriteLink(detail) ? (
                        <Link to={canonicalFavoriteLink(detail)!}>定位到仍存在的原消息</Link>
                      ) : null}
                    </div>
                    <div className="conversation-favorite-message-list">
                      {detail.messages.map((message) => (
                        <div className={`conversation-favorite-message conversation-favorite-message--${message.role}`} key={`${message.ordinal}:${message.messageId}`}>
                          <div>
                            <strong>{message.role === "user" ? "You" : detail.provider === "chatgpt" ? "ChatGPT" : "Claude"}</strong>
                            {message.model ? <span>{message.model}</span> : null}
                            {!message.canonicalMessageExists ? <small>snapshot only</small> : null}
                          </div>
                          <p>{message.displayText || "（无可见文本）"}</p>
                        </div>
                      ))}
                    </div>
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
