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
import {
  PopoverOption,
  PopoverShell,
} from "../components/FilterPopover.js";
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
  const [customDateOpen, setCustomDateOpen] = useState(
    Boolean(draftFilters.dateFrom || draftFilters.dateTo),
  );

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
            <PopoverShell role="menu" ariaLabel="Global Search 模块">
              <PopoverOption
                role="menuitemcheckbox"
                checked={allModulesSelected}
                showCheck
                onClick={() => {
                  onModulesChange([...SEARCH_MODULES]);
                  setOpenMenu(null);
                }}
              >
                全部模块
              </PopoverOption>

              {SEARCH_MODULES.map((module) => {
                const selected = draftFilters.modules.includes(module);
                return (
                  <PopoverOption
                    key={module}
                    role="menuitemcheckbox"
                    checked={selected}
                    showCheck
                    onClick={() => toggleModule(module)}
                  >
                    {GLOBAL_SEARCH_MODULE_LABELS[module]}
                  </PopoverOption>
                );
              })}
            </PopoverShell>
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
            <PopoverShell variant="time" role="menu" ariaLabel="Global Search 日期">
              <PopoverOption
                checked={!draftFilters.dateFrom && !draftFilters.dateTo}
                onClick={() => {
                  setCustomDateOpen(false);
                  onClearDateRange();
                }}
              >
                全部时间
              </PopoverOption>
              <PopoverOption
                checked={Boolean(draftFilters.dateFrom || draftFilters.dateTo)}
                onClick={() => setCustomDateOpen(true)}
              >
                自定义范围
              </PopoverOption>
              {customDateOpen ? (
                <div className="filter-popover-time-range">
                  <NativeDateInput
                    type="date"
                    aria-label="Global Search 自定义开始时间"
                    value={draftFilters.dateFrom}
                    max={draftFilters.dateTo || undefined}
                    onChange={(event) =>
                      onDateRangeChange(
                        event.target.value,
                        draftFilters.dateTo,
                      )
                    }
                  />
                  <NativeDateInput
                    type="date"
                    aria-label="Global Search 自定义结束时间"
                    value={draftFilters.dateTo}
                    min={draftFilters.dateFrom || undefined}
                    onChange={(event) =>
                      onDateRangeChange(
                        draftFilters.dateFrom,
                        event.target.value,
                      )
                    }
                  />
                </div>
              ) : null}
            </PopoverShell>
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
            <PopoverShell role="menu" ariaLabel="Global Search 范围">
              {([
                ["all", "全部"],
                ["active", "当前"],
                ["archived", "已归档"],
              ] as const).map(([scope, label]) => (
                <PopoverOption
                  key={scope}
                  checked={draftFilters.scope === scope}
                  onClick={() => {
                    onScopeChange(scope);
                    setOpenMenu(null);
                  }}
                >
                  {label}
                </PopoverOption>
              ))}
            </PopoverShell>
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
