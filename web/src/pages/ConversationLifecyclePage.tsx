import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { WebApiClient } from "../api/useWebApiClient";
import { PageState } from "../components/StateSurface";
import { createConversationArchiveApi, type ConversationDeletedBranch, type ConversationLegacyExclusion, type ConversationListItem, type ConversationRestoreCandidate } from "./conversation-archive-api";
import { groupConversationsByMonth } from "./conversation-presentation";
import "./conversations.css";

type Client = ReturnType<typeof createConversationArchiveApi>;
type ReadyState = { status: "ready"; conversations: ConversationListItem[]; total: number; branches: ConversationDeletedBranch[]; exclusions: ConversationLegacyExclusion[]; candidatesByExclusion: Record<string, ConversationRestoreCandidate[]> };
type LifecycleItem = { kind: "conversation"; item: ConversationListItem; time: string | null } | { kind: "branch"; item: ConversationDeletedBranch; time: string | null } | { kind: "legacy"; item: ConversationLegacyExclusion; time: string | null };
const permanentDeleteCopy = "永久从 Conversation Archive 删除并阻止后续重新导入；原始 export 仍保留。";

function shortTime(value: string | null): string { return value ? new Date(value).toLocaleString() : "Unavailable"; }
function shortSnippet(value: string | null): string { return !value ? "Unavailable" : value.length > 160 ? `${value.slice(0, 160)}…` : value; }

export function ConversationLifecyclePageContent({ api }: { api: WebApiClient }) {
  const client = useMemo(() => createConversationArchiveApi(api), [api]);
  const location = useLocation();
  const navigate = useNavigate();
  const deleted = location.pathname.endsWith("/deleted");
  const [state, setState] = useState<{ status: "loading" } | ReadyState | { status: "error" }>({ status: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [restoreSourceByExclusion, setRestoreSourceByExclusion] = useState<Record<string, string>>({});
  const [permanentDeleteId, setPermanentDeleteId] = useState<string | null>(null);
  const [candidateStatusByExclusion, setCandidateStatusByExclusion] = useState<Record<string, "idle" | "loading" | "ready" | "error">>({});

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      if (!deleted) {
        const result = await client.listArchive({ limit: 100, offset: 0 });
        setState({ status: "ready", conversations: result.items, total: result.total, branches: [], exclusions: [], candidatesByExclusion: {} });
        return;
      }
      const [result, exclusions] = await Promise.all([client.listDeleted({ limit: 100, offset: 0 }), client.listExclusions({ limit: 100, offset: 0 })]);
      setCandidateStatusByExclusion({});
      setRestoreSourceByExclusion({});
      setState({ status: "ready", conversations: result.conversations.items, total: result.conversations.total + result.branches.total + exclusions.total, branches: result.branches.items, exclusions: exclusions.items, candidatesByExclusion: {} });
    } catch { setState({ status: "error" }); }
  }, [client, deleted]);
  useEffect(() => { void load(); }, [load]);

  async function restoreConversation(id: string) { setBusy(id); try { if (deleted) await client.restoreDeletedConversation(id); else await client.restoreConversation(id); await load(); } finally { setBusy(null); } }
  async function permanentlyDeleteConversation(id: string) { setBusy(id); try { await client.permanentlyDeleteConversation(id); await load(); } finally { setBusy(null); setPermanentDeleteId(null); } }
  async function restoreBranch(branch: ConversationDeletedBranch) { setBusy(branch.id); try { await client.restoreBranch({ conversationId: branch.conversationId, branchId: branch.id }); await load(); } finally { setBusy(null); } }
  async function permanentlyDeleteBranch(branch: ConversationDeletedBranch) { setBusy(branch.id); try { await client.permanentlyDeleteBranch({ conversationId: branch.conversationId, branchId: branch.id }); await load(); } finally { setBusy(null); setPermanentDeleteId(null); } }

  async function restoreLegacyExclusion(exclusionId: string) {
    setBusy(exclusionId);
    try {
      let candidates = state.status === "ready" ? state.candidatesByExclusion[exclusionId] : undefined;
      if (!candidates) {
        setCandidateStatusByExclusion((current) => ({ ...current, [exclusionId]: "loading" }));
        try {
          const result = await client.restoreCandidates(exclusionId);
          candidates = result.items;
          setState((current) => current.status === "ready"
            ? { ...current, candidatesByExclusion: { ...current.candidatesByExclusion, [exclusionId]: result.items } }
            : current);
          setCandidateStatusByExclusion((current) => ({ ...current, [exclusionId]: "ready" }));
          if (result.items.length === 1 && result.items[0]) {
            setRestoreSourceByExclusion((current) => ({ ...current, [exclusionId]: result.items[0]!.sourceId }));
          }
        } catch {
          setCandidateStatusByExclusion((current) => ({ ...current, [exclusionId]: "error" }));
          return;
        }
      }

      if (candidates.length === 0) return;
      const selectedSourceId = restoreSourceByExclusion[exclusionId] ?? (candidates.length === 1 ? candidates[0]?.sourceId ?? "" : "");
      if (!selectedSourceId) return;
      await client.restoreExclusion({ exclusionId, sourceId: selectedSourceId });
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (state.status === "loading") return <div className="page memory-page conversation-page conversation-lifecycle-page conversation-state-page"><PageState state="loading" message="Reading..." /></div>;
  if (state.status === "error") return <div className="page memory-page conversation-page conversation-lifecycle-page conversation-state-page"><PageState state="error" message={deleted ? "Unable to read deleted conversations." : "Unable to read conversation archive."} retryLabel="Retry" onRetry={() => void load()} /></div>;

  const items: LifecycleItem[] = deleted ? [
    ...state.conversations.map((item) => ({ kind: "conversation" as const, item, time: item.deletedAt ?? null })),
    ...state.branches.map((item) => ({ kind: "branch" as const, item, time: item.deletedAt ?? null })),
    ...state.exclusions.map((item) => ({ kind: "legacy" as const, item, time: item.createdAt ?? null })),
  ] : state.conversations.map((item) => ({ kind: "conversation" as const, item, time: item.archivedAt ?? null }));
  const groups = groupConversationsByMonth(items, (item) => item.time);

  return <div className="page memory-page conversation-page conversation-lifecycle-page conversation-state-page">
    <header className="memory-page-header memory-archive-header"><div className="memory-page-heading"><div className="memory-page-title">{deleted ? "Deleted" : "Archive"}</div><div className="memory-page-count">{state.total.toLocaleString()}项</div></div><button className="memory-archive-back" type="button" onClick={() => navigate("/conversations")}>Return</button></header>
    {groups.length === 0 ? <PageState state="empty" message={deleted ? "没有已删除的对话。" : "没有已归档的对话。"} /> : null}
    <section className="memory-months" aria-label={deleted ? "Deleted conversations" : "Archived conversations"}>{groups.map((group) => <section className="memory-month-section" key={group.key}><h2 className="memory-month-label">{group.label}</h2><div className="memory-month-card conversation-list">{group.items.map((entry) => {
      if (entry.kind === "conversation") {
        const item = entry.item; const pending = permanentDeleteId === `conversation:${item.id}`;
        return <div className="memory-row conversation-card" key={`conversation:${item.id}`}><Link to={`/conversations/${item.id}?scope=${deleted ? "deleted" : "archived"}`} className="conversation-lifecycle-link"><span className="memory-row-title">{item.title?.trim() || "Untitled conversation"}</span><span className="memory-row-meta"><span>{item.provider}</span><span>{shortTime((deleted ? item.deletedAt : item.archivedAt) ?? null)}</span></span></Link><span className="conversation-lifecycle-actions"><button type="button" disabled={busy === item.id} onClick={() => void restoreConversation(item.id)}>{busy === item.id ? "处理中…" : "Restore"}</button>{deleted && (pending ? <><span>{permanentDeleteCopy}</span><button type="button" disabled={busy === item.id} onClick={() => void permanentlyDeleteConversation(item.id)}>Confirm permanently delete</button><button type="button" onClick={() => setPermanentDeleteId(null)}>Cancel</button></> : <button type="button" disabled={busy === item.id} onClick={() => setPermanentDeleteId(`conversation:${item.id}`)}>Permanently delete</button>)}</span></div>;
      }
      if (entry.kind === "branch") {
        const branch = entry.item; const pending = permanentDeleteId === `branch:${branch.id}`;
        return <div className="memory-row conversation-card" key={`branch:${branch.id}`}><Link to={`/conversations/${branch.conversationId}?scope=deleted&branch=${branch.id}`} className="conversation-lifecycle-link"><span className="memory-row-title">{branch.title?.trim() || "Untitled conversation"}</span><span className="memory-row-meta"><span>Branch · {branch.provider}</span><span>{shortTime(branch.deletedAt)}</span><span>{branch.rootRole ? `${branch.rootRole} · ${shortTime(branch.rootSourceCreatedAt)}` : "Unavailable"}</span><span>{shortSnippet(branch.rootSnippet)}</span></span></Link><span className="conversation-lifecycle-actions"><button type="button" disabled={busy === branch.id} onClick={() => void restoreBranch(branch)}>Restore</button>{pending ? <><span>{permanentDeleteCopy}</span><button type="button" disabled={busy === branch.id} onClick={() => void permanentlyDeleteBranch(branch)}>Confirm permanently delete</button><button type="button" onClick={() => setPermanentDeleteId(null)}>Cancel</button></> : <button type="button" disabled={busy === branch.id} onClick={() => setPermanentDeleteId(`branch:${branch.id}`)}>Permanently delete</button>}</span></div>;
      }
      const exclusion = entry.item; const candidates = state.candidatesByExclusion[exclusion.id]; const candidateStatus = candidateStatusByExclusion[exclusion.id] ?? "idle"; const sourceId = restoreSourceByExclusion[exclusion.id] ?? (candidates?.length === 1 ? candidates[0]?.sourceId ?? "" : ""); const candidate = candidates?.find((value) => value.sourceId === sourceId) ?? candidates?.[0] ?? null;
      return <div className="memory-row conversation-card" key={`legacy:${exclusion.id}`}><div className="conversation-lifecycle-link"><span className="memory-row-title">{exclusion.title?.trim() || candidate?.title?.trim() || "Unavailable"}</span><span className="memory-row-meta"><span>{exclusion.scope === "branch" ? "Branch" : "Conversation"} · {exclusion.provider}</span><span>{shortTime(exclusion.createdAt)}</span><span>{(exclusion.rootRole ?? candidate?.rootRole) ? `${exclusion.rootRole ?? candidate?.rootRole} · ${shortTime(exclusion.sourceCreatedAt ?? candidate?.rootSourceCreatedAt ?? null)}` : "Unavailable"}</span><span>{shortSnippet(exclusion.rootSnippet ?? candidate?.rootSnippet ?? null)}</span></span></div><span className="conversation-lifecycle-actions">{candidateStatus === "ready" && (candidates?.length ?? 0) > 1 ? <select aria-label="选择用于恢复的已验证原始 export" value={sourceId} onChange={(event) => setRestoreSourceByExclusion((values) => ({ ...values, [exclusion.id]: event.target.value }))}><option value="">选择已验证原始 export</option>{candidates?.map((source) => <option key={source.sourceId} value={source.sourceId}>{source.filename}</option>)}</select> : null}{candidateStatus === "ready" && candidates?.length === 0 ? <span>Unavailable</span> : <button type="button" disabled={busy === exclusion.id || (candidateStatus === "ready" && (candidates?.length ?? 0) > 1 && !sourceId)} onClick={() => void restoreLegacyExclusion(exclusion.id)}>{candidateStatus === "loading" ? "Locating…" : candidateStatus === "error" ? "Retry" : "Restore"}</button>}</span></div>;
    })}</div></section>)}</section>
  </div>;
}
