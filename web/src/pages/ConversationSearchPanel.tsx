import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import type {
  ConversationListItem,
  ConversationProvider,
  ConversationSearchResult,
  createConversationArchiveApi,
} from "./conversation-archive-api";

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; items: ConversationSearchResult[]; total: number }
  | { status: "error" };

function providerLabel(provider: ConversationProvider): string {
  return provider === "chatgpt" ? "ChatGPT" : "Claude";
}

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
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
}: {
  client: ReturnType<typeof createConversationArchiveApi>;
  conversations: ConversationListItem[];
}) {
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState<ConversationProvider | "">("");
  const [role, setRole] = useState<"user" | "assistant" | "">("");
  const [conversationId, setConversationId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading" });
    try {
      const result = await client.search({
        query: trimmed,
        provider: provider || undefined,
        role: role || undefined,
        conversationId: conversationId || undefined,
        from: from || undefined,
        to: to || undefined,
        timeZone: from || to ? browserTimeZone() : undefined,
        limit: 100,
        offset: 0,
      });
      setState({ status: "ready", ...result });
    } catch {
      setState({ status: "error" });
    }
  };

  return (
    <section className="conversation-section conversation-search-section">
      <div className="conversation-section-heading">
        <div>
          <p className="eyebrow">Message Search</p>
          <h2>搜原始对话</h2>
        </div>
        <span>直接定位到具体消息</span>
      </div>

      <form className="conversation-search-form" onSubmit={(event) => void submit(event)}>
        <div className="conversation-search-query">
          <input
            type="search"
            value={query}
            maxLength={500}
            placeholder="搜索你或 AI 说过的话"
            aria-label="Conversation message search"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className="primary-button" type="submit" disabled={state.status === "loading" || !query.trim()}>
            {state.status === "loading" ? "搜索中…" : "搜索"}
          </button>
        </div>

        <div className="conversation-search-filters">
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
                {providerLabel(conversation.provider)} · {conversation.title?.trim() || "Untitled"}
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
      </form>

      {state.status === "error" ? (
        <div className="conversation-muted-card">搜索暂时不可用。</div>
      ) : state.status === "ready" && state.items.length === 0 ? (
        <div className="conversation-muted-card">没有找到匹配的消息。</div>
      ) : state.status === "ready" ? (
        <>
          <div className="conversation-search-results">
            {state.items.map((result) => (
              <Link className="conversation-search-result" to={resultLocation(result)} key={result.messageId}>
                <div className="conversation-search-result-meta">
                  <span className={"conversation-provider conversation-provider--" + result.provider}>
                    {providerLabel(result.provider)}
                  </span>
                  <strong>{result.role === "user" ? "You" : providerLabel(result.provider)}</strong>
                  <span>{result.conversationTitle?.trim() || "Untitled conversation"}</span>
                  <time>{formatDateTime(result.sourceCreatedAt)}</time>
                </div>
                <p>{result.snippet}</p>
                {result.provider === "chatgpt" && !result.isCurrentPath ? (
                  <small>保存分支中的消息</small>
                ) : null}
              </Link>
            ))}
          </div>
          <p className="conversation-list-total">
            共 {state.total.toLocaleString()} 条命中
            {state.total > state.items.length ? " · 当前显示前 " + state.items.length + " 条" : ""}
          </p>
        </>
      ) : null}
    </section>
  );
}
