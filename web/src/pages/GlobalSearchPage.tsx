import React, { useEffect, useMemo, useRef, useState } from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import { PageHeader } from "./PageHeader";
import { navigateWithinApp } from "./app-navigation";
import {
  createArchivedDiaryDetailLocation,
  createDiaryDetailLocation,
} from "./diary-location";
import {
  createArchivedMemoryDetailLocation,
  createMemoryDetailLocation,
} from "./memory-location";
import {
  createArchivedTaskDetailLocation,
  createTaskDetailLocation,
} from "./task-location";
import {
  createGlobalSearchLocation,
  hasValidGlobalSearchDateRange,
  readGlobalSearchFilters,
  SEARCH_MODULES,
  toggleGlobalSearchModule,
  type GlobalSearchFilters,
  type SearchModule,
} from "./global-search-location";

export type GlobalSearchResult = {
  entity_type: SearchModule;
  entity_id: string;
  stable_name: string;
  snippet: string;
  matched_field: string;
  match_reason: string;
  lifecycle_status: "active" | "archived";
  business_time: string;
  time_basis: string;
  updated_at: string;
  detail_tool: "get_memory" | "get_diary" | "get_task";
  detail_arguments: { id: string; scope: "active" | "archived" };
};
type SearchResponse = { success: true; data: { results: GlobalSearchResult[]; metadata: { count: number; has_more: boolean; next_cursor: string | null; searched_modules: SearchModule[]; searched_scope: string } } };
type SearchState = "idle" | "loading" | "ready" | "empty" | "error";
type SearchSnapshot = {
  version: 1;
  url: string;
  results: GlobalSearchResult[];
  cursor: string | null;
  scrollY: number;
  focusKey: string | null;
};
type Props = { api: WebApiClient };

const moduleLabels: Record<SearchModule, string> = { memory: "Memory", diary: "Diary", task: "Task" };
const fieldLabels: Record<string, string> = { key: "键名", title: "标题", content: "正文", description: "描述", tags: "标签", mood: "心情" };
const reasonLabels: Record<string, string> = { exact_stable_name: "精确名称命中", exact_phrase: "精确短语命中", stable_name_prefix: "名称前缀命中", field_match: "字段命中" };

function keyOf(result: GlobalSearchResult): string {
  return `${result.entity_type}:${result.entity_id}`;
}

function uniqueResults(results: GlobalSearchResult[]): GlobalSearchResult[] {
  return [...new Map(results.map((result) => [keyOf(result), result])).values()];
}

function readSnapshot(url: string): SearchSnapshot | null {
  const candidate = window.history.state?.globalSearch as Partial<SearchSnapshot> | undefined;
  if (!candidate || candidate.version !== 1 || candidate.url !== url || !Array.isArray(candidate.results)) return null;
  if (candidate.cursor !== null && typeof candidate.cursor !== "string") return null;
  if (!Number.isFinite(candidate.scrollY) || typeof candidate.focusKey !== "string" && candidate.focusKey !== null) return null;
  return candidate as SearchSnapshot;
}

export function GlobalSearchPageContent({ api }: Props) {
  const [filters, setFilters] = useState<GlobalSearchFilters>(() => readGlobalSearchFilters(window.location.search));
  const [queryInput, setQueryInput] = useState(filters.q);
  const [state, setState] = useState<SearchState>(filters.q ? "loading" : "idle");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [dateError, setDateError] = useState("");
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const resultButtons = useRef(new Map<string, HTMLButtonElement>());

  const persistSnapshot = (nextResults: GlobalSearchResult[], nextCursor: string | null, focusKey: string | null, scrollY = window.scrollY) => {
    const url = createGlobalSearchLocation(filters);
    window.history.replaceState({ ...(window.history.state ?? {}), globalSearch: { version: 1, url, results: nextResults, cursor: nextCursor, scrollY, focusKey } satisfies SearchSnapshot }, "", url);
  };

  const restoreSnapshot = (snapshot: SearchSnapshot): void => {
    setResults(snapshot.results); setCursor(snapshot.cursor); setState(snapshot.results.length ? "ready" : "empty");
    requestAnimationFrame(() => {
      window.scrollTo({ top: Math.max(0, snapshot.scrollY) });
      const button = snapshot.focusKey ? resultButtons.current.get(snapshot.focusKey) : null;
      (button ?? searchInput.current)?.focus();
    });
  };

  const requestSearch = (nextFilters: GlobalSearchFilters, append = false, nextCursor: string | null = null): void => {
    const ticket = ++sequence.current;
    abortRef.current?.abort();
    if (!nextFilters.q) {
      setResults([]); setCursor(null); setState("idle"); setLoadMoreError(false); setLoadingMore(false); return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    if (append) { setLoadingMore(true); setLoadMoreError(false); } else { setState("loading"); setLoadMoreError(false); }
    const params = new URLSearchParams({ query: nextFilters.q });
    if (nextFilters.modules.length < SEARCH_MODULES.length) params.set("modules", nextFilters.modules.join(","));
    if (nextFilters.scope !== "active") params.set("scope", nextFilters.scope);
    if (nextFilters.mode !== "normal") params.set("mode", nextFilters.mode);
    if (nextFilters.dateFrom) params.set("date_from", nextFilters.dateFrom);
    if (nextFilters.dateTo) params.set("date_to", nextFilters.dateTo);
    if (nextCursor) params.set("cursor", nextCursor);
    api.request<SearchResponse>(`/search?${params.toString()}`, { signal: controller.signal }).then((response) => {
      if (ticket !== sequence.current) return;
      const current = append ? results : [];
      const nextResults = uniqueResults([...current, ...response.data.results]);
      setResults(nextResults); setCursor(response.data.metadata.next_cursor); setLoadingMore(false);
      setState(nextResults.length ? "ready" : "empty");
      const url = createGlobalSearchLocation(nextFilters);
      window.history.replaceState({ ...(window.history.state ?? {}), globalSearch: { version: 1, url, results: nextResults, cursor: response.data.metadata.next_cursor, scrollY: window.scrollY, focusKey: null } satisfies SearchSnapshot }, "", url);
    }).catch(() => {
      if (ticket !== sequence.current || controller.signal.aborted) return;
      if (append) { setLoadingMore(false); setLoadMoreError(true); }
      else setState("error");
    });
  };

  useEffect(() => {
    const restoreOrRequest = () => {
      const next = readGlobalSearchFilters(window.location.search);
      setFilters(next); setQueryInput(next.q); setDateError("");
      const snapshot = readSnapshot(createGlobalSearchLocation(next));
      if (next.q && snapshot) restoreSnapshot(snapshot);
      else requestSearch(next);
    };
    window.addEventListener("popstate", restoreOrRequest);
    restoreOrRequest();
    return () => { sequence.current += 1; abortRef.current?.abort(); window.removeEventListener("popstate", restoreOrRequest); };
    // Initial URL and history state are authoritative.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = { ...filters, q: queryInput.normalize("NFC").trim() };
      if (createGlobalSearchLocation(next) === createGlobalSearchLocation(filters)) return;
      setFilters(next); setResults([]); setCursor(null); setLoadMoreError(false);
      window.history.pushState(null, "", createGlobalSearchLocation(next)); requestSearch(next);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  const updateFilter = (patch: Partial<GlobalSearchFilters>): void => {
    const next = { ...filters, ...patch };
    if (!hasValidGlobalSearchDateRange(next)) { setFilters(next); setDateError("开始日期不能晚于结束日期。"); return; }
    setDateError(""); setFilters(next); setQueryInput(next.q); setResults([]); setCursor(null); setLoadMoreError(false);
    window.history.pushState(null, "", createGlobalSearchLocation(next)); requestSearch(next);
  };
  const toggleModule = (module: SearchModule): void => {
    const next = toggleGlobalSearchModule(filters, module);
    if (next === filters) return;
    updateFilter({ modules: next.modules });
  };
  const openDetail = (result: GlobalSearchResult): void => {
    const focusKey = keyOf(result);
    persistSnapshot(results, cursor, focusKey);
    const returnTo = createGlobalSearchLocation(filters);
    const target = result.entity_type === "memory"
      ? result.lifecycle_status === "archived" ? createArchivedMemoryDetailLocation(result.entity_id, returnTo) : createMemoryDetailLocation(result.entity_id, returnTo)
      : result.entity_type === "diary"
        ? result.lifecycle_status === "archived" ? createArchivedDiaryDetailLocation(result.entity_id, returnTo) : createDiaryDetailLocation(result.entity_id, returnTo)
        : result.lifecycle_status === "archived" ? createArchivedTaskDetailLocation(result.entity_id, returnTo) : createTaskDetailLocation(result.entity_id, returnTo);
    navigateWithinApp(target, window.history.state);
  };

  const statusText = useMemo(() => state === "idle" ? "输入关键词后开始搜索。" : state === "loading" ? "正在搜索…" : state === "empty" ? "没有找到匹配记录。" : state === "error" ? "搜索暂时失败，请重试。" : `已找到 ${results.length} 条结果。`, [state, results.length]);
  return <div className="page">
    <PageHeader eyebrow="Global search" title="全局搜索" description="在 Memory、Diary 和 Task 中查找已保存的信息。搜索结果只显示有限片段，打开详情可读取完整记录。" />
    <section className="memory-message global-search-filters" aria-label="搜索与筛选">
      <label htmlFor="global-search-query">搜索关键词</label>
      <input ref={searchInput} id="global-search-query" value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="搜索已保存的信息" autoComplete="off" />
      <fieldset><legend>模块</legend>{SEARCH_MODULES.map((module) => <label key={module}><input type="checkbox" checked={filters.modules.includes(module)} onChange={() => toggleModule(module)} />{moduleLabels[module]}</label>)}</fieldset>
      <label htmlFor="global-search-scope">范围</label><select id="global-search-scope" value={filters.scope} onChange={(event) => updateFilter({ scope: event.target.value as GlobalSearchFilters["scope"] })}><option value="active">当前记录</option><option value="archived">已归档</option><option value="all">全部记录</option></select>
      <label htmlFor="global-search-mode">匹配方式</label><select id="global-search-mode" value={filters.mode} onChange={(event) => updateFilter({ mode: event.target.value as GlobalSearchFilters["mode"] })}><option value="normal">普通检索</option><option value="phrase">精确短语</option></select>
      <label htmlFor="global-search-date-from">开始日期</label><input id="global-search-date-from" type="date" value={filters.dateFrom} onChange={(event) => updateFilter({ dateFrom: event.target.value })} />
      <label htmlFor="global-search-date-to">结束日期</label><input id="global-search-date-to" type="date" value={filters.dateTo} onChange={(event) => updateFilter({ dateTo: event.target.value })} />
      {dateError && <p className="form-error" role="alert">{dateError}</p>}
    </section>
    <p role="status" aria-live="polite">{statusText}</p>
    {state === "error" && <button className="secondary-button" type="button" onClick={() => requestSearch(filters)}>重试</button>}
    {state === "ready" && <section className="memory-grid" aria-label="搜索结果">{results.map((result) => <article className="memory-card" key={keyOf(result)}><div className="memory-card-topline"><span>{moduleLabels[result.entity_type]}</span>{result.lifecycle_status === "archived" && <span className="status-pill">历史记录</span>}</div><h2>{result.stable_name || "未命名记录"}</h2><p>{result.snippet}</p><div className="memory-tags"><span>{fieldLabels[result.matched_field] ?? result.matched_field}</span><span>{reasonLabels[result.match_reason] ?? result.match_reason}</span></div><small>{new Date(result.business_time).toLocaleString()} · 更新于 {new Date(result.updated_at).toLocaleString()}</small><button ref={(button) => { const key = keyOf(result); if (button) resultButtons.current.set(key, button); else resultButtons.current.delete(key); }} className="secondary-button" type="button" onClick={() => openDetail(result)}>查看详情</button></article>)}</section>}
    {state === "ready" && cursor && <div><button className="secondary-button" type="button" disabled={loadingMore} onClick={() => requestSearch(filters, true, cursor)}>{loadingMore ? "正在加载更多…" : "加载更多"}</button>{loadMoreError && <p role="alert">加载更多失败，请重试。</p>}</div>}
    {state === "idle" && <section className="memory-message"><h2>开始查找你的记录</h2><p>输入关键词后，搜索会在三个模块中实时查找。</p></section>}
    {state === "empty" && <section className="memory-message"><h2>没有找到匹配记录</h2><p>尝试更换关键词、范围或模块。</p></section>}
  </div>;
}
