import {
  useState,
  type RefObject,
} from "react";
import {
  CalendarIcon,
  DashboardIcon,
  ScopeIcon,
  SearchIcon,
} from "../components/icons.js";
import { NativeDateInput } from "../components/NativeDateInput.js";
import {
  SEARCH_MODULES,
  type GlobalSearchFilters,
  type SearchModule,
} from "./global-search-location.js";
import { GLOBAL_SEARCH_MODULE_LABELS } from "./global-search-result.js";

type GlobalSearchPageHeaderProps = {
  subtitle: string;
  queryInput: string;
  draftFilters: GlobalSearchFilters;
  dateError: string;
  queryError: string;
  busy: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onQueryInputChange(value: string): void;
  onModulesChange(modules: SearchModule[]): void;
  onScopeChange(scope: GlobalSearchFilters["scope"]): void;
  onDateRangeChange(dateFrom: string, dateTo: string): void;
  onClearDateRange(): void;
};

type OpenMenu = "modules" | "date" | "scope" | null;

export function GlobalSearchPageHeader({
  subtitle,
  queryInput,
  draftFilters,
  dateError,
  queryError,
  busy,
  searchInputRef,
  onQueryInputChange,
  onModulesChange,
  onScopeChange,
  onDateRangeChange,
  onClearDateRange,
}: GlobalSearchPageHeaderProps) {
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [customDateOpen, setCustomDateOpen] = useState(Boolean(draftFilters.dateFrom || draftFilters.dateTo));

  const toggleModule = (module: SearchModule) => {
    const selected = draftFilters.modules.includes(module);
    if (selected && draftFilters.modules.length === 1) return;

    onModulesChange(
      selected
        ? draftFilters.modules.filter((item) => item !== module)
        : SEARCH_MODULES.filter(
            (item) =>
              draftFilters.modules.includes(item) ||
              item === module,
          ),
    );
  };

  const allModulesSelected =
    draftFilters.modules.length === SEARCH_MODULES.length;

  return (
    <header
      className="memory-page-header global-search-header"
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpenMenu(null);
      }}
    >
      <div className="memory-page-heading">
        <div className="memory-page-title">Global Search</div>
        <div className="memory-page-count">{subtitle}</div>
      </div>

      <div className="memory-page-tools global-search-tools">
        <div className="memory-page-tool-wrap">
          <button
            type="button"
            aria-label="筛选模块"
            aria-expanded={openMenu === "modules"}
            disabled={busy}
            onClick={() =>
              setOpenMenu((value) =>
                value === "modules" ? null : "modules"
              )
            }
          >
            <DashboardIcon className="memory-page-category-icon" />
          </button>

          {openMenu === "modules" ? (
            <div
              className="memory-page-popover global-search-popover global-search-module-popover"
              role="menu"
              aria-label="Global Search 模块"
            >
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={allModulesSelected}
                onClick={() => {
                  onModulesChange([...SEARCH_MODULES]);
                  setOpenMenu(null);
                }}
              >
                <span>全部模块</span>
                <span className="global-search-menu-check" aria-hidden="true">
                  {allModulesSelected ? "✓" : ""}
                </span>
              </button>

              {SEARCH_MODULES.map((module) => {
                const selected = draftFilters.modules.includes(module);

                return (
                  <button
                    key={module}
                    className="global-search-module-option"
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={selected}
                    onClick={() => toggleModule(module)}
                  >
                    <span>{GLOBAL_SEARCH_MODULE_LABELS[module]}</span>
                    <span
                      className="global-search-menu-check"
                      aria-hidden="true"
                    >
                      {selected ? "✓" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="memory-page-tool-wrap">
          <button
            type="button"
            aria-label="筛选日期"
            aria-expanded={openMenu === "date"}
            disabled={busy}
            onClick={() =>
              setOpenMenu((value) =>
                value === "date" ? null : "date"
              )
            }
          >
            <CalendarIcon />
          </button>

          {openMenu === "date" ? (
            <div
              className="memory-page-popover task-filter-popover task-time-popover"
              role="menu"
              aria-label="Global Search 日期"
            >
              <button
                type="button"
                role="menuitemradio"
                aria-checked={!draftFilters.dateFrom && !draftFilters.dateTo}
                onClick={() => {
                  setCustomDateOpen(false);
                  onClearDateRange();
                }}
              >
                全部时间
              </button>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={Boolean(draftFilters.dateFrom || draftFilters.dateTo)}
                onClick={() => setCustomDateOpen(true)}
              >
                自定义范围
              </button>
              {customDateOpen ? (
                <div className="task-custom-range">
                  <NativeDateInput
                    type="date"
                    aria-label="Global Search 自定义开始时间"
                    value={draftFilters.dateFrom}
                    max={draftFilters.dateTo || undefined}
                    onChange={(event) =>
                      onDateRangeChange(event.target.value, draftFilters.dateTo)
                    }
                  />
                  <NativeDateInput
                    type="date"
                    aria-label="Global Search 自定义结束时间"
                    value={draftFilters.dateTo}
                    min={draftFilters.dateFrom || undefined}
                    onChange={(event) =>
                      onDateRangeChange(draftFilters.dateFrom, event.target.value)
                    }
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="memory-page-tool-wrap">
          <button
            type="button"
            aria-label="筛选范围"
            aria-expanded={openMenu === "scope"}
            disabled={busy}
            onClick={() =>
              setOpenMenu((value) =>
                value === "scope" ? null : "scope"
              )
            }
          >
            <ScopeIcon />
          </button>

          {openMenu === "scope" ? (
            <div
              className="memory-page-popover global-search-popover global-search-scope-popover"
              role="menu"
              aria-label="Global Search 范围"
            >
              {([
                ["all", "全部范围"],
                ["active", "当前"],
                ["archived", "已归档"],
              ] as const).map(([scope, label]) => (
                <button
                  key={scope}
                  type="button"
                  role="menuitemradio"
                  aria-checked={draftFilters.scope === scope}
                  onClick={() => {
                    onScopeChange(scope);
                    setOpenMenu(null);
                  }}
                >
                  <span>{label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="memory-page-search">
        <SearchIcon />
        <input
          ref={searchInputRef}
          id="global-search-query"
          type="text"
          aria-label="搜索 Leilei OS"
          maxLength={200}
          autoComplete="off"
          placeholder="Search all records..."
          value={queryInput}
          onChange={(event) =>
            onQueryInputChange(event.target.value)
          }
        />
      </div>

      {dateError || queryError ? (
        <p
          className="form-error global-search-inline-error"
          role="alert"
        >
          {dateError || queryError}
        </p>
      ) : null}
    </header>
  );
}
