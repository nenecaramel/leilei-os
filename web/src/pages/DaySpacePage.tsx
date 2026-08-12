import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { WebApiClient } from "../api/useWebApiClient";
import { layoutDaySpacePapers } from "./day-space-layout.js";
import {
  buildDaySpaceLocation,
  businessDateToLocalDate,
  formatDaySpaceNavigationDate,
  formatLocalBusinessDate,
  parseExplicitDaySpaceDate,
  shiftBusinessDate,
} from "./day-space-location.js";
import { DaySpaceDatePicker } from "./DaySpaceDatePicker.js";
import { DaySpaceDiaryDialog } from "./DaySpaceDiaryDialog.js";
import { TodoPaperDialog } from "./TodoPaperDialog.js";
import { composeDaySpacePapers, resolveDaySpaceDefaultDate, type DaySpaceModuleState } from "./day-space-data.js";
import type { DaySpaceApi, DaySpaceDiary } from "./day-space-api.js";
import type { TodoDay, TodoPaper } from "./todo-types.js";

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
  const [selectedDate, setSelectedDate] = useState<string | null>(explicitDate);
  const [discoveryStatus, setDiscoveryStatus] = useState<"idle" | "loading" | "error" | "ready">(explicitDate ? "ready" : "idle");
  const [discoveryIncomplete, setDiscoveryIncomplete] = useState(false);
  const [discoveryRetry, setDiscoveryRetry] = useState(0);
  const [todoState, setTodoState] = useState<DaySpaceModuleState<TodoDay>>({ status: "loading" });
  const [diaryState, setDiaryState] = useState<DaySpaceModuleState<DaySpaceDiary[]>>({ status: "loading" });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openPaperId, setOpenPaperId] = useState<string | null>(null);
  const [stageWidth, setStageWidth] = useState(345);
  const stageMeasureRef = useRef<HTMLDivElement | null>(null);
  const paperTriggerRef = useRef<HTMLButtonElement | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const loadDate = useCallback((date: string) => {
    const current = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setSelectedDate(date);
    setOpenPaperId(null);
    setTodoState({ status: "loading" });
    setDiaryState({ status: "loading" });
    void api.loadTodoDay(date).then((value) => {
      if (abort.signal.aborted || generation.current !== current) return;
      setTodoState({ status: "ready", value });
    }).catch(() => {
      if (abort.signal.aborted || generation.current !== current) return;
      setTodoState({ status: "error" });
    });
    void api.loadDiariesByDate(date).then((value) => {
      if (abort.signal.aborted || generation.current !== current) return;
      setDiaryState({ status: "ready", value: value.diaries });
    }).catch(() => {
      if (abort.signal.aborted || generation.current !== current) return;
      setDiaryState({ status: "error" });
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
    setSelectedDate(null);
    setTodoState({ status: "loading" });
    setDiaryState({ status: "loading" });
    void Promise.allSettled([api.listTodoDates(), api.listDiaryDates()]).then((results) => {
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
    return () => { cancelled = true; };
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
    if (!selectedDate || todoState.status === "loading" || diaryState.status === "loading") return [];
    if (todoState.status !== "ready" || diaryState.status !== "ready") {
      return [
        ...(todoState.status === "ready" ? composeDaySpacePapers(selectedDate, todoState.value, []).filter((p) => p.type === "todo") : []),
        ...(diaryState.status === "ready" ? diaryState.value.map((diary) => ({ type: "diary" as const, id: `diary:${diary.id}`, diary })) : []),
      ];
    }
    return composeDaySpacePapers(selectedDate, todoState.value, diaryState.value) as DaySpacePaper[];
  }, [selectedDate, todoState, diaryState]);

  const layout = useMemo(() => selectedDate ? layoutDaySpacePapers(selectedDate, papers.map((paper) => ({ id: paper.id, density: densityForPaper(paper) })), stageWidth) : null, [papers, selectedDate, stageWidth]);
  const layoutById = useMemo(() => new Map((layout?.items ?? []).map((item) => [item.id, item])), [layout]);
  const openPaper = papers.find((paper) => paper.id === openPaperId) ?? null;

  const refreshDiary = useCallback(async (date: string, committed: DaySpaceDiary) => {
    try {
      const result = await api.loadDiariesByDate(date);
      if (selectedDate !== date) return;
      setDiaryState({ status: "ready", value: result.diaries });
    } catch {
      if (selectedDate !== date) return;
      setDiaryState((current) => ({
        status: "error",
        value: current.status === "ready" ? current.value.map((entry) => entry.id === committed.id ? committed : entry) : [committed],
        needsRetry: true,
      }));
    }
  }, [api, selectedDate]);

  const refreshTodo = useCallback(async (date: string, committed: TodoPaper) => {
    try {
      const result = await api.loadTodoDay(date);
      if (selectedDate !== date) return;
      setTodoState({ status: "ready", value: result });
    } catch {
      if (selectedDate !== date) return;
      setTodoState((current) => ({
        status: "error",
        value: current.status === "ready"
          ? { ...current.value, papers: { ...current.value.papers, [committed.author]: committed } }
          : { date, papers: { L: committed.author === "L" ? committed : null, G: committed.author === "G" ? committed : null } },
        needsRetry: true,
      }));
    }
  }, [api, selectedDate]);

  const go = (date: string) => {
    setPickerOpen(false);
    navigate(buildDaySpaceLocation(date));
  };

  const moduleWarning = todoState.status === "error" || diaryState.status === "error";
  const bothModulesFailed = todoState.status === "error" && diaryState.status === "error";
  const completeEmpty = todoState.status === "ready" && diaryState.status === "ready" && papers.length === 0;

  return (
    <main className="day-space-page">
      <header className="day-space-header"><div className="memory-page-heading"><div className="memory-page-title">Day Space</div></div></header>
      <div className="day-space-date-area">
        <div className="day-space-date-nav" aria-label="Day Space 日期导航">
          <button type="button" aria-label="前一天" disabled={!selectedDate} onClick={() => selectedDate && go(shiftBusinessDate(selectedDate, -1))}>‹</button>
          <button type="button" className="day-space-date-button" aria-expanded={pickerOpen} disabled={!selectedDate} onClick={() => setPickerOpen((value) => !value)}>{selectedDate ? formatDaySpaceNavigationDate(selectedDate) : "正在读取"}</button>
          <button type="button" aria-label="后一天" disabled={!selectedDate} onClick={() => selectedDate && go(shiftBusinessDate(selectedDate, 1))}>›</button>
        </div>
        {pickerOpen && selectedDate ? <DaySpaceDatePicker selectedDate={selectedDate} todayDate={today} onSelect={go} onClose={() => setPickerOpen(false)} /> : null}
      </div>
      {discoveryStatus === "loading" && !selectedDate ? <div className="day-space-loading" role="status">正在读取 Day Space…</div> : null}
      {discoveryStatus === "error" ? <div className="day-space-error" role="alert"><p>Day Space 暂时无法读取。</p><button type="button" onClick={() => setDiscoveryRetry((value) => value + 1)}>重试</button></div> : null}
      {discoveryIncomplete && selectedDate ? <div className="day-space-warning" role="status">最新日期发现不完整，当前日期仍可查看。</div> : null}
      {selectedDate && bothModulesFailed ? <div className="day-space-error" role="alert"><p>当天内容暂时无法读取。</p><button type="button" onClick={() => loadDate(selectedDate)}>重试</button></div> : null}
      {selectedDate && moduleWarning && !bothModulesFailed ? <div className="day-space-warning" role="alert">部分 Day Space 内容暂时无法读取。<button type="button" onClick={() => loadDate(selectedDate)}>重试</button></div> : null}
      <div ref={stageMeasureRef} className="day-space-stage-measure">
        {completeEmpty ? <div className="day-space-empty">这一天还没有内容</div> : bothModulesFailed ? null : papers.length === 0 ? <div className="day-space-loading" role="status">正在读取当天内容…</div> : (
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
      {openPaper?.type === "todo" && selectedDate ? <TodoPaperDialog api={api.webClient} author={openPaper.paper.author} date={businessDateToLocalDate(selectedDate) ?? new Date()} open paper={openPaper.paper} triggerRef={paperTriggerRef} onSaved={(paper) => { setTodoState((current) => ({ status: "ready", value: { date: selectedDate, papers: { ...(current.status === "ready" ? current.value.papers : { L: null, G: null }), [paper.author]: paper } } })); void refreshTodo(selectedDate, paper); }} onClosed={() => setOpenPaperId(null)} /> : null}
      {openPaper?.type === "diary" ? <DaySpaceDiaryDialog diary={openPaper.diary} api={api} open triggerRef={paperTriggerRef} onSaved={(next) => { setDiaryState((current) => ({ status: "ready", value: current.status === "ready" ? current.value.map((entry) => entry.id === next.id ? next : entry) : [next] })); void refreshDiary(next.date, next); }} onClosed={() => setOpenPaperId(null)} /> : null}
    </main>
  );
}

export { DaySpacePageContent as DaySpacePage };
