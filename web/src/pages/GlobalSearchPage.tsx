import { decodeSearchSnapshot, keyOf, uniqueResults, groupGlobalSearchResults, type SearchSnapshot } from "./global-search-state";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import { NativeDateInput } from "../components/NativeDateInput";
import { ModuleStateMessage } from "../components/ModuleSearch";
import { navigateWithinApp } from "./app-navigation";
import { GlobalSearchPageHeader } from "./GlobalSearchPageHeader";
import {
  createGlobalSearchLocation,
  DEFAULT_GLOBAL_SEARCH_FILTERS,
  DEFAULT_SEARCH_MODULES,
  hasValidGlobalSearchDateRange,
  hasSearchableGlobalSearchQuery,
  isGlobalSearchQueryWithinLimit,
  normalizeGlobalSearchQuery,
  readGlobalSearchFilters,
  SEARCH_MODULES,
  toggleGlobalSearchModule,
  type GlobalSearchFilters,
  type SearchModule,
} from "./global-search-location";
import {
  createGlobalSearchResultDetailLocation,
  formatGlobalSearchBusinessDate,
  GLOBAL_SEARCH_MODULE_LABELS,
  globalSearchResultTitle,
  globalSearchResultSnippet,
  type GlobalSearchResult,
} from "./global-search-result";

type SearchResponse = {
  success: true;
  data: {
    results: GlobalSearchResult[];
    metadata: {
      count: number;
      has_more: boolean;
      next_cursor: string | null;
      searched_modules: SearchModule[];
      searched_scope: string;
    };
  };
};

type SearchState = "idle" | "loading" | "ready" | "empty" | "error";

type Props = {
  api: WebApiClient;
};

function readSnapshot(url: string): SearchSnapshot | null {
  return decodeSearchSnapshot(window.history.state?.globalSearch, url);
}

export function GlobalSearchPageContent({ api }: Props) {
  const [filters, setFilters] = useState<GlobalSearchFilters>(() => {
    const parsed = readGlobalSearchFilters(window.location.search);
    const query = normalizeGlobalSearchQuery(parsed.q);

    return isGlobalSearchQueryWithinLimit(query)
      ? { ...parsed, q: query }
      : { ...parsed, q: "" };
  });

  const [draftFilters, setDraftFilters] = useState<GlobalSearchFilters>(
    () => readGlobalSearchFilters(window.location.search),
  );
  const [queryInput, setQueryInput] = useState(
    () => readGlobalSearchFilters(window.location.search).q,
  );
  const [state, setState] = useState<SearchState>(() => {
    const query = normalizeGlobalSearchQuery(
      readGlobalSearchFilters(window.location.search).q,
    );
    return hasSearchableGlobalSearchQuery(query)
      ? "loading"
      : "idle";
  });
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [dateError, setDateError] = useState("");
  const [queryError, setQueryError] = useState("");
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const resultButtons = useRef(new Map<string, HTMLButtonElement>());

  const invalidateRequests = (): void => {
    sequence.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setLoadingMore(false);
    setLoadMoreError(false);
  };

  const persistSnapshot = (
    nextResults: GlobalSearchResult[],
    nextCursor: string | null,
    focusKey: string | null,
    scrollY = window.scrollY,
  ) => {
    const url = createGlobalSearchLocation(filters);

    window.history.replaceState(
      {
        ...(window.history.state ?? {}),
        globalSearch: {
          version: 1,
          url,
          results: nextResults,
          cursor: nextCursor,
          scrollY,
          focusKey,
        } satisfies SearchSnapshot,
      },
      "",
      url,
    );
  };

  const restoreSnapshot = (snapshot: SearchSnapshot): void => {
    setResults(snapshot.results);
    setCursor(snapshot.cursor);
    setLoadingMore(false);
    setLoadMoreError(false);
    setState(snapshot.results.length ? "ready" : "empty");

    requestAnimationFrame(() => {
      window.scrollTo({
        top: Math.max(0, snapshot.scrollY),
      });

      const button = snapshot.focusKey
        ? resultButtons.current.get(snapshot.focusKey)
        : null;

      (button ?? searchInput.current)?.focus();
    });
  };

  const requestSearch = (
    nextFilters: GlobalSearchFilters,
    append = false,
    nextCursor: string | null = null,
  ): void => {
    const ticket = ++sequence.current;
    abortRef.current?.abort();
    abortRef.current = null;

    if (!isGlobalSearchQueryWithinLimit(nextFilters.q)) {
      setQueryError("搜索关键词不能超过 200 个字符。");
      return;
    }

    if (!nextFilters.q) {
      setQueryError("");
      setResults([]);
      setCursor(null);
      setState("idle");
      setLoadMoreError(false);
      setLoadingMore(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    if (append) {
      setLoadingMore(true);
      setLoadMoreError(false);
    } else {
      setState("loading");
      setLoadMoreError(false);
    }

    const params = new URLSearchParams({
      query: nextFilters.q,
    });

    const defaultModulesSelected =
      nextFilters.modules.length === DEFAULT_SEARCH_MODULES.length
      && DEFAULT_SEARCH_MODULES.every((module) => nextFilters.modules.includes(module));
    if (!defaultModulesSelected) {
      params.set("modules", nextFilters.modules.join(","));
    }

    if (nextFilters.scope !== "active") {
      params.set("scope", nextFilters.scope);
    }

    if (nextFilters.mode !== "normal") {
      params.set("mode", nextFilters.mode);
    }

    if (nextFilters.dateFrom) {
      params.set("date_from", nextFilters.dateFrom);
    }

    if (nextFilters.dateTo) {
      params.set("date_to", nextFilters.dateTo);
    }

    if (nextCursor) {
      params.set("cursor", nextCursor);
    }

    api
      .request<SearchResponse>(
        `/search?${params.toString()}`,
        { signal: controller.signal },
      )
      .then((response) => {
        if (ticket !== sequence.current) return;

        const current = append ? results : [];
        const nextResults = uniqueResults([
          ...current,
          ...response.data.results,
        ]);

        setResults(nextResults);
        setCursor(response.data.metadata.next_cursor);
        setLoadingMore(false);
        setState(nextResults.length ? "ready" : "empty");

        const url = createGlobalSearchLocation(nextFilters);

        window.history.replaceState(
          {
            ...(window.history.state ?? {}),
            globalSearch: {
              version: 1,
              url,
              results: nextResults,
              cursor: response.data.metadata.next_cursor,
              scrollY: window.scrollY,
              focusKey: null,
            } satisfies SearchSnapshot,
          },
          "",
          url,
        );
      })
      .catch(() => {
        if (
          ticket !== sequence.current ||
          controller.signal.aborted
        ) {
          return;
        }

        if (append) {
          setLoadingMore(false);
          setLoadMoreError(true);
        } else {
          setState("error");
        }
      });
  };

  useEffect(() => {
    const restoreOrRequest = () => {
      invalidateRequests();

      const parsed = readGlobalSearchFilters(window.location.search);
      const query = normalizeGlobalSearchQuery(parsed.q);
      const queryWithinLimit =
        isGlobalSearchQueryWithinLimit(query);

      const next = queryWithinLimit
        ? { ...parsed, q: query }
        : { ...parsed, q: "" };

      setFilters(next);
      setDraftFilters(parsed);
      setQueryInput(parsed.q);
      setDateError("");
      setQueryError(
        queryWithinLimit
          ? ""
          : "搜索关键词不能超过 200 个字符。",
      );

      if (!queryWithinLimit) {
        setResults([]);
        setCursor(null);
        setState("idle");
        setLoadingMore(false);
        setLoadMoreError(false);
        return;
      }

      const snapshot = next.q
        ? readSnapshot(createGlobalSearchLocation(next))
        : null;

      if (next.q && snapshot) {
        restoreSnapshot(snapshot);
      } else {
        requestSearch(next);
      }
    };

    window.addEventListener("popstate", restoreOrRequest);
    restoreOrRequest();

    return () => {
      sequence.current += 1;
      abortRef.current?.abort();
      window.removeEventListener("popstate", restoreOrRequest);
    };
    // Initial URL and history state are authoritative.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const query = normalizeGlobalSearchQuery(queryInput);
      const nextDraft = {
        ...draftFilters,
        q: query,
      };

      if (draftFilters.q !== query) {
        setDraftFilters(nextDraft);
      }

      if (!isGlobalSearchQueryWithinLimit(query)) {
        setQueryError("搜索关键词不能超过 200 个字符。");
        return;
      }

      if (dateError) return;

      setQueryError("");

      const nextLocation = createGlobalSearchLocation(nextDraft);
      const currentLocation =
        `${window.location.pathname}${window.location.search}`;

      if (
        nextLocation === createGlobalSearchLocation(filters) &&
        currentLocation === nextLocation
      ) {
        return;
      }

      setFilters(nextDraft);
      setResults([]);
      setCursor(null);
      setLoadMoreError(false);

      window.history.pushState(
        null,
        "",
        nextLocation,
      );
      requestSearch(nextDraft);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [queryInput, draftFilters, dateError]);

  const updateFilter = (
    patch: Partial<GlobalSearchFilters>,
  ): void => {
    const nextDraft = {
      ...draftFilters,
      ...patch,
      q: normalizeGlobalSearchQuery(
        patch.q ?? draftFilters.q,
      ),
    };

    setDraftFilters(nextDraft);
    setQueryInput(nextDraft.q);

    if (!hasValidGlobalSearchDateRange(nextDraft)) {
      setDateError("开始日期不能晚于结束日期。");
      return;
    }

    setDateError("");

    if (!isGlobalSearchQueryWithinLimit(nextDraft.q)) {
      setQueryError("搜索关键词不能超过 200 个字符。");
      return;
    }

    setQueryError("");

    if (
      createGlobalSearchLocation(nextDraft) ===
      createGlobalSearchLocation(filters)
    ) {
      return;
    }

    setFilters(nextDraft);
    setResults([]);
    setCursor(null);
    setLoadMoreError(false);

    window.history.pushState(
      null,
      "",
      createGlobalSearchLocation(nextDraft),
    );

    requestSearch(nextDraft);
  };

  const toggleModule = (module: SearchModule): void => {
    const next = toggleGlobalSearchModule(
      draftFilters,
      module,
    );

    if (next === draftFilters) return;

    updateFilter({
      modules: next.modules,
    });
  };

  const openDetail = (result: GlobalSearchResult): void => {
    const focusKey = keyOf(result);

    persistSnapshot(
      results,
      cursor,
      focusKey,
    );

    const returnTo = createGlobalSearchLocation(filters);
    const target =
      createGlobalSearchResultDetailLocation(
        result,
        returnTo,
      );

    navigateWithinApp(
      target,
      result.entity_type === "mind"
        ? { ...window.history.state, globalSearchReturnTo: returnTo }
        : window.history.state,
    );
  };

  const groupedResults = useMemo(
    () =>
      groupGlobalSearchResults(results),
    [results],
  );

  const subtitle =
    state === "ready" || state === "empty"
      ? `${results.length}条结果`
      : draftFilters.modules.map((module) => GLOBAL_SEARCH_MODULE_LABELS[module]).join(" · ");

  const statusText = useMemo(
    () =>
      state === "idle"
        ? "输入关键词后开始搜索。"
        : state === "loading"
          ? "Searching..."
          : state === "empty"
            ? "没有找到匹配记录。"
            : state === "error"
              ? "搜索暂时失败，请重试。"
              : `已找到 ${results.length} 条结果。`,
    [state, results.length],
  );

  return (
    <div className="page global-search-page">
      <GlobalSearchPageHeader
        subtitle={subtitle}
        queryInput={queryInput}
        draftFilters={draftFilters}
        dateError={dateError}
        queryError={queryError}
        busy={loadingMore}
        searchInputRef={searchInput}
        onQueryInputChange={(value) => {
          setQueryInput(value);
          setDraftFilters((current) => ({
            ...current,
            q: value,
          }));
        }}
        onModulesChange={(modules) =>
          updateFilter({ modules })
        }
        onScopeChange={(scope) =>
          updateFilter({ scope })
        }
        onDateRangeChange={(dateFrom, dateTo) =>
          updateFilter({
            dateFrom,
            dateTo,
          })
        }
        onClearDateRange={() =>
          updateFilter({
            dateFrom: "",
            dateTo: "",
          })
        }
      />

      <div
        className="global-search-legacy-controls"
        hidden
        aria-hidden="true"
      >
        {SEARCH_MODULES.map((module) => (
          <input
            key={module}
            type="checkbox"
            checked={draftFilters.modules.includes(module)}
            onChange={() => toggleModule(module)}
          />
        ))}

        <select
          id="global-search-scope"
          value={draftFilters.scope}
          onChange={(event) =>
            updateFilter({
              scope: event.target.value as GlobalSearchFilters["scope"],
            })
          }
        >
          <option value="active">active</option>
          <option value="archived">archived</option>
          <option value="all">all</option>
        </select>

        <select
          id="global-search-mode"
          value={draftFilters.mode}
          onChange={(event) =>
            updateFilter({
              mode: event.target.value as GlobalSearchFilters["mode"],
            })
          }
        >
          <option value="normal">normal</option>
          <option value="phrase">phrase</option>
        </select>

        <NativeDateInput
          id="global-search-date-from"
          type="date"
          value={draftFilters.dateFrom}
          onChange={(event) =>
            updateFilter({
              dateFrom: event.target.value,
            })
          }
        />

        <NativeDateInput
          id="global-search-date-to"
          type="date"
          value={draftFilters.dateTo}
          onChange={(event) =>
            updateFilter({
              dateTo: event.target.value,
            })
          }
        />
      </div>

      <p
        className="sr-only"
        role="status"
        aria-live="polite"
      >
        {statusText}
      </p>

      {state === "idle" ? (
        <p className="global-search-state-line" role="status" aria-live="polite">
          默认搜索 Diary、Todo、Universe 与 Mind
        </p>
      ) : null}

      {state === "loading" ? (
        <ModuleStateMessage
          state="loading"
          placement="module"
          emptyText=""
          errorText=""
          loadingText="Searching..."
        />
      ) : null}

      {state === "empty" ? (
        <ModuleStateMessage
          state="empty"
          placement="module"
          emptyText="没有找到匹配内容"
          errorText=""
          action={
            <button
              type="button"
              className="secondary-button memory-empty-clear"
              onClick={() =>
                updateFilter({
                  ...DEFAULT_GLOBAL_SEARCH_FILTERS,
                })
              }
            >
              清除条件
            </button>
          }
        />
      ) : null}

      {state === "error" ? (
        <ModuleStateMessage
          state="error"
          placement="module"
          emptyText=""
          errorText="Unable to read search results."
          retryLabel="Retry"
          onRetry={() => requestSearch(filters)}
        />
      ) : null}

      {state === "ready" ? (
        <div
          className="global-search-groups"
          aria-label="搜索结果"
        >
          {groupedResults.map(
            ({ module, items }) => (
              <section
                key={module}
                className="global-search-result-section"
                aria-label={
                  GLOBAL_SEARCH_MODULE_LABELS[module]
                }
              >
                <h2 className="global-search-group-label">
                  {GLOBAL_SEARCH_MODULE_LABELS[module]}
                </h2>

                <div className="global-search-result-group">
                  {items.map((result) => (
                    <button
                      key={keyOf(result)}
                      ref={(button) => {
                        const key = keyOf(result);

                        if (button) {
                          resultButtons.current.set(
                            key,
                            button,
                          );
                        } else {
                          resultButtons.current.delete(
                            key,
                          );
                        }
                      }}
                      className="global-search-result-button"
                      type="button"
                      onClick={() => openDetail(result)}
                    >
                      <span className="global-search-result-title-line">
                        <span className="global-search-result-title">
                          {globalSearchResultTitle(result)}
                        </span>

                        {result.lifecycle_status === "archived" ? (
                          <span className="global-search-archived">
                            Archived
                          </span>
                        ) : null}
                      </span>

                      <span className="global-search-result-meta-line">
                        <span className="global-search-result-snippet">
                          {globalSearchResultSnippet(result)}
                        </span>

                        <span className="global-search-result-date">
                          {formatGlobalSearchBusinessDate(
                            result.business_time,
                            result.time_basis,
                          )}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ),
          )}
        </div>
      ) : null}

      {state === "ready" && cursor ? (
        <div className="global-search-load-more">
          <button
            className="global-search-load-more-button"
            type="button"
            disabled={loadingMore}
            onClick={() =>
              requestSearch(
                filters,
                true,
                cursor,
              )
            }
          >
            {loadingMore
              ? "正在加载更多…"
              : "加载更多"}
          </button>

          {loadMoreError ? (
            <p role="alert">
              加载更多失败，请重试。
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
