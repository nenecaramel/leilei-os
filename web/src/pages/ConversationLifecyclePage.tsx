import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { WebApiClient } from "../api/useWebApiClient";
import { PageState } from "../components/StateSurface";
import { createConversationArchiveApi, type ConversationDeletedBranch, type ConversationLegacyExclusion, type ConversationListItem } from "./conversation-archive-api";
import { groupConversationsByMonth } from "./conversation-presentation";
import "./conversations.css";

type Client = ReturnType<typeof createConversationArchiveApi>;
type ReadyState = {
  status: "ready";
  conversations: ConversationListItem[];
  total: number;
  branches: ConversationDeletedBranch[];
  exclusions: ConversationLegacyExclusion[];
  sources: Awaited<ReturnType<Client["importSources"]>>["items"];
};

function lifecycleTime(item: ConversationListItem, deleted: boolean): string | null {
  return deleted
    ? item.deletedAt ?? item.sourceCreatedAt ?? item.sourceUpdatedAt
    : item.archivedAt ?? item.sourceCreatedAt ?? item.sourceUpdatedAt;
}

function shortTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Unavailable";
}

function shortSnippet(value: string | null): string {
  if (!value) return "Unavailable";
  return value.length > 160 ? `${value.slice(0, 160)}…` : value;
}

export function ConversationLifecyclePageContent({ api }: { api: WebApiClient }) {
  const client = useMemo(() => createConversationArchiveApi(api), [api]);
  const location = useLocation();
  const navigate = useNavigate();
  const deleted = location.pathname.endsWith("/deleted");
  const [state, setState] = useState<{ status: "loading" } | ReadyState | { status: "error" }>({ status: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [restoreSourceByExclusion, setRestoreSourceByExclusion] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      if (deleted) {
        const [result, exclusions, sources] = await Promise.all([
          client.listDeleted({ limit: 100, offset: 0 }),
          client.listExclusions({ limit: 100, offset: 0 }),
          client.importSources({ limit: 100, offset: 0 }),
        ]);
        setState({
          status: "ready",
          conversations: result.conversations.items,
          total: result.conversations.total + result.branches.total,
          branches: result.branches.items,
          exclusions: exclusions.items,
          sources: sources.items,
        });
      } else {
        const result = await client.listArchive({ limit: 100, offset: 0 });
        setState({ status: "ready", conversations: result.items, total: result.total, branches: [], exclusions: [], sources: [] });
      }
    } catch {
      setState({ status: "error" });
    }
  }, [client, deleted]);

  useEffect(() => { void load(); }, [load]);

  const restore = async (id: string) => {
    setBusy(id);
    try {
      if (deleted) await client.restoreDeletedConversation(id);
      else await client.restoreConversation(id);
      await load();
    } finally { setBusy(null); }
  };

  const permanentlyDelete = async (id: string) => {
    if (!window.confirm("永久删除并阻止后续重新导入；原始 export 仍保留。确定继续吗？")) return;
    setBusy(id);
    try { await client.permanentlyDeleteConversation(id); await load(); } finally { setBusy(null); }
  };

  if (state.status === "loading") return <div className="page memory-page conversation-page conversation-lifecycle-page"><p className="conversation-detail-loading" role="status">正在读取…</p></div>;
  if (state.status === "error") return <div className="page memory-page conversation-page conversation-lifecycle-page"><PageState state="error" message="Conversation Archive 暂时无法读取。" onRetry={() => void load()} /></div>;

  const groups = groupConversationsByMonth(state.conversations, (item) => lifecycleTime(item, deleted));
  return (
    <div className="page memory-page conversation-page conversation-lifecycle-page">
      <header className="memory-page-header memory-archive-header">
        <div className="memory-page-heading"><div className="memory-page-title">{deleted ? "Deleted" : "Archive"}</div><div className="memory-page-count">{state.total.toLocaleString()}个窗口</div></div>
        <button className="memory-archive-back" type="button" onClick={() => navigate("/conversations")}>Return</button>
      </header>
      {groups.length === 0 && state.branches.length === 0 && state.exclusions.length === 0 ? <PageState state="empty" message={deleted ? "没有已删除的对话。" : "没有已归档的对话。"} /> : null}
      <section className="memory-months" aria-label={deleted ? "Deleted conversations" : "Archived conversations"}>
        {groups.map((group) => <section className="memory-month-section" key={group.key}><h2 className="memory-month-label">{group.label}</h2><div className="memory-month-card conversation-list">{group.items.map((item) => <div className="memory-row conversation-card" key={item.id}><Link to={`/conversations/${item.id}?scope=${deleted ? "deleted" : "archived"}`} className="conversation-lifecycle-link"><span className="memory-row-title">{item.title?.trim() || "Untitled conversation"}</span><span className="memory-row-meta"><span>{item.provider}</span><span>{shortTime(lifecycleTime(item, deleted))}</span></span></Link><span className="conversation-lifecycle-actions"><button type="button" disabled={busy === item.id} onClick={() => void restore(item.id)}>{busy === item.id ? "处理中…" : "Restore"}</button>{deleted ? <button type="button" disabled={busy === item.id} onClick={() => void permanentlyDelete(item.id)}>Permanently delete</button> : null}</span></div>)}</div></section>)}
      </section>
      {deleted && state.branches.length > 0 ? <section className="conversation-deleted-branches" aria-label="Deleted branches"><h2 className="memory-month-label">Deleted branches</h2>{state.branches.map((branch) => <div className="memory-row conversation-card" key={branch.id}><Link to={`/conversations/${branch.conversationId}?scope=deleted&branch=${branch.id}`} className="conversation-lifecycle-link"><span className="memory-row-title">{branch.title?.trim() || "Untitled conversation"}</span><span className="memory-row-meta"><span>Branch · {branch.provider}</span><span>{shortTime(branch.deletedAt)}</span><span>{branch.rootRole ? `${branch.rootRole} · ${shortTime(branch.rootSourceCreatedAt)}` : "Unavailable"}</span><span>{shortSnippet(branch.rootSnippet)}</span></span></Link><span className="conversation-lifecycle-actions"><button type="button" disabled={busy === branch.id} onClick={() => { setBusy(branch.id); void client.restoreBranch({ conversationId: branch.conversationId, branchId: branch.id }).then(load).finally(() => setBusy(null)); }}>Restore</button><button type="button" disabled={busy === branch.id} onClick={() => { if (!window.confirm("永久删除并阻止后续重新导入；原始 export 仍保留。确定继续吗？")) return; setBusy(branch.id); void client.permanentlyDeleteBranch({ conversationId: branch.conversationId, branchId: branch.id }).then(load).finally(() => setBusy(null)); }}>Permanently delete</button></span></div>)}</section> : null}
      {deleted && state.exclusions.length > 0 ? <section className="conversation-deleted-branches" aria-label="Legacy deleted items"><h2 className="memory-month-label">Legacy deleted items</h2>{state.exclusions.map((exclusion) => { const sources = state.sources.filter((source) => source.provider === exclusion.provider); const sourceId = restoreSourceByExclusion[exclusion.id] ?? ""; return <div className="memory-row conversation-card" key={exclusion.id}><div className="conversation-lifecycle-link"><span className="memory-row-title">{exclusion.title?.trim() || "Unavailable"}</span><span className="memory-row-meta"><span>{exclusion.scope === "branch" ? "Branch" : "Conversation"} · {exclusion.provider}</span><span>{shortTime(exclusion.createdAt)}</span><span>{exclusion.rootRole ? `${exclusion.rootRole} · ${shortTime(exclusion.sourceCreatedAt)}` : "Unavailable"}</span><span>{shortSnippet(exclusion.rootSnippet)}</span></span></div><span className="conversation-lifecycle-actions"><select aria-label="选择用于恢复的原始 export" value={sourceId} onChange={(event) => setRestoreSourceByExclusion((values) => ({ ...values, [exclusion.id]: event.target.value }))}><option value="">选择原始 export</option>{sources.map((source) => <option key={source.sourceId} value={source.sourceId}>{source.filename}</option>)}</select><button type="button" disabled={!sourceId || busy === exclusion.id} onClick={() => { setBusy(exclusion.id); void client.restoreExclusion({ exclusionId: exclusion.id, sourceId }).then(load).finally(() => setBusy(null)); }}>Restore</button></span></div>; })}</section> : null}
    </div>
  );
}
