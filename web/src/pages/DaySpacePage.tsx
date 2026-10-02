import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { layoutDaySpacePapers } from "./day-space-layout.js";
import {
  buildDaySpaceLocation,
  businessDateToLocalDate,
  formatDaySpaceNavigationDate,
  formatLocalBusinessDate,
  parseExplicitDaySpaceDate,
  shiftBusinessDate,
} from "./day-space-location.js";
import { DaySpaceDatePicker } from "./DaySpaceDatePicker..js";
import { DaySpaceDiaryDialog } from "./DaySpaceDiaryDialog..js";
import { TodoPaperDialog } from "./TodoPaperDialog..js";
import { ModuleSearchButton, ModuleSearchField, ModuleStateMessage, type ModuleSearchState } from "../components/ModuleSearch";
import { ModuleState, PageState } from "../components/StateSurface";
import { composeDaySpacePapers, resolveDaySpaceDefaultDate, type DaySpaceModuleState } from "./day-space-data.js";
import type { DaySpaceApi, DaySpaceDiary } from "./day-space-api.js";
import type { TodoAuthor, TodoDay, TodoPaper } from "./todo-types.js";
import type { TodoSearchEntry } from "./todo-api.js";

type DaySpacePaper =
  | { type: "todo"; id: string; paper: TodoPaper }
  | { type: "diary"; id: string; diary: DaySpaceDiary };

function densityForPaper(paper: DaySpacePaper): number {
  if (paper.type === "todo") return Math.max(1, paper.paper.entries.length);
  return Math.max(2, Math.min(6, Math.ceil((paper.diary.title.length + paper.diary.content.length) / 44)));
}

export function DaySpacePageContent({ api }: { api: DaySpaceApi }) {
  const location = useLocation();
  const navigate = useNavigate();
  const today = formatLocalBusinessDate(new Date());
  const explicitDate = parseExplicitDaySpaceDate(location.search);
  const requestedAuthor = new URLSearchParams(location.search).get("author") as TodoAuthor | null;
  const [selectedDate, setSelectedDate] = useState<string | null>(explicitDate);
  const [discoveryStatus, setDiscoveryStatus] = useState<"idle" | "loading" | "error" | "ready">(explicitDate ? "ready" : "idle");
  const [discoveryIncomplete, setDiscoveryIncomplete] = useState(false);
  const [discoveryRetry, setDiscoveryRetry] = useState(0);
  const [todoState, setTodoState] = useState<DaySpaceModuleState<TodoDay>>({ status: "loading" });
  const [diaryState, setDiaryState] = useState<DaySpaceModuleState<DaySpaceDiary[]>>({ status: "loading" });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openPaperId, setOpenPaperId] = useState<string | null>(null);
  const [todoSearchOpen, setTodoSearchOpen] = useState(false);
  const [todoSearchDraft, setTodoSearchDraft] = useState("");
  const [todoSearchState, setTodoSearchState] = useState<ModuleSearchState>("idle");
  const [todoSearchResults, setTodoSearchResults] = useState<TodoSearchEntry[]>([]);
  const [todoSearchRetry, setTodoSearchRetry] = useState(0);
  const [stageWidth, setStageWidth] = useState(345);
  const stageMeasureRef = useRef<HTMLDivElement | null>(null);
  const paperTriggerRef = useRef<HTMLButtonElement | null>(null);
  const generation = useRef(0);
  const todoRequest = useRef(0);
  const diaryRequest = useRef(0);
  const todoController = useRef<AbortController | null>(null);
  const diaryController = useRef<AbortController | null>(null);
  const todoSearchController = useRef<AbortController | null>(null);
  const todoSearchSequence = useRef(0);
  const openedRequestedPaper = useRef<string | null>(null);
  const selectedDateRef = useRef<string | null>(selectedDate);
  selectedDateRef.current = selectedDate;

  const loadDate = useCallback((date: string) => {
    const current = ++generation.current;
    todoController.current?.abort();
    diaryController.current?.abort();
    const todoAbort = new AbortController();
    const diaryAbort = new AbortController();
    todoController.current = todoAbort;
    diaryController.current = diaryAbort;
    const todoTicket = ++todoRequest.current;
    const diaryTicket = ++diaryRequest.current;
    selectedDateRef.current = date;
    setSelectedDate(date);
    setOpenPaperId(null);
    setTodoState({ status: "loading" });
    setDiaryState({ status: "loading" });
    void api.loadTodoDay(date, todoAbort.signal).then((value) => {
      if (todoAbort.signal.aborted || generation.current !== current || todoRequest.current !== todoTicket || selectedDateRef.current !== date) return;
      setTodoState({ status: "ready", value });
    }).catch(() => {
      if (todoAbort.signal.aborted || generation.current !== current || todoRequest.current !== todoTicket || selectedDateRef.current !== date) return;
      setTodoState({ status: "error" });
    });
    void api.loadDiariesByDate(date, diaryAbort.signal).then((value) => {
      if (diaryAbort.signal.aborted || generation.current !== current || diaryRequest.current !== diaryTicket || selectedDateRef.current !== date) return;
      setDiaryState({ status: "ready", value: value.diaries });
    }).catch(() => {
      if (diaryAbort.signal.aborted || generation.current !== current || diaryRequest.current !== diaryTicket || selectedDateRef.current !== date) return;
      setDiaryState({ status: "error" });
    });
  }, [api]);

  const retryTodo = useCallback((date: string) => {
    if (selectedDateRef.current !== date) return;
    todoController.current?.abort();
    const abort = new AbortController();
    todoController.current = abort;
    const ticket = ++todoRequest.current;
    const current = generation.current;
    setTodoState((current) => ({ status: "loading", value: current.value }));
    void api.loadTodoDay(date, abort.signal).then((value) => {
      if (abort.signal.aborted || generation.current !== current || todoRequest.current !== ticket || selectedDateRef.current !== date) return;
      setTodoState({ status: "ready", value });
    }).catch(() => {
      if (abort.signal.aborted || generation.current !== current || todoRequest.current !== ticket || selectedDateRef.current !== date) return;
      setTodoState((current) => ({ status: "error", value: current.value, needsRetry: true }));
    });
  }, [api]);

  const retryDiary = useCallback((date: string) => {
    if (selectedDateRef.current !== date) return;
    diaryController.current?.abort();
    const abort = new AbortController();
    diaryController.current = abort;
    const ticket = ++diaryRequest.current;
    const current = generation.current;
    setDiaryState((current) => ({ status: "loading", value: current.value }));
    void api.loadDiariesByDate(date, abort.signal).then((value) => {
      if (abort.signal.aborted || generation.current !== current || diaryRequest.current !== ticket || selectedDateRef.current !== date) return;
      setDiaryState({ status: "ready", value: value.diaries });
    }).catch(() => {
      if (abort.signal.aborted || generation.current !== current || diaryRequest.current !== ticket || selectedDateRef.current !== date) return;
      setDiaryState((current) => ({ status: "error", value: current.value, needsRetry: true }));
    });
  }, [api]);

  useEffect(() => {
    const date = parseExplicitDaySpaceDate(location.search);
    if (date) {
      setDiscoveryStatus("ready");
      setDiscoveryIncomplete(false);
      loadDate(date);
      return;
    }

    let cancelled = false;
    setDiscoveryStatus("loading");
    selectedDateRef.current = null;
    setSelectedDate(null);
    setTodoState({ status: "loading" });
    setDiaryState({ status: "loading" });
    const discoveryAbort = new AbortController();
    void Promise.allSettled([api.listTodoDates(discoveryAbort.signal), api.listDiaryDates(discoveryAbort.signal)]).then((results) => {
      if (cancelled) return;
      const resolved = resolveDaySpaceDefaultDate({
        todo: results[0]?.status === "fulfilled" ? { status: "success", dates: results[0].value } : { status: "error" },
        diary: results[1]?.status === "fulfilled" ? { status: "success", dates: results[1].value } : { status: "error" },
      }, today);
      if (resolved.status === "error") {
        setDiscoveryStatus("error");
        return;
      }
      setDiscoveryStatus("ready");
      setDiscoveryIncomplete(resolved.discoveryIncomplete);
      loadDate(resolved.date);
    });
    return () => { cancelled = true; discoveryAbort.abort(); };
  }, [api, location.search, loadDate, today, discoveryRetry]);

  useEffect(() => {
    const element = stageMeasureRef.current;
    if (!element) return;
    const update = () => setStageWidth(Math.max(280, element.clientWidth));
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(element);
    window.addEventListener("resize", update);
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); };
  }, []);

  const papers = useMemo<DaySpacePaper[]>(() => {
    if (!selectedDate) return [];
    return [
      ...(todoState.value ? composeDaySpacePapers(selectedDate, todoState.value, []).filter((p) => p.type === "todo") : []),
      ...(diaryState.value ? diaryState.value.map((diary) => ({ type: "diary" as const, id: `diary:${diary.id}`, diary })) : []),
    ] as DaySpacePaper[];
  }, [selectedDate, todoState, diaryState]);

  const layout = useMemo(() => selectedDate ? layoutDaySpacePapers(selectedDate, papers.map((paper) => ({ id: paper.id, density: densityForPaper(paper) })), stageWidth) : null, [papers, selectedDate, stageWidth]);
  const layoutById = useMemo(() => new Map((layout?.items ?? []).map((item) => [item.id, item])), [layout]);
  const openPaper = papers.find((paper) => paper.id === openPaperId) ?? null;

  useEffect(() => {
    if (!selectedDate || !requestedAuthor || !["L", "G", "C"].includes(requestedAuthor)) return;
    const requestKey = `${selectedDate}:${requestedAuthor}`;
    if (openedRequestedPaper.current === requestKey) return;
    const target = papers.find((paper) => paper.type === "todo" && paper.paper.author === requestedAuthor);
    if (target) {
      openedRequestedPaper.current = requestKey;
      setOpenPaperId(target.id);
    }
  }, [papers, requestedAuthor, selectedDate]);

  useEffect(() => {
    const query = todoSearchDraft.normalize("NFC").trim();
    todoSearchController.current?.abort();
    if (!todoSearchOpen || !query) {
      setTodoSearchState("idle");
      setTodoSearchResults([]);
      return;
    }
    const controller = new AbortController();
    todoSearchController.current = controller;
    const sequence = ++todoSearchSequence.current;
    setTodoSearchState("loading");
    if (!api.searchTodo) {
      setTodoSearchState("error");
      return () => controller.abort();
    }
    void api.searchTodo(query, controller.signal).then((result) => {
      if (controller.signal.aborted || sequence !== todoSearchSequence.current) return;
      setTodoSearchResults(result.entries);
      setTodoSearchState(result.entries.length ? "ready" : "empty");
    }).catch(() => {
      if (controller.signal.aborted || sequence !== todoSearchSequence.current) return;
      setTodoSearchState("error");
      setTodoSearchResults([]);
    });
    return () => controller.abort();
  }, [api, todoSearchDraft, todoSearchOpen, todoSearchRetry]);

  const refreshDiary = useCallback(async (date: string, committed: DaySpaceDiary) => {
    const current = generation.current;
    const ticket = ++diaryRequest.current;
    diaryController.current?.abort();
    const abort = new AbortController();
    diaryController.current = abort;
    try {
      const result = await api.loadDiariesByDate(date, abort.signal);
      if (abort.signal.aborted || generation.current !== current || diaryRequest.current !== ticket || selectedDateRef.current !== date) return;
      setDiaryState({ status: "ready", value: result.diaries });
    } catch {
      if (abort.signal.aborted || generation.current !== current || diaryRequest.current !== ticket || selectedDateRef.current !== date) return;
      setDiaryState((current) => ({
        status: "error",
        value: current.value ? current.value.map((entry) => entry.id === committed.id ? committed : entry) : [committed],
        needsRetry: true,
      }));
    }
  }, [api]);

  const refreshTodo = useCallback(async (date: string, committed: TodoPaper) => {
    const current = generation.current;
    const ticket = ++todoRequest.current;
    todoController.current?.abort();
    const abort = new AbortController();
    todoController.current = abort;
    try {
      const result = await api.loadTodoDay(date, abort.signal);
      if (abort.signal.aborted || generation.current !== current || todoRequest.current !== ticket || selectedDateRef.current !== date) return;
      setTodoState({ status: "ready", value: result });
    } catch {
      if (abort.signal.aborted || generation.current !== current || todoRequest.current !== ticket || selectedDateRef.current !== date) return;
      setTodoState((current) => ({
        status: "error",
        value: current.value
          ? { ...current.value, papers: { ...current.value.papers, [committed.author]: committed.entries.length > 0 ? committed : null } }
          : { date, papers: { L: committed.author === "L" ? committed : null, G: committed.author === "G" ? committed : null, C: committed.author === "C" ? committed : null } },
        needsRetry: true,
      }));
    }
  }, [api]);

  const go = (date: string) => {
    setPickerOpen(false);
    navigate(buildDaySpaceLocation(date));
  };

  const moduleWarning = todoState.status === "error" || diaryState.status === "error";
  const bothModulesFailed = todoState.status === "error"
    && diaryState.status === "error"
    && todoState.value === undefined
    && diaryState.value === undefined;
  const completeEmpty = todoState.status === "ready" && diaryState.status === "ready" && papers.length === 0;

  return (
    <main className="day-space-page">
      <header className="memory-page-header day-space-header">
        <div className="memory-page-heading"><div className="memory-page-title">Day Space</div></div>
        <div className="memory-page-tools">
          <ModuleSearchButton label="搜索 Todo" expanded={todoSearchOpen} onClick={() => setTodoSearchOpen((value) => !value)} />
        </div>
        {todoSearchOpen ? <ModuleSearchField ariaLabel="搜索 Todo 内容" placeholder="Search todos..." value={todoSearchDraft} onChange={setTodoSearchDraft} /> : null}
      </header>
      {todoSearchOpen ? <div className="day-space-search-panel">
        <ModuleStateMessage state={todoSearchState} placement="inline" emptyText="没有匹配的 Todo" errorText="Unable to read todos." retryLabel="Retry" onRetry={() => setTodoSearchRetry((value) => value + 1)} />
        {todoSearchState === "ready" ? <div className="day-space-search-results" aria-label="Todo 搜索结果">
          {todoSearchResults.map((entry) => <button type="button" key={`${entry.date}:${entry.author}:${entry.entry_id}`} onClick={() => navigate(`/day-space?date=${encodeURIComponent(entry.date)}&author=${entry.author}`)}>
            <span>{entry.date} · {entry.author} · {entry.kind}</span><strong>{entry.snippet}</strong>
          </button>)}
        </div> : null}
      </div> : null}
      <div className="day-space-date-area">
        <div className="day-space-date-nav" aria-label="Day Space 日期导航">
          <button type="button" aria-label="前一天" disabled={!selectedDate} onClick={() => selectedDate && go(shiftBusinessDate(selectedDate, -1))}>‹</button>
          <button type="button" className="day-space-date-button" aria-expanded={pickerOpen} disabled={!selectedDate} onClick={() => setPickerOpen((value) => !value)}>{selectedDate ? formatDaySpaceNavigationDate(selectedDate) : "Reading..."}</button>
          <button type="button" aria-label="后一天" disabled={!selectedDate} onClick={() => selectedDate && go(shiftBusinessDate(selectedDate, 1))}>›</button>
        </div>
        {pickerOpen && selectedDate ? <DaySpaceDatePicker selectedDate={selectedDate} todayDate={today} onSelect={go} onClose={() => setPickerOpen(false)} /> : null}
      </div>
      {discoveryIncomplete && selectedDate ? <div className="day-space-warning" role="status">最新日期发现不完整，当前日期仍可查看。</div> : null}
      {selectedDate && moduleWarning && !bothModulesFailed ? <div className="day-space-warning" role="alert">部分 Day Space 内容暂时无法读取。{todoState.status === "error" ? <button type="button" onClick={() => retryTodo(selectedDate)}>重试 Todo</button> : null}{diaryState.status === "error" ? <button type="button" onClick={() => retryDiary(selectedDate)}>重试 Diary</button> : null}</div> : null}
      <div ref={stageMeasureRef} className="day-space-stage-measure">
        {discoveryStatus === "loading" && !selectedDate ? <PageState state="loading" message="Reading..." /> : discoveryStatus === "error" ? <PageState state="error" message="Unable to read Day Space." retryLabel="Retry" onRetry={() => setDiscoveryRetry((value) => value + 1)} /> : completeEmpty ? <ModuleState state="empty" message="这一天还没有内容" className="day-space-stage-state" /> : bothModulesFailed ? <PageState state="error" message="Unable to read Day Space." retryLabel="Retry" onRetry={() => selectedDate && loadDate(selectedDate)} /> : moduleWarning && papers.length === 0 ? null : papers.length === 0 ? <PageState state="loading" message="Reading..." /> : (
          <section className="day-space-stage" aria-label={`${selectedDate} 的内容`} style={{ height: `${layout?.stageHeight ?? 0}px` }}>
            {papers.map((paper) => {
              const item = layoutById.get(paper.id); if (!item) return null;
              const style = { left: item.left, top: item.top, width: item.width, height: item.height, zIndex: item.zIndex, transform: `rotate(${item.rotation.toFixed(2)}deg)` } satisfies CSSProperties;
              const todoEntries = paper.type === "todo" ? paper.paper.entries : [];
              const previewLimit = item.size === "small" ? 2 : item.size === "medium" ? 3 : 4;
              return <button type="button" key={paper.id} className={`day-space-paper day-space-paper-${paper.type} day-space-paper-${item.size}`} style={style} onClick={(event) => { paperTriggerRef.current = event.currentTarget; setOpenPaperId(paper.id); }}>
                {paper.type === "todo" ? <div className="day-space-todo-preview">{todoEntries.slice(0, previewLimit).map((entry) => <div key={entry.id} className={`day-space-todo-line day-space-todo-${entry.kind}`}><span className="day-space-todo-dot" aria-hidden="true" /><span>{entry.text}</span></div>)}{todoEntries.length > previewLimit ? <div className="day-space-preview-ellipsis" aria-hidden="true">...</div> : null}</div> : <div className="day-space-diary-preview"><strong>{paper.diary.title}</strong><p>{paper.diary.content}</p></div>}
                <span className="day-space-paper-signature">{paper.type === "todo" ? paper.paper.author : paper.diary.author ?? "—"}</span>
              </button>;
            })}
          </section>
        )}
      </div>
      {openPaper?.type === "todo" && selectedDate ? <TodoPaperDialog api={api.webClient} author={openPaper.paper.author} date={businessDateToLocalDate(selectedDate) ?? new Date()} open paper={openPaper.paper} triggerRef={paperTriggerRef} onSaved={(paper) => { setTodoState((current) => ({ status: "ready", value: { date: selectedDate, papers: { ...(current.value?.papers ?? { L: null, G: null, C: null }), [paper.author]: paper.entries.length > 0 ? paper : null } } })); void refreshTodo(selectedDate, paper); }} onClosed={() => setOpenPaperId(null)} /> : null}
      {openPaper?.type === "diary" ? <DaySpaceDiaryDialog diary={openPaper.diary} api={api} open triggerRef={paperTriggerRef} onSaved={(next) => { setDiaryState((current) => ({ status: "ready", value: current.value ? current.value.map((entry) => entry.id === next.id ? next : entry) : [next] })); void refreshDiary(next.date, next); }} onClosed={() => setOpenPaperId(null)} /> : null}
    </main>
  );
}

