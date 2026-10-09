import { useCallback, useEffect, useRef, useState } from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import { ModuleStateMessage } from "../components/ModuleSearch";
import { ModulePageHeader } from "./ModulePageHeader";
import { ModuleMonthRows, type ModuleMonthGroup } from "./ModuleMonthRows";
import { ModuleListLoading, ModuleListEmpty } from "./ModuleListState";
import { MemoryDetail } from "./MemoryDetail";
import { MemoryCreatePaper } from "./MemoryCreatePaper";
import { PaperDetailDialog } from "./PaperDetailDialog";
import { formatDiaryRowDate } from "./diary-presentation";
import {
  getMemory,
  loadMemoryList,
  type MemoryItem,
  type MemorySummary,
} from "./memory-api";

import { getSafeGlobalSearchReturnTo } from "./global-search-location";
import { navigateWithinApp } from "./app-navigation";

type Filters = { query: string; dateFrom: string; dateTo: string; undated: boolean };
function readLocation() {
  const query = new URLSearchParams(window.location.search);
  return {
    filters: {
      query: query.get("q") ?? "",
      dateFrom: query.get("undated") === "true" ? "" : query.get("dateFrom") ?? "",
      dateTo: query.get("undated") === "true" ? "" : query.get("dateTo") ?? "",
      undated: query.get("undated") === "true",
    },
    id: query.get("memoryId"),
  };
}
function buildLocation(filters: Filters, id: string | null) {
  const query = new URLSearchParams();
  if (filters.query) query.set("q", filters.query);
  if (filters.undated) query.set("undated", "true");
  if (!filters.undated && filters.dateFrom) query.set("dateFrom", filters.dateFrom);
  if (!filters.undated && filters.dateTo) query.set("dateTo", filters.dateTo);
  if (id) query.set("memoryId", id);
  return `${window.location.pathname}${query.size ? `?${query}` : ""}`;
}
function monthGroups(rows: MemorySummary[]): ModuleMonthGroup[] {
  const groups = new Map<string, ModuleMonthGroup>();
  const ordered = [...rows].sort((a, b) => {
    if (a.occurredAt === null) return b.occurredAt === null ? 0 : 1;
    if (b.occurredAt === null) return -1;
    return Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
  });
  for (const row of ordered) {
    const key = row.date?.slice(0, 7) ?? "undated";
    if (!groups.has(key))
      groups.set(key, {
        key,
        label: row.date
          ? `${Number(key.slice(0, 4))}年${Number(key.slice(5))}月`
          : "",
        rows: [],
      });
    groups.get(key)!.rows.push({
      id: row.id,
      title: row.snippet,
      date: row.date ? formatDiaryRowDate(row.date) : "",
      attributes: { "data-memory-id": row.id },
    });
  }
  return [...groups.values()];
}

export function MindPageContent({ api }: { api: WebApiClient }) {
  const [location, setLocation] = useState(readLocation);
  const { filters, id } = location;
  const [searchDraft, setSearchDraft] = useState(filters.query);
  const [rows, setRows] = useState<MemorySummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [item, setItem] = useState<MemoryItem | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [detailRevision, setDetailRevision] = useState(0);
  const [revision, setRevision] = useState(0);
  const [readyRevision, setReadyRevision] = useState(-1);
  const [adding, setAdding] = useState(false);
  const navigationGuard = useRef<(() => boolean) | null>(null);
  const registerNavigationGuard = useCallback(
    (guard: (() => boolean) | null) => {
      navigationGuard.current = guard;
    },
    [],
  );
  const readyFilters = useRef<Filters | null>(null);
  const focusAfterRefresh = useRef<string | null>(null);
  const generation = useRef(0);
  const detailTrigger = useRef<HTMLElement | null>(null);
  const createTrigger = useRef<HTMLElement | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentLocation = useRef(location);
  currentLocation.current = location;
  const filterError =
    filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo
      ? "开始日期不能晚于结束日期"
      : "";
  const searchPending = searchDraft !== filters.query;
  const filtered = Boolean(filters.query || filters.dateFrom || filters.dateTo || filters.undated);
  function navigate(next: typeof location) {
    const url = buildLocation(next.filters, next.id);
    if (url !== `${window.location.pathname}${window.location.search}`)
      window.history.pushState(null, "", url);
    currentLocation.current = next;
    setLocation(next);
  }
  function commitFilters(next: Filters) {
    generation.current++;
    navigate({ filters: next, id: null });
  }
  useEffect(() => {
    function restore() {
      if (navigationGuard.current && !navigationGuard.current()) {
        const previous = currentLocation.current;
        window.history.pushState(
          null,
          "",
          buildLocation(previous.filters, previous.id),
        );
        return;
      }
      setAdding(false);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      generation.current++;
      const next = readLocation();
      const previous = currentLocation.current;
      if (
        next.filters.query === previous.filters.query &&
        next.filters.dateFrom === previous.filters.dateFrom &&
        next.filters.dateTo === previous.filters.dateTo &&
        next.filters.undated === previous.filters.undated
      )
        next.filters = previous.filters;
      if (previous.id && !next.id) focusAfterRefresh.current = previous.id;
      currentLocation.current = next;
      setSearchDraft(next.filters.query);
      setLocation(next);
    }
    window.addEventListener("popstate", restore);
    return () => {
      window.removeEventListener("popstate", restore);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      generation.current++;
    };
  }, []);
  useEffect(() => {
    const ticket = ++generation.current;
    const abort = new AbortController();
    setRows([]);
    if (filterError) {
      setStatus("ready");
      return () => abort.abort();
    }
    setStatus("loading");
    void loadMemoryList(api, filters, abort.signal)
      .then((items) => {
        if (ticket !== generation.current || abort.signal.aborted) return;
        setRows(items);
        readyFilters.current = filters;
        setReadyRevision(revision);
        setStatus("ready");
      })
      .catch(() => {
        if (ticket === generation.current && !abort.signal.aborted)
          setStatus("error");
      });
    return () => abort.abort();
  }, [api, filters, revision, filterError]);
  useEffect(() => {
    if (
      status !== "ready" ||
      readyRevision !== revision ||
      readyFilters.current !== filters ||
      id ||
      !focusAfterRefresh.current
    )
      return;
    const row = [
      ...document.querySelectorAll<HTMLElement>("[data-memory-id]"),
    ].find((node) => node.dataset.memoryId === focusAfterRefresh.current);
    (
      row ?? document.querySelector<HTMLElement>('[aria-label="新增记忆"]')
    )?.focus({ preventScroll: true });
    focusAfterRefresh.current = null;
  }, [status, rows, id, filters, readyRevision, revision]);
  useEffect(() => {
    const abort = new AbortController();
    setItem(null);
    setDetailError(false);
    if (id)
      void getMemory(api, id, abort.signal)
        .then((value) => {
          if (!abort.signal.aborted) setItem(value);
        })
        .catch(() => {
          if (!abort.signal.aborted) setDetailError(true);
        });
    return () => abort.abort();
  }, [api, id, detailRevision]);
  function closeDetail() {
    const returnTo = new URLSearchParams(window.location.search).get("returnTo");
    if (returnTo) {
      const url = getSafeGlobalSearchReturnTo(returnTo);
      // Back restores the original search snapshot (loaded pages, focus, scroll).
      if (window.history.state?.globalSearchReturnTo === url) window.history.back();
      else navigateWithinApp(url);
      return true;
    }
    navigate({ ...currentLocation.current, id: null });
    return true;
  }
  function clearFilters() {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearchDraft("");
    commitFilters({ query: "", dateFrom: "", dateTo: "", undated: false });
  }
  return (
    <div className="page memory-page mind-page">
      <ModulePageHeader
        title="Mind"
        countLabel={`${status === "ready" ? rows.length : 0}条记忆`}
        searchLabel="搜索记忆"
        searchPlaceholder="Search memories..."
        createLabel="新增记忆"
        undated={filters.undated}
        onUndatedChange={(undated) => {
          if (searchTimer.current) clearTimeout(searchTimer.current);
          commitFilters({ ...filters, query: searchDraft, undated, dateFrom: "", dateTo: "" });
        }}
        dateFrom={filters.dateFrom}
        dateTo={filters.dateTo}
        searchDraft={searchDraft}
        filterError={filterError}
        busy={Boolean(id) || adding}
        onDateFromChange={(dateFrom) => {
          if (searchTimer.current) clearTimeout(searchTimer.current);
          commitFilters({ ...filters, query: searchDraft, dateFrom, undated: false });
        }}
        onDateToChange={(dateTo) => {
          if (searchTimer.current) clearTimeout(searchTimer.current);
          commitFilters({ ...filters, query: searchDraft, dateTo, undated: false });
        }}
        onDateRangeClear={() => {
          if (searchTimer.current) clearTimeout(searchTimer.current);
          commitFilters({
            ...filters,
            query: searchDraft,
            dateFrom: "",
            dateTo: "",
            undated: false,
          });
        }}
        onSearchChange={(query) => {
          setSearchDraft(query);
          if (searchTimer.current) clearTimeout(searchTimer.current);
          searchTimer.current = setTimeout(
            () => commitFilters({ ...currentLocation.current.filters, query }),
            250,
          );
        }}
        onCreate={(trigger) => {
          if (searchTimer.current) clearTimeout(searchTimer.current);
          if (searchPending) commitFilters({ ...filters, query: searchDraft });
          createTrigger.current = trigger;
          setAdding(true);
        }}
      />
      {status === "loading" ? (
        <ModuleListLoading
          searching={Boolean(filters.query)}
          label="Mind 加载中"
          loadingText="正在读取记忆…"
        />
      ) : null}
      {status === "error" ? (
        <ModuleStateMessage
          state="error"
          placement="page"
          emptyText=""
          errorText="Unable to read memories."
          onRetry={() => setRevision((n) => n + 1)}
        />
      ) : null}
      {status === "ready" && !filterError ? (
        rows.length ? (
          <ModuleMonthRows
            groups={monthGroups(rows)}
            busy={Boolean(id) || adding || searchPending}
            label="Mind 列表"
            onOpen={(id, trigger) => {
              detailTrigger.current = trigger;
              navigate({ ...location, id });
            }}
          />
        ) : (
          <ModuleListEmpty
            searching={Boolean(filters.query)}
            filtered={filtered}
            noun="记忆"
            onClear={clearFilters}
          />
        )
      ) : null}
      {adding ? (
        <MemoryCreatePaper
          registerNavigationGuard={registerNavigationGuard}
          api={api}
          triggerRef={createTrigger}
          onClose={() => setAdding(false)}
          onCreated={(created) => {
            detailTrigger.current = createTrigger.current;
            navigate({ ...currentLocation.current, id: created.id });
            setItem(created);
            setRevision((n) => n + 1);
          }}
        />
      ) : null}
      {id && !item ? (
        <PaperDetailDialog
          id="memory-loading-paper"
          open
          label="Memory"
          dateLabel=""
          signature="Memory"
          triggerRef={detailTrigger}
          onRequestClose={closeDetail}
        >
          <ModuleStateMessage
            state={detailError ? "error" : "loading"}
            placement="paper"
            emptyText=""
            errorText="Unable to read memory."
            loadingText="Reading..."
            onRetry={() => setDetailRevision((n) => n + 1)}
          />
        </PaperDetailDialog>
      ) : null}
      {id && item ? (
        <MemoryDetail
          registerNavigationGuard={registerNavigationGuard}
          key={item.id}
          api={api}
          initial={item}
          triggerRef={detailTrigger}
          onClose={closeDetail}
          onSaved={(saved) => {
            focusAfterRefresh.current = saved.id;
            setRevision((n) => n + 1);
          }}
          onDelete={async () => {
            await api.request(`/mind/${encodeURIComponent(item.id)}`, {
              method: "DELETE",
            });
            focusAfterRefresh.current = item.id;
            closeDetail();
            setRevision((n) => n + 1);
          }}
        />
      ) : null}
    </div>
  );
}
