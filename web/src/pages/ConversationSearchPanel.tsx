import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { StateSurface } from "../components/StateSurface";
import type {
  ConversationListItem,
  ConversationProvider,
  ConversationSearchResult,
  createConversationArchiveApi,
} from "./conversation-archive-api";
import {
  conversationProviderLabel,
  formatConversationDateTime,
} from "./conversation-presentation";

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; items: ConversationSearchResult[]; total: number }
  | { status: "error" };

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function resultLocation(result: ConversationSearchResult): string {
  const params = new URLSearchParams({ anchor: result.messageId });
  if (result.provider === "chatgpt" && !result.isCurrentPath) {
    params.set("view", "all");
  }
  return "/conversations/" + result.conversationId + "?" + params.toString()
    + "#message-" + result.messageId;
}

export function ConversationSearchPanel({
  client,
  conversations,
  query,
}: {
  client: ReturnType<typeof createConversationArchiveApi>;
  conversations: ConversationListItem[];
  query: string;
}) {
  const [provider, setProvider] = useState<ConversationProvider | "">("");
  const [role, setRole] = useState<"user" | "assistant" | "">("");
  const [conversationId, setConversationId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const [retryNonce, setRetryNonce] = useState(0);

  const searchTicket = useRef(0);
  const activeFilterCount = [provider, role, conversationId, from, to].filter(Boolean).length;

  const clearFilters = () => {
    setProvider("");
    setRole("");
    setConversationId("");
    setFrom("");
    setTo("");
  };

  useEffect(() => {
    const trimmed = query.trim();
    const ticket = ++searchTicket.current;

    if (!trimmed) {
      setState({ status: "idle" });
      return;
    }

    const timeout = window.setTimeout(() => {
      setState({ status: "loading" });
      void client.search({
        query: trimmed,
        provider: provider || undefined,
        role: role || undefined,
        conversationId: conversationId || undefined,
        from: from || undefined,
        to: to || undefined,
        timeZone: from || to ? browserTimeZone() : undefined,
        limit: 100,
        offset: 0,
      }).then((result) => {
        if (searchTicket.current !== ticket) return;
        setState({ status: "ready", ...result });
      }).catch(() => {
        if (searchTicket.current !== ticket) return;
        setState({ status: "error" });
      });
    }, 300);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    client,
    conversationId,
    from,
    provider,
    query,
    role,
    to,
    retryNonce,
  ]);

  return (
    <section className="conversation-search-section" aria-label="Conversation message search">
      {state.status === "ready" || activeFilterCount ? (
        <div className="conversation-search-toolbar">
          <button
            className={`conversation-search-filter-toggle${filtersOpen || activeFilterCount ? " active" : ""}`}
            type="button"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((value) => !value)}
          >
            {state.status === "ready"
              ? `共 ${state.total.toLocaleString()} 条命中`
              : `${activeFilterCount} 个条件`}
          </button>
          {activeFilterCount ? (
            <button className="conversation-search-clear" type="button" onClick={clearFilters}>清除</button>
          ) : null}
        </div>
      ) : null}

      {filtersOpen ? (
        <div className="conversation-search-filters" aria-label="搜索筛选">
          <select value={provider} aria-label="Provider" onChange={(event) => setProvider(event.target.value as ConversationProvider | "")}>
            <option value="">全部平台</option>
            <option value="chatgpt">ChatGPT</option>
            <option value="claude">Claude</option>
          </select>
          <select value={role} aria-label="Role" onChange={(event) => setRole(event.target.value as "user" | "assistant" | "")}>
            <option value="">我 + AI</option>
            <option value="user">只搜我说的</option>
            <option value="assistant">只搜 AI 说的</option>
          </select>
          <select value={conversationId} aria-label="Conversation" onChange={(event) => setConversationId(event.target.value)}>
            <option value="">全部窗口</option>
            {conversations.map((conversation) => (
              <option value={conversation.id} key={conversation.id}>
                {conversationProviderLabel(conversation.provider)} · {conversation.title?.trim() || "Untitled"}
              </option>
            ))}
          </select>
          <label>
            <span>从</span>
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label>
            <span>到</span>
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
        </div>
      ) : null}

      {state.status === "loading" ? (
        <div className="conversation-search-state" role="status">Searching...</div>
      ) : state.status === "error" ? (
        <StateSurface
          state="error"
          message="Unable to read conversations."
          retryLabel="Retry"
          onRetry={() => setRetryNonce((value) => value + 1)}
          placement="inline"
          className="conversation-search-state"
        />
      ) : state.status === "ready" && state.items.length === 0 ? (
        <div className="conversation-search-state">没有找到匹配的消息。</div>
      ) : state.status === "ready" ? (
        <div className="conversation-search-results">
          {state.items.map((result) => (
            <Link className="conversation-search-result" to={resultLocation(result)} key={result.messageId}>
              <div className="conversation-search-result-meta">
                <span>{conversationProviderLabel(result.provider)}</span>
                <strong>{result.role === "user" ? "You" : conversationProviderLabel(result.provider)}</strong>
                <span>{result.conversationTitle?.trim() || "Untitled conversation"}</span>
                <time>{formatConversationDateTime(result.sourceCreatedAt)}</time>
              </div>
              <p>{result.snippet}</p>
              {result.provider === "chatgpt" && !result.isCurrentPath ? (
                <small>保存分支中的消息</small>
              ) : null}
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
