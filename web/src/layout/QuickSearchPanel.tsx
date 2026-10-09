import {
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import { SearchIcon } from "../components/icons";
import { StateSurface } from "../components/StateSurface";
import { navigateWithinApp } from "../pages/app-navigation";
import {
  createGlobalSearchLocation,
  DEFAULT_GLOBAL_SEARCH_FILTERS,
  isGlobalSearchQueryWithinLimit,
  normalizeGlobalSearchQuery,
  SEARCH_MODULES,
  type SearchModule,
} from "../pages/global-search-location";
import {
  createGlobalSearchResultDetailLocation,
  GLOBAL_SEARCH_MODULE_LABELS,
  globalSearchResultTitle,
  globalSearchResultSnippet,
  type GlobalSearchResult,
} from "../pages/global-search-result";

type QuickSearchPanelProps = {
  open: boolean;
  api: WebApiClient;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose(): void;
};

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

type QuickSearchState =
  | "idle"
  | "loading"
  | "ready"
  | "empty"
  | "error";

export function QuickSearchPanel({
  open,
  api,
  triggerRef,
  onClose,
}: QuickSearchPanelProps) {
  const [queryInput, setQueryInput] = useState("");
  const [state, setState] =
    useState<QuickSearchState>("idle");
  const [results, setResults] =
    useState<GlobalSearchResult[]>([]);
  const [queryError, setQueryError] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sequence = useRef(0);

  useEffect(() => {
    if (!open) {
      sequence.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      setQueryInput("");
      setState("idle");
      setResults([]);
      setQueryError("");
      return;
    }

    window.requestAnimationFrame(() =>
      inputRef.current?.focus(),
    );

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener(
      "pointerdown",
      onPointerDown,
    );
    document.addEventListener(
      "keydown",
      onKeyDown,
    );

    return () => {
      document.removeEventListener(
        "pointerdown",
        onPointerDown,
      );
      document.removeEventListener(
        "keydown",
        onKeyDown,
      );
    };
  }, [open, onClose, triggerRef]);

  useEffect(() => {
    if (!open) return;

    const query =
      normalizeGlobalSearchQuery(queryInput);
    const ticket = ++sequence.current;

    abortRef.current?.abort();
    abortRef.current = null;

    if (!query) {
      setState("idle");
      setResults([]);
      setQueryError("");
      return;
    }

    if (!isGlobalSearchQueryWithinLimit(query)) {
      setState("idle");
      setResults([]);
      setQueryError(
        "搜索关键词不能超过 200 个字符。",
      );
      return;
    }

    setQueryError("");
    setState("loading");

    const timer = window.setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;

      const params = new URLSearchParams({
        query,
        modules: SEARCH_MODULES.join(","),
        scope: "active",
        mode: "normal",
        limit: "5",
      });

      api
        .request<SearchResponse>(
          `/search?${params.toString()}`,
          {
            signal: controller.signal,
          },
        )
        .then((response) => {
          if (ticket !== sequence.current) return;

          const nextResults =
            response.data.results.slice(0, 5);

          setResults(nextResults);
          setState(
            nextResults.length ? "ready" : "empty",
          );
        })
        .catch(() => {
          if (
            ticket !== sequence.current ||
            controller.signal.aborted
          ) {
            return;
          }

          setResults([]);
          setState("error");
        });
    }, 220);

    return () => window.clearTimeout(timer);
  }, [api, open, queryInput, retryNonce]);

  if (!open) return null;

  const normalizedQuery =
    normalizeGlobalSearchQuery(queryInput);
  const canNavigate =
    Boolean(normalizedQuery) &&
    isGlobalSearchQueryWithinLimit(
      normalizedQuery,
    );

  const searchLocation =
    createGlobalSearchLocation({
      ...DEFAULT_GLOBAL_SEARCH_FILTERS,
      q: normalizedQuery,
    });

  const openResult = (
    result: GlobalSearchResult,
  ) => {
    const target =
      createGlobalSearchResultDetailLocation(
        result,
        searchLocation,
      );

    onClose();
    navigateWithinApp(
      target,
      window.history.state,
    );
  };

  const viewAll = () => {
    if (!canNavigate) return;

    onClose();
    navigateWithinApp(
      searchLocation,
      window.history.state,
    );
  };

  return (
    <div
      ref={panelRef}
      id="quick-search-panel"
      className="quick-search-panel"
      role="region"
      aria-label="快速搜索"
    >
      <div className="quick-search-field">
        <SearchIcon />

        <input
          ref={inputRef}
          id="quick-search-query"
          type="text"
          aria-label="快速搜索 Leilei OS"
          maxLength={200}
          autoComplete="off"
          placeholder="Search all records..."
          value={queryInput}
          onChange={(event) =>
            setQueryInput(event.target.value)
          }
        />
      </div>

      {queryError ? (
        <StateSurface
          state="error"
          message={queryError}
          placement="inline"
          className="quick-search-state"
        />
      ) : null}

      {!queryError && state === "loading" ? (
        <StateSurface
          state="loading"
          message="Searching..."
          placement="inline"
          className="quick-search-state"
        />
      ) : null}

      {!queryError && state === "empty" ? (
        <StateSurface
          state="empty"
          message="没有找到匹配内容"
          placement="inline"
          className="quick-search-state"
        />
      ) : null}

      {!queryError && state === "error" ? (
        <StateSurface
          state="error"
          message="Unable to read search results."
          retryLabel="Retry"
          onRetry={() => setRetryNonce((value) => value + 1)}
          placement="inline"
          className="quick-search-state"
        />
      ) : null}

      {!queryError && state === "ready" ? (
        <div className="quick-search-results">
          {results.map((result) => (
            <button
              key={`${result.entity_type}:${result.entity_id}`}
              className="quick-search-result"
              type="button"
              onClick={() => openResult(result)}
            >
              <span className="quick-search-result-module">
                {
                  GLOBAL_SEARCH_MODULE_LABELS[
                    result.entity_type
                  ]
                }
              </span>

              <span className="quick-search-result-title">
                {globalSearchResultTitle(result)}
              </span>

              <span className="quick-search-result-snippet">
                {globalSearchResultSnippet(result)}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {canNavigate ? (
        <button
          className="quick-search-view-all"
          type="button"
          onClick={viewAll}
        >
          查看全部结果
        </button>
      ) : null}
    </div>
  );
}
