import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { WebApiClient } from "../api/useWebApiClient";
import { CalendarPreview } from "./CalendarPreview";
import { HOME_CALENDAR_DAYS, type HomeAuthor, type HomeNote } from "./home-prototype-data";
import { formatTodoStorageDate } from "./todo-paper-storage";
import { TodayPanel } from "./TodayPanel";
import { TodoPaperDialog } from "./TodoPaperDialog";
import { loadTodoDay } from "./todo-api";
import { migrateLegacyTodoPapers } from "./todo-legacy-migration";
import type { TodoPaper } from "./todo-types";
import { navigateWithinApp } from "./app-navigation";
import { createQuickCreateState, type QuickCreateTarget } from "./quick-create";

export function formatHomeDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(date);
}

function previewNotes(paper: TodoPaper | null): HomeNote[] {
  return (paper?.entries ?? []).map((entry) => ({ ...entry, author: paper?.author ?? "L" }));
}

export function DashboardPageContent({ api }: { api?: WebApiClient }) {
  const [dateKey, setDateKey] = useState(() => formatTodoStorageDate(new Date()));
  const [today, setToday] = useState(() => new Date());
  const [papers, setPapers] = useState<{ L: TodoPaper | null; G: TodoPaper | null }>({ L: null, G: null });
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [dialogAuthor, setDialogAuthor] = useState<HomeAuthor | null>(null);
  const [dialogDirty, setDialogDirty] = useState(false);
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const lTriggerRef = useRef<HTMLButtonElement>(null);
  const gTriggerRef = useRef<HTMLButtonElement>(null);

  const loadDay = useCallback(async (nextDate: string) => {
    if (!api) { setLoadState("error"); return; }
    setLoadState("loading");
    try {
      const response = await loadTodoDay(api, nextDate);
      setPapers(response.papers);
      setLoadState("ready");
      const storage = typeof window === "undefined" ? null : window.localStorage;
      if (storage) void migrateLegacyTodoPapers({ storage, api });
    } catch {
      setLoadState("error");
    }
  }, [api]);

  useEffect(() => { void loadDay(dateKey); }, [dateKey, loadDay]);

  useEffect(() => {
    const checkDate = () => {
      const nextDate = formatTodoStorageDate(new Date());
      if (nextDate === dateKey) return;
      if (dialogDirty) setPendingDate(nextDate);
      else { setToday(new Date()); setDateKey(nextDate); }
    };
    window.addEventListener("focus", checkDate);
    document.addEventListener("visibilitychange", checkDate);
    return () => { window.removeEventListener("focus", checkDate); document.removeEventListener("visibilitychange", checkDate); };
  }, [dateKey, dialogDirty]);

  const openQuickCreate = (target: QuickCreateTarget, event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    navigateWithinApp(`/${target}`, createQuickCreateState(window.history.state, target));
  };

  const selectedPaper = dialogAuthor ? papers[dialogAuthor] : null;
  const selectedTriggerRef = dialogAuthor === "L" ? lTriggerRef : gTriggerRef;
  const selectedNotes = useMemo(() => previewNotes(selectedPaper), [selectedPaper]);

  return (
    <div className="page home-prototype">
      <h1 className="home-page-title">Todo</h1>
      <main className="home-prototype-content">
        {loadState === "error" ? <div className="home-todo-error" role="alert">Todo 暂时无法读取。<button type="button" onClick={() => void loadDay(dateKey)}>重试</button></div> : null}
        <TodayPanel author="L" notes={loadState === "ready" ? previewNotes(papers.L) : []} triggerRef={lTriggerRef} onOpen={() => setDialogAuthor("L")} />
        <TodayPanel author="G" notes={loadState === "ready" ? previewNotes(papers.G) : []} triggerRef={gTriggerRef} onOpen={() => setDialogAuthor("G")} />
        <CalendarPreview days={HOME_CALENDAR_DAYS} date={today} />
        <section className="home-section home-preview-section records-section" aria-labelledby="records-title">
          <div className="home-section-heading records-section-heading"><h2 id="records-title">Records</h2></div>
          <nav className="home-bottom-nav" aria-label="模块入口">
            <a href="/memory" onClick={(event) => openQuickCreate("memory", event)}>Memory</a>
            <a href="/diary" onClick={(event) => openQuickCreate("diary", event)}>Diary</a>
            <a href="/task" onClick={(event) => openQuickCreate("task", event)}>Task</a>
            <Link to="/universe">Universe</Link>
          </nav>
        </section>
      </main>
      {dialogAuthor ? <TodoPaperDialog api={api} author={dialogAuthor} date={today} open paper={selectedPaper} entries={selectedNotes} triggerRef={selectedTriggerRef} onSaved={(paper) => { setPapers((current) => ({ ...current, [paper.author]: paper })); }} onDirtyChange={setDialogDirty} onClosed={() => { setDialogAuthor(null); setDialogDirty(false); setPendingDate((nextDate) => { if (nextDate) { setToday(new Date()); setDateKey(nextDate); } return null; }); }} /> : null}
    </div>
  );
}
