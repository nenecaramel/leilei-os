import React, { useEffect, useMemo, useRef, useState } from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import { PageHeader } from "./PageHeader";
import {
  createGlobalSearchLocation,
  DEFAULT_GLOBAL_SEARCH_FILTERS,
  getSafeGlobalSearchReturnTo,
  readGlobalSearchFilters,
  SEARCH_MODULES,
  type GlobalSearchFilters,
  type SearchModule,
} from "./global-search-location";

type Result = {
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
type SearchResponse = { success: true; data: { results: Result[]; metadata: { count: number; has_more: boolean; next_cursor: string | null; searched_modules: SearchModule[]; searched_scope: string } } };
type SearchState = "idle" | "loading" | "ready" | "empty" | "error";
type Props = { api: WebApiClient };

const moduleLabels: Record<SearchModule, string> = { memory: "Memory", diary: "Diary", task: "Task" };
const fieldLabels: Record<string, string> = { key: "键名", title: "标题", content: "正文", description: "描述", tags: "标签", mood: "心情" };
const reasonLabels: Record<string, string> = { exact_stable_name: "精确名称命中", exact_phrase: "精确短语命中", stable_name_prefix: "名称前缀命中", field_match: "字段命中" };

export function GlobalSearchPageContent({ api }: Props) {
  const [filters, setFilters] = useState<GlobalSearchFilters>(() => readGlobalSearchFilters(window.location.search));
  const [queryInput, setQueryInput] = useState(filters.q);
  const [state, setState] = useState<SearchState>(filters.q ? "loading" : "idle");
  const [results, setResults] = useState<Result[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const searchUrl = createGlobalSearchLocation(filters);

  const requestSearch = (nextFilters: GlobalSearchFilters, append = false, nextCursor: string | null = null) => {
    const ticket = ++sequence.current;
    abortRef.current?.abort();
    if (!nextFilters.q) { setResults([]); setCursor(null); setState("idle"); return; }
    const controller = new AbortController(); abortRef.current = controller;
    setState("loading"); setError(false);
    const params = new URLSearchParams({ query: nextFilters.q });
    if (nextFilters.modules.length < SEARCH_MODULES.length) params.set("modules", nextFilters.modules.join(","));
    if (nextFilters.scope !== "active") params.set("scope", nextFilters.scope);
    if (nextFilters.mode !== "normal") params.set("mode", nextFilters.mode);
    if (nextFilters.dateFrom) params.set("date_from", nextFilters.dateFrom);
    if (nextFilters.dateTo) params.set("date_to", nextFilters.dateTo);
    if (nextCursor) params.set("cursor", nextCursor);
    api.request<SearchResponse>(`/search?${params.toString()}`, { signal: controller.signal }).then((response) => {
      if (ticket !== sequence.current) return;
      setResults((current) => {
        const next = append ? [...current, ...response.data.results] : response.data.results;
        return [...new Map(next.map((item) => [`${item.entity_type}:${item.entity_id}`, item])).values()];
      });
      setCursor(response.data.metadata.next_cursor);
      setState(response.data.results.length || append ? "ready" : "empty");
      const existing = Array.isArray(window.history.state?.globalSearch?.results) ? window.history.state.globalSearch.results as Result[] : [];
      const stored = append ? [...existing, ...response.data.results] : response.data.results;
      window.history.replaceState({ ...(window.history.state ?? {}), globalSearch: { results: [...new Map(stored.map((item) => [`${item.entity_type}:${item.entity_id}`, item])).values()], cursor: response.data.metadata.next_cursor } }, "", window.location.href);
    }).catch(() => {
      if (ticket === sequence.current && !controller.signal.aborted) { setState("error"); setError(true); }
    });
  };

  useEffect(() => {
    const onPopState = () => {
      const next = readGlobalSearchFilters(window.location.search);
      setFilters(next); setQueryInput(next.q); requestSearch(next);
    };
    window.addEventListener("popstate", onPopState);
    const snapshot = window.history.state?.globalSearch;
    if (filters.q && snapshot && Array.isArray(snapshot.results)) {
      setResults(snapshot.results as Result[]); setCursor(typeof snapshot.cursor === "string" ? snapshot.cursor : null); setState(snapshot.results.length ? "ready" : "empty");
    } else {
      requestSearch(filters);
    }
    return () => { sequence.current += 1; abortRef.current?.abort(); window.removeEventListener("popstate", onPopState); };
    // Initial URL is intentionally the source of truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = { ...filters, q: queryInput.normalize("NFC").trim() };
      if (createGlobalSearchLocation(next) === createGlobalSearchLocation(filters)) return;
      setFilters(next); window.history.pushState(null, "", createGlobalSearchLocation(next)); requestSearch(next);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  const updateFilter = (patch: Partial<GlobalSearchFilters>) => {
    const next = { ...filters, ...patch };
    setFilters(next); setQueryInput(next.q); setResults([]); setCursor(null);
    window.history.pushState(null, "", createGlobalSearchLocation(next)); requestSearch(next);
  };
  const toggleModule = (module: SearchModule) => updateFilter({ modules: filters.modules.includes(module) ? filters.modules.filter((item) => item !== module) : [...filters.modules, module] });
  const openDetail = (result: Result) => {
    const returnTo = searchUrl;
    const params = new URLSearchParams();
    if (result.lifecycle_status === "archived") params.set("view", "archived");
    params.set(result.lifecycle_status === "archived" ? (result.entity_type === "memory" ? "archivedMemory" : result.entity_type === "diary" ? "archivedDiary" : "task") : (result.entity_type === "memory" ? "memory" : result.entity_type), result.entity_id);
    if (result.entity_type === "task" && result.lifecycle_status === "archived") params.set("archived", "1");
    params.set("returnTo", returnTo);
    window.history.pushState({ ...(window.history.state ?? {}), globalSearch: { results, cursor } }, "", `/${result.entity_type}?${params.toString()}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const statusText = useMemo(() => state === "idle" ? "输入关键词后开始搜索。" : state === "loading" ? "正在搜索…" : state === "empty" ? "没有找到匹配记录。" : state === "error" ? "搜索暂时失败，请重试。" : `已找到 ${results.length} 条结果。`, [state, results.length]);
  return <div className="page">
    <PageHeader eyebrow="Global search" title="全局搜索" description="在 Memory、Diary 和 Task 中查找已保存的信息。搜索结果只显示有限片段，打开详情可读取完整记录。" />
    <section className="memory-message global-search-filters" aria-label="搜索与筛选">
      <label htmlFor="global-search-query">搜索关键词</label>
      <input id="global-search-query" value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="搜索已保存的信息" autoComplete="off" />
      <fieldset><legend>模块</legend>{SEARCH_MODULES.map((module) => <label key={module}><input type="checkbox" checked={filters.modules.includes(module)} onChange={() => toggleModule(module)} />{moduleLabels[module]}</label>)}</fieldset>
      <label htmlFor="global-search-scope">范围</label><select id="global-search-scope" value={filters.scope} onChange={(event) => updateFilter({ scope: event.target.value as GlobalSearchFilters["scope"] })}><option value="active">当前记录</option><option value="archived">已归档</option><option value="all">全部记录</option></select>
      <label htmlFor="global-search-mode">匹配方式</label><select id="global-search-mode" value={filters.mode} onChange={(event) => updateFilter({ mode: event.target.value as GlobalSearchFilters["mode"] })}><option value="normal">普通检索</option><option value="phrase">精确短语</option></select>
      <label htmlFor="global-search-date-from">开始日期</label><input id="global-search-date-from" type="date" value={filters.dateFrom} onChange={(event) => updateFilter({ dateFrom: event.target.value })} />
      <label htmlFor="global-search-date-to">结束日期</label><input id="global-search-date-to" type="date" value={filters.dateTo} onChange={(event) => updateFilter({ dateTo: event.target.value })} />
    </section>
    <p role="status" aria-live="polite">{statusText}</p>
    {error && <button className="secondary-button" type="button" onClick={() => requestSearch(filters)}>重试</button>}
    {state === "ready" && <section className="memory-grid" aria-label="搜索结果">{results.map((result) => <article className="memory-card" key={`${result.entity_type}:${result.entity_id}`}><div className="memory-card-topline"><span>{moduleLabels[result.entity_type]}</span>{result.lifecycle_status === "archived" && <span className="status-pill">历史记录</span>}</div><h2>{result.stable_name || "未命名记录"}</h2><p>{result.snippet}</p><div className="memory-tags"><span>{fieldLabels[result.matched_field] ?? result.matched_field}</span><span>{reasonLabels[result.match_reason] ?? result.match_reason}</span></div><small>{new Date(result.business_time).toLocaleString()} · 更新于 {new Date(result.updated_at).toLocaleString()}</small><button className="secondary-button" type="button" onClick={() => openDetail(result)}>查看详情</button></article>)}</section>}
    {state === "ready" && cursor && <button className="secondary-button" type="button" onClick={() => requestSearch(filters, true, cursor)}>加载更多</button>}
    {state === "idle" && <section className="memory-message"><h2>开始查找你的记录</h2><p>输入关键词后，搜索会在三个模块中实时查找。</p></section>}
    {state === "empty" && <section className="memory-message"><h2>没有找到匹配记录</h2><p>尝试更换关键词、范围或模块。</p></section>}
  </div>;
}

export { getSafeGlobalSearchReturnTo };
