import { useCallback, useEffect, useRef, useState } from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import { CalendarPreview, type CalendarLoadState } from "./CalendarPreview";
import { listDiaryDates } from "./day-space-api";
import { mergeCalendarContentDates } from "./home-calendar-data";
import { formatTodoStorageDate } from "./todo-paper-storage";
import { TodayPanel } from "./TodayPanel";
import { TodoPaperDialog } from "./TodoPaperDialog";
import { loadTodoDay, listTodoDates } from "./todo-api";
import type { TodoAuthor, TodoDay } from "./todo-types";


const defaultNow = () => new Date();

export function DashboardPageContent({ api, now = defaultNow }: { api?: WebApiClient; now?: () => Date }) {
  const [dateKey, setDateKey] = useState(() => formatTodoStorageDate(now()));
  const [today, setToday] = useState(() => now());
  const [papers, setPapers] = useState<TodoDay["papers"]>({ L: null, G: null, C: null });
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [calendarContentDates, setCalendarContentDates] = useState<string[]>([]);
  const [calendarLoadState, setCalendarLoadState] = useState<CalendarLoadState>("loading");
  const [dialogAuthor, setDialogAuthor] = useState<TodoAuthor | null>(null);
  const [dialogDirty, setDialogDirty] = useState(false);
  const [, setPendingDate] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const calendarLoadGeneration = useRef(0);
  const lTriggerRef = useRef<HTMLButtonElement>(null);
  const gTriggerRef = useRef<HTMLButtonElement>(null);
  const cTriggerRef = useRef<HTMLButtonElement>(null);

  const loadDay = useCallback(async (nextDate: string) => {
    if (!api) { setLoadState("error"); return; }
    const generation = ++loadGeneration.current;
    setLoadState("loading");
    try {
      const response = await loadTodoDay(api, nextDate);
      if (generation !== loadGeneration.current) return;
      setPapers(response.papers);
      setLoadState("ready");
    } catch {
      if (generation === loadGeneration.current) setLoadState("error");
    }
  }, [api]);

  const loadCalendar = useCallback(async () => {
    const generation = ++calendarLoadGeneration.current;
    setCalendarContentDates([]);
    if (!api) {
      setCalendarLoadState("error");
      return;
    }
    setCalendarLoadState("loading");
    try {
      const [todoDates, diaryDates] = await Promise.all([
        listTodoDates(api),
        listDiaryDates(api),
      ]);
      if (generation !== calendarLoadGeneration.current) return;
      setCalendarContentDates(mergeCalendarContentDates(todoDates, diaryDates));
      setCalendarLoadState("ready");
    } catch {
      if (generation !== calendarLoadGeneration.current) return;
      setCalendarContentDates([]);
      setCalendarLoadState("error");
    }
  }, [api]);

  useEffect(() => { void loadDay(dateKey); }, [dateKey, loadDay]);
  useEffect(() => {
    void loadCalendar();
    return () => { calendarLoadGeneration.current += 1; };
  }, [loadCalendar]);

  useEffect(() => {
    const checkDate = () => {
      const nextDate = formatTodoStorageDate(now());
      if (nextDate === dateKey) return;
      if (dialogDirty) setPendingDate(nextDate);
      else { setToday(now()); setDateKey(nextDate); }
    };
    window.addEventListener("focus", checkDate);
    document.addEventListener("visibilitychange", checkDate);
    return () => { window.removeEventListener("focus", checkDate); document.removeEventListener("visibilitychange", checkDate); };
  }, [dateKey, dialogDirty, now]);

  const selectedPaper = dialogAuthor ? papers[dialogAuthor] : null;
  const selectedTriggerRef = dialogAuthor === "L" ? lTriggerRef : dialogAuthor === "G" ? gTriggerRef : cTriggerRef;

  return (
    <div className="page home-prototype">
      <div className="home-page-heading">
        <h1 className="home-page-title">Todo</h1>
        {loadState === "error" ? <div className="home-inline-unavailable" role="alert"><span>Unable to read Todo.</span><button type="button" onClick={() => void loadDay(dateKey)}>Retry</button></div> : null}
      </div>
      <main className="home-prototype-content">
        <TodayPanel author="L" notes={loadState === "ready" ? papers.L?.entries ?? [] : []} triggerRef={lTriggerRef} onOpen={() => setDialogAuthor("L")} />
        <TodayPanel author="G" notes={loadState === "ready" ? papers.G?.entries ?? [] : []} triggerRef={gTriggerRef} onOpen={() => setDialogAuthor("G")} />
        <TodayPanel author="C" notes={loadState === "ready" ? papers.C?.entries ?? [] : []} triggerRef={cTriggerRef} onOpen={() => setDialogAuthor("C")} />
        <CalendarPreview
          contentDates={calendarContentDates}
          date={today}
          status={calendarLoadState}
          onRetry={loadCalendar}
        />
      </main>
      {dialogAuthor ? <TodoPaperDialog api={api} author={dialogAuthor} date={today} open paper={selectedPaper} triggerRef={selectedTriggerRef} onSaved={(paper) => { setPapers((current) => ({ ...current, [paper.author]: paper })); void loadCalendar(); }} onDirtyChange={setDialogDirty} onClosed={() => { setDialogAuthor(null); setDialogDirty(false); setPendingDate((nextDate) => { if (nextDate) { setToday(now()); setDateKey(nextDate); } return null; }); }} /> : null}
    </div>
  );
}
