import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import { WebApiError } from "../api/web-api-error";
import { ModuleSearchButton, ModuleSearchField, ModuleStateMessage } from "../components/ModuleSearch";
import { ArchiveIcon, PenIcon } from "../components/icons";
import { PaperAuthorSignature, type PaperAuthorValue } from "./PaperAuthorSignature";
import { navigateWithinApp } from "./app-navigation";
import { PaperDetailDialog } from "./PaperDetailDialog";
import { SharedPaperBodyEditor } from "./SharedPaperBodyEditor";
import { createContiguousRangeEdit, diffText } from "./shared-paper-diff";
import { getSharedPaperDetailLocation } from "./shared-paper-location";
import { createSharedPaperApi, type SharedPaper, type SharedPaperAuthor, type SharedPaperEdit, type SharedPaperScope } from "./shared-paper-api";
import { confirmUnsavedChanges } from "./submission-gate";
import { useUnsavedChanges } from "./use-unsaved-changes";

type ListState = { status: "loading" } | { status: "ready"; papers: SharedPaper[] } | { status: "error" };
type DetailState = { status: "idle" } | { status: "loading" } | { status: "ready"; paper: SharedPaper } | { status: "error" };
type HistoryState = { status: "idle" } | { status: "loading" } | { status: "ready"; edits: SharedPaperEdit[] } | { status: "error" };

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function SharedPaperPageContent({ api }: { api: WebApiClient }) {
  const client = useMemo(() => createSharedPaperApi(api), [api]);
  const initialLocation = useMemo(() => getSharedPaperDetailLocation(window.location.search), []);
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [scope, setScope] = useState<SharedPaperScope>(initialLocation.scope);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchRetry, setSearchRetry] = useState(0);
  const [selected, setSelected] = useState<{ id: string } | null>(null);
  const [detail, setDetail] = useState<DetailState>({ status: "idle" });
  const [history, setHistory] = useState<HistoryState>({ status: "idle" });
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [baseline, setBaseline] = useState<{ title: string; content: string; revision: number } | null>(null);
  const [author, setAuthor] = useState<PaperAuthorValue>("L");
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createContent, setCreateContent] = useState("");
  const [createAuthor, setCreateAuthor] = useState<PaperAuthorValue>("L");
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState("");
  const triggerRef = useRef<HTMLElement | null>(null);
  const requestSerial = useRef(0);

  const load = useCallback(async () => {
    const serial = ++requestSerial.current;
    setList({ status: "loading" });
    try {
      const papers = query.trim() ? await client.search(query.trim(), undefined, scope) : await client.list(undefined, scope);
      if (serial === requestSerial.current) setList({ status: "ready", papers });
    } catch {
      if (serial === requestSerial.current) setList({ status: "error" });
    }
  }, [client, query, scope, searchRetry]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!initialLocation.paperId) return;
    let cancelled = false;
    triggerRef.current = document.body;
    setSelected({ id: initialLocation.paperId });
    setDetail({ status: "loading" });
    setHistory({ status: "idle" });
    setEditing(false);
    setConfirmingDelete(false);
    void client.get(initialLocation.paperId)
      .then((paper) => {
        if (cancelled) return;
        setSelected({ id: paper.id });
        setDetail({ status: "ready", paper });
        setScope(paper.archivedAt ? "archived" : "active");
      })
      .catch(() => {
        if (!cancelled) setDetail({ status: "error" });
      });
    return () => { cancelled = true; };
  }, [client, initialLocation.paperId]);

  useUnsavedChanges(Boolean(editing && baseline && (draftTitle !== baseline.title || draft !== baseline.content)) || Boolean(createOpen && (createTitle || createContent)));

  const openDetail = useCallback(async (paper: SharedPaper, trigger: HTMLElement) => {
    triggerRef.current = trigger;
    setSelected(paper);
    setDetail({ status: "loading" });
    setHistory({ status: "idle" });
    setEditing(false);
    setConfirmingDelete(false);
    try { setDetail({ status: "ready", paper: await client.get(paper.id) }); }
    catch { setDetail({ status: "error" }); }
  }, [client]);

  const retryDetail = async () => {
    if (!selected) return;
    setDetail({ status: "loading" });
    try { setDetail({ status: "ready", paper: await client.get(selected.id) }); }
    catch { setDetail({ status: "error" }); }
  };

  const beginEdit = () => {
    if (detail.status !== "ready" || detail.paper.archivedAt) return;
    setDraftTitle(detail.paper.title);
    setDraft(detail.paper.content);
    setBaseline({ title: detail.paper.title, content: detail.paper.content, revision: detail.paper.revision });
    setAuthor(detail.paper.updatedBy);
    setEditing(true);
    setConflict(false);
    setHistory({ status: "idle" });
    setError("");
  };

  const saveEdit = async () => {
    if (detail.status !== "ready" || !baseline || author === null || conflict || !draftTitle.trim()) return;
    const titleRange = createContiguousRangeEdit(baseline.title, draftTitle);
    const contentRange = createContiguousRangeEdit(baseline.content, draft);
    if (!titleRange && !contentRange) { setEditing(false); setError(""); return; }
    setSaving(true); setError("");
    try {
      let paper = detail.paper;
      let revision = baseline.revision;
      if (titleRange) {
        const result = await client.edit(detail.paper.id, { expected_revision: revision, author, target: "title", ...titleRange });
        paper = result.paper;
        revision = result.paper.revision;
      }
      if (contentRange) {
        const result = await client.edit(detail.paper.id, { expected_revision: revision, author, target: "content", ...contentRange });
        paper = result.paper;
      }
      setDetail({ status: "ready", paper });
      setSelected(paper); setEditing(false); resetEditDraft(); setSaving(false);
      setConflict(false);
      void load();
    } catch (cause) {
      setSaving(false);
      const revisionConflict = cause instanceof WebApiError && cause.status === 409;
      try {
        const latest = await client.get(detail.paper.id);
        setDetail({ status: "ready", paper: latest });
        setSelected(latest);
        if (latest.title === draftTitle && latest.content === draft) {
          setEditing(false);
          resetEditDraft();
          setConflict(false);
          setError("");
          void load();
          return;
        }
        setConflict(true);
        setError(revisionConflict
          ? "paper 已被其他编辑更新。可以继续保留当前草稿，或载入最新版本。"
          : "保存结果与当前草稿不一致。已读取服务器最新版本，可以继续保留当前草稿或载入最新版本。");
      } catch {
        setConflict(true);
        setError(revisionConflict
          ? "paper 已被其他编辑更新。当前版本暂时无法读取。"
          : "保存结果暂时无法确认，且当前版本暂时无法读取。");
      }
    }
  };

  const loadHistory = async () => {
    if (!selected) return;
    setHistory({ status: "loading" });
    try { setHistory({ status: "ready", edits: await client.edits(selected.id) }); }
    catch { setHistory({ status: "error" }); }
  };

  const resetCreateDraft = () => {
    setCreateTitle("");
    setCreateContent("");
    setCreateAuthor("L");
  };

  const resetEditDraft = () => {
    setDraftTitle("");
    setDraft("");
    setBaseline(null);
    setConflict(false);
  };

  const cancelCreate = () => {
    const dirty = Boolean(createTitle || createContent);
    if (!confirmUnsavedChanges(dirty, (message) => window.confirm(message))) return;
    resetCreateDraft();
    setCreateOpen(false);
    setError("");
  };

  const cancelEdit = () => {
    const dirty = Boolean(baseline && (draftTitle !== baseline.title || draft !== baseline.content));
    if (!confirmUnsavedChanges(dirty, (message) => window.confirm(message))) return;
    resetEditDraft();
    setEditing(false);
    setError("");
  };

  const keepDraftAfterConflict = () => {
    if (detail.status !== "ready" || !conflict) return;
    setSelected(detail.paper);
    setBaseline({ title: detail.paper.title, content: detail.paper.content, revision: detail.paper.revision });
    setConflict(false);
    setError("");
  };

  const loadLatestAfterConflict = () => {
    if (detail.status !== "ready" || !conflict) return;
    setDraftTitle(detail.paper.title);
    setDraft(detail.paper.content);
    setBaseline({ title: detail.paper.title, content: detail.paper.content, revision: detail.paper.revision });
    setConflict(false);
    setError("");
  };

  const createPaper = async () => {
    if (!createTitle.trim() || createAuthor === null || creating) return;
    setCreating(true); setError("");
    try {
      const created = await client.create({ title: createTitle, content: createContent, author: createAuthor });
      setCreateOpen(false); resetCreateDraft(); setCreating(false);
      await load();
      await openDetail(created, triggerRef.current ?? document.body);
    } catch { setCreating(false); setError("无法创建 Shared Paper，请稍后重试。"); }
  };

  const openArchive = (trigger: HTMLElement) => {
    triggerRef.current = trigger;
    setQuery("");
    setSearchOpen(false);
    setScope("archived");
    setError("");
  };

  const returnFromArchive = () => {
    setQuery("");
    setSearchOpen(false);
    setScope("active");
    setError("");
  };

  const returnFromDeepLink = (): boolean => {
    if (!initialLocation.paperId) return false;
    navigateWithinApp(initialLocation.returnTo, window.history.state, { resetScroll: false });
    return true;
  };

  const closeLifecycleDetail = async () => {
    setSelected(null);
    setDetail({ status: "idle" });
    setHistory({ status: "idle" });
    setConfirmingDelete(false);
    if (!returnFromDeepLink()) await load();
  };

  const reconcileLifecycleFailure = async (
    paperId: string,
    expected: "archived" | "active" | "deleted",
  ): Promise<"committed" | "not_committed" | "unknown"> => {
    try {
      const latest = await client.get(paperId);
      setDetail({ status: "ready", paper: latest });
      setSelected(latest);
      if (expected === "archived") return latest.archivedAt ? "committed" : "not_committed";
      if (expected === "active") return latest.archivedAt ? "not_committed" : "committed";
      return "not_committed";
    } catch (cause) {
      if (cause instanceof WebApiError && cause.status === 404) {
        return expected === "deleted" ? "committed" : "unknown";
      }
      return "unknown";
    }
  };

  const archivePaper = async () => {
    if (detail.status !== "ready" || detail.paper.archivedAt || archiving) return;
    if (!window.confirm(`确定归档“${detail.paper.title}”吗？`)) return;
    const paperId = detail.paper.id;
    setArchiving(true);
    setError("");
    try {
      await client.archive(paperId);
      await closeLifecycleDetail();
    } catch {
      const reconciled = await reconcileLifecycleFailure(paperId, "archived");
      if (reconciled === "committed") await closeLifecycleDetail();
      else setError(reconciled === "unknown"
        ? "归档结果暂时无法确认，请刷新后再操作。"
        : "无法归档 Shared Paper，请稍后重试。");
    } finally {
      setArchiving(false);
    }
  };

  const restorePaper = async () => {
    if (detail.status !== "ready" || !detail.paper.archivedAt || restoring) return;
    const paperId = detail.paper.id;
    setRestoring(true);
    setError("");
    try {
      await client.restore(paperId);
      await closeLifecycleDetail();
    } catch {
      const reconciled = await reconcileLifecycleFailure(paperId, "active");
      if (reconciled === "committed") await closeLifecycleDetail();
      else setError(reconciled === "unknown"
        ? "恢复结果暂时无法确认，请刷新后再操作。"
        : "无法恢复 Shared Paper，请稍后重试。");
    } finally {
      setRestoring(false);
    }
  };

  const permanentlyDeletePaper = async () => {
    if (detail.status !== "ready" || !detail.paper.archivedAt || !confirmingDelete || deleting) return;
    const paperId = detail.paper.id;
    setDeleting(true);
    setError("");
    try {
      await client.remove(paperId);
      await closeLifecycleDetail();
    } catch {
      const reconciled = await reconcileLifecycleFailure(paperId, "deleted");
      if (reconciled === "committed") await closeLifecycleDetail();
      else setError(reconciled === "unknown"
        ? "删除结果暂时无法确认，请刷新后再操作。"
        : "无法永久删除 Shared Paper，请稍后重试。");
    } finally {
      setDeleting(false);
    }
  };

  const closeDialog = () => {
    if (archiving || restoring || deleting) return false;
    const dirty = Boolean(editing && baseline && draft !== baseline.content) || Boolean(createOpen && (createTitle || createContent));
    if (!confirmUnsavedChanges(dirty, (message) => window.confirm(message))) return false;
    setSelected(null); setDetail({ status: "idle" }); setCreateOpen(false); resetCreateDraft(); resetEditDraft(); setEditing(false); setHistory({ status: "idle" }); setConfirmingDelete(false); setError("");
    returnFromDeepLink();
    return true;
  };

  const papers = list.status === "ready" ? list.papers : [];
  const detailArchived = detail.status === "ready" && detail.paper.archivedAt !== null;
  const lifecycleBusy = archiving || restoring || deleting;
  const detailTopRight = detail.status !== "ready" ? null : editing ? (
    <><button className="memory-paper-control" disabled={saving} onClick={cancelEdit}>取消</button><span>·</span><button className="memory-paper-control" disabled={saving || conflict || author === null || !draftTitle.trim()} onClick={() => void saveEdit()}>{saving ? "保存中…" : "保存"}</button></>
  ) : confirmingDelete ? (
    <><button className="memory-paper-control" disabled={deleting} onClick={() => setConfirmingDelete(false)}>取消</button><span>·</span><button className="memory-paper-control" disabled={deleting} onClick={() => void permanentlyDeletePaper()}>{deleting ? "删除中…" : "确认永久删除"}</button></>
  ) : history.status !== "idle" ? (
    detailArchived
      ? <><button className="memory-paper-control" disabled={lifecycleBusy} onClick={() => setHistory({ status: "idle" })}>返回</button><span>·</span><button className="memory-paper-control" disabled={lifecycleBusy} onClick={() => void restorePaper()}>{restoring ? "恢复中…" : "恢复"}</button></>
      : <><button className="memory-paper-control" onClick={() => setHistory({ status: "idle" })}>返回</button><span>·</span><button className="memory-paper-control" onClick={beginEdit}>编辑</button></>
  ) : detailArchived ? (
    <><button className="memory-paper-control" disabled={lifecycleBusy} onClick={() => void loadHistory()}>历史</button><span>·</span><button className="memory-paper-control" disabled={lifecycleBusy} onClick={() => void restorePaper()}>{restoring ? "恢复中…" : "恢复"}</button><span>·</span><button className="memory-paper-control" disabled={lifecycleBusy} onClick={() => setConfirmingDelete(true)}>删除</button></>
  ) : (
    <><button className="memory-paper-control" disabled={lifecycleBusy} onClick={() => void loadHistory()}>历史</button><span>·</span><button className="memory-paper-control" disabled={lifecycleBusy} onClick={() => void archivePaper()}>{archiving ? "归档中…" : "归档"}</button><span>·</span><button className="memory-paper-control" disabled={lifecycleBusy} onClick={beginEdit}>编辑</button></>
  );
  return (
    <div className="page memory-page shared-paper-page">
      {scope === "active" ? <header className="memory-page-header shared-paper-page-header">
        <div className="memory-page-heading"><div className="memory-page-title">Shared Paper</div><div className="memory-page-count">{papers.length}张纸</div></div>
        <div className="memory-page-tools shared-paper-page-tools">
          <ModuleSearchButton label="搜索 Shared Paper" expanded={searchOpen} disabled={list.status === "loading"} onClick={() => setSearchOpen((value) => !value)} />
          <button type="button" aria-label="查看归档" disabled={list.status === "loading"} onClick={(event) => openArchive(event.currentTarget)}><ArchiveIcon /></button>
          <button type="button" aria-label="新增 Shared Paper" disabled={list.status === "loading"} onClick={(event) => { triggerRef.current = event.currentTarget; setCreateOpen(true); setError(""); }}><PenIcon className="memory-page-create-icon" /></button>
        </div>
        {searchOpen ? <ModuleSearchField ariaLabel="搜索 Shared Paper" placeholder="搜索标题或正文" value={query} onChange={setQuery} /> : null}
      </header> : <header className="memory-page-header memory-archive-header shared-paper-archive-header">
        <div className="memory-page-heading"><div className="memory-page-title">Archive</div><div className="memory-page-count">{papers.length}张纸</div></div>
        <button type="button" className="memory-archive-back" onClick={returnFromArchive}>Return</button>
      </header>}

      {list.status === "loading" ? (
        query ? (
          <ModuleStateMessage state="loading" placement="module" emptyText="" errorText="" loadingText="正在搜索…" />
        ) : (
          <SharedPaperListLoading label={scope === "archived" ? "Shared Paper Archive 加载中" : "Shared Paper 加载中"} />
        )
      ) : null}
      {list.status === "error" ? <ModuleStateMessage state="error" placement="module" emptyText="" errorText="暂时无法读取 Shared Paper" retryLabel="重新加载" onRetry={() => setSearchRetry((value) => value + 1)} /> : null}
      {list.status === "ready" && papers.length === 0 ? (
        query ? (
          <ModuleStateMessage state="empty" placement="module" emptyText="没有符合条件的 Shared Paper" errorText="" />
        ) : (
          <section className="memory-empty-state"><p>{scope === "archived" ? "还没有归档 Shared Paper" : "还没有 Shared Paper"}</p></section>
        )
      ) : null}
      {list.status === "ready" && papers.length > 0 ? <section className="memory-months shared-paper-list" aria-label={scope === "archived" ? "Shared Paper Archive 列表" : "Shared Paper 列表"}><section className="memory-month-section"><h2 className="memory-month-label">{scope === "archived" ? "Archive" : "Shared Paper"}</h2><div className="memory-month-card">{papers.map((paper) => <button key={paper.id} type="button" className="memory-row shared-paper-row" data-paper-id={paper.id} onClick={(event) => void openDetail(paper, event.currentTarget)}><span className="memory-row-title">{paper.title}</span><span className="memory-row-meta"><span>{formatDate(paper.updatedAt)}</span><span>revision {paper.revision} · {paper.updatedBy}</span></span></button>)}</div></section></section> : null}

      {scope === "active" && createOpen ? <PaperDetailDialog id="memory-shared-paper-create" open label="创建 Shared Paper" dateLabel="现在" signature="" triggerRef={triggerRef} onRequestClose={closeDialog} errorMessage={error} topRight={<><button className="memory-paper-control" disabled={creating} onClick={cancelCreate}>取消</button><span>·</span><button className="memory-paper-control" disabled={creating || !createTitle.trim() || createAuthor === null} onClick={() => void createPaper()}>{creating ? "保存中…" : "保存"}</button></>} bottomLeft={<PaperAuthorSignature value={createAuthor} editable disabled={creating} onChange={setCreateAuthor} />}><div className="memory-paper-editor"><input className="memory-paper-key" aria-label="Shared Paper 标题" placeholder="Title" value={createTitle} disabled={creating} maxLength={200} onChange={(event) => setCreateTitle(event.target.value)} /><SharedPaperBodyEditor content={createContent} disabled={creating} placeholder="Content" onContentChange={setCreateContent} /></div></PaperDetailDialog> : null}

      {selected && detail.status !== "ready" ? <PaperDetailDialog id="memory-shared-paper-detail" open label="Shared Paper" dateLabel="" signature="" triggerRef={triggerRef} onRequestClose={closeDialog}><ModuleStateMessage state={detail.status === "loading" ? "loading" : "error"} placement="paper" emptyText="" errorText="无法读取 Shared Paper" loadingText="正在读取 Shared Paper…" onRetry={() => void retryDetail()} /></PaperDetailDialog> : null}

      {selected && detail.status === "ready" ? <PaperDetailDialog id="memory-shared-paper-detail" open label={`Shared Paper ${detail.paper.title}`} dateLabel={formatDate(detail.paper.updatedAt)} signature="" triggerRef={triggerRef} onRequestClose={closeDialog} errorMessage={error} topRight={detailTopRight} bottomLeft={<><span>revision {detail.paper.revision} · {formatDate(detail.paper.updatedAt)}</span><PaperAuthorSignature value={editing ? author : detail.paper.updatedBy} editable={editing} disabled={saving} onChange={setAuthor} /></>}>
          {editing ? <div className="memory-paper-editor"><input className="memory-paper-key" aria-label="Shared Paper 标题" value={draftTitle} disabled={saving} maxLength={200} onChange={(event) => setDraftTitle(event.target.value)} /><SharedPaperBodyEditor content={draft} disabled={saving} onContentChange={setDraft} />{conflict ? <div className="shared-paper-conflict-actions"><button className="secondary-button" type="button" onClick={keepDraftAfterConflict}>继续保留当前草稿</button><button className="secondary-button" type="button" onClick={loadLatestAfterConflict}>载入最新版本</button></div> : null}</div> : history.status === "loading" ? <ModuleStateMessage state="loading" placement="paper" emptyText="" errorText="" loadingText="正在读取历史…" /> : history.status === "error" ? <ModuleStateMessage state="error" placement="paper" emptyText="" errorText="无法读取历史" onRetry={() => void loadHistory()} /> : history.status === "ready" ? <HistoryView paper={detail.paper} edits={history.edits} /> : <div className="shared-paper-detail-content"><h1 className="memory-paper-title">{detail.paper.title}</h1><p className="memory-paper-content">{detail.paper.content}</p></div>}
        </PaperDetailDialog> : null}
    </div>
  );
}

function SharedPaperListLoading({ label }: { label: string }) {
  return (
    <section className="memory-months" aria-label={label} aria-busy="true">
      <span className="visually-hidden" role="status" aria-live="polite">正在读取 Shared Paper…</span>
      {[0, 1].map((index) => (
        <div className="memory-month-skeleton" aria-hidden="true" key={index}>
          <span className="memory-month-skeleton-label" />
          <div className="memory-month-skeleton-card">
            <span />
            <span />
          </div>
        </div>
      ))}
    </section>
  );
}

function HistoryView({ paper, edits }: { paper: SharedPaper; edits: SharedPaperEdit[] }) {
  const ordered = [...edits].sort((left, right) => right.revision - left.revision);
  return <div className="shared-paper-history">{ordered.map((edit) => { const diff = diffText(edit.deletedText, edit.insertedText); return <div className="shared-paper-history-event" key={edit.id}><strong>{edit.target === "title" ? "Title · " : ""}{edit.author} · {edit.baseRevision}→{edit.revision}</strong><span>{formatDate(edit.createdAt)}</span><span>− <mark>{diff.deleted || "∅"}</mark></span><span>+ <mark>{diff.inserted || "∅"}</mark></span></div>; })}<div className="shared-paper-history-event shared-paper-history-created"><strong>Created</strong><span>{paper.createdBy} · revision 1 · {formatDate(paper.createdAt)}</span></div></div>;
}
