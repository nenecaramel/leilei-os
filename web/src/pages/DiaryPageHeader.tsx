import { useEffect, useState } from "react";
import {
  ArchiveIcon,
  CalendarIcon,
  MoodIcon,
  PenIcon,
} from "../components/icons";
import { ModuleSearchButton, ModuleSearchField } from "../components/ModuleSearch";
import { NativeDateInput } from "../components/NativeDateInput";
import {
  PopoverOption,
  PopoverSearchInput,
  PopoverShell,
} from "../components/FilterPopover";

type DiaryPageHeaderProps = {
  count: number;
  dateFrom: string;
  dateTo: string;
  moodDraft: string;
  tagDraft: string;
  searchDraft: string;
  filterError: string;
  busy: boolean;
  onDateFromChange(value: string): void;
  onDateToChange(value: string): void;
  onDateRangeClear(): void;
  onMoodChange(value: string): void;
  onTagChange(value: string): void;
  onSearchChange(value: string): void;
  onOpenArchive(trigger: HTMLElement): void;
  onCreate(trigger: HTMLElement): void;
};

type OpenTool = "date" | "mood" | "tag" | null;

export function DiaryPageHeader({
  count,
  dateFrom,
  dateTo,
  moodDraft,
  tagDraft,
  searchDraft,
  filterError,
  busy,
  onDateFromChange,
  onDateToChange,
  onDateRangeClear,
  onMoodChange,
  onTagChange,
  onSearchChange,
  onOpenArchive,
  onCreate,
}: DiaryPageHeaderProps) {
  const [openTool, setOpenTool] = useState<OpenTool>(null);
  const [searchOpen, setSearchOpen] = useState(Boolean(searchDraft));
  const [customDateOpen, setCustomDateOpen] = useState(Boolean(dateFrom || dateTo));

  useEffect(() => {
    if (searchDraft) setSearchOpen(true);
  }, [searchDraft]);

  useEffect(() => {
    if (dateFrom || dateTo) setCustomDateOpen(true);
  }, [dateFrom, dateTo]);

  function toggleTool(next: Exclude<OpenTool, null>) {
    setSearchOpen(false);
    setOpenTool((current) => current === next ? null : next);
  }

  return (
    <header
      className="memory-page-header diary-page-header"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        setOpenTool(null);
        setSearchOpen(false);
      }}
    >
      <div className="memory-page-heading">
        <div className="memory-page-title">Diary</div>
        <div className="memory-page-count">{count}篇日记</div>
      </div>

      <div className="memory-page-tools diary-page-tools">
        <div className="memory-page-tool-wrap">
          <button
            type="button"
            aria-label="按日期筛选"
            aria-expanded={openTool === "date"}
            aria-pressed={Boolean(dateFrom || dateTo)}
            disabled={busy}
            onClick={() => toggleTool("date")}
          >
            <CalendarIcon className="diary-page-date-icon" />
          </button>
          {openTool === "date" ? (
            <PopoverShell variant="time" role="menu" ariaLabel="Diary 日期筛选">
              <PopoverOption
                checked={!dateFrom && !dateTo}
                onClick={() => {
                  setCustomDateOpen(false);
                  onDateRangeClear();
                }}
              >
                全部时间
              </PopoverOption>
              <PopoverOption
                checked={Boolean(dateFrom || dateTo)}
                onClick={() => setCustomDateOpen(true)}
              >
                自定义范围
              </PopoverOption>
              {customDateOpen ? (
                <div className="filter-popover-time-range">
                  <NativeDateInput
                    type="date"
                    aria-label="Diary 自定义开始时间"
                    value={dateFrom}
                    max={dateTo || undefined}
                    onChange={(event) => onDateFromChange(event.target.value)}
                  />
                  <NativeDateInput
                    type="date"
                    aria-label="Diary 自定义结束时间"
                    value={dateTo}
                    min={dateFrom || undefined}
                    onChange={(event) => onDateToChange(event.target.value)}
                  />
                </div>
              ) : null}
            </PopoverShell>
          ) : null}
        </div>

        <div className="memory-page-tool-wrap">
          <button
            type="button"
            aria-label="按心情筛选"
            aria-expanded={openTool === "mood"}
            aria-pressed={Boolean(moodDraft)}
            disabled={busy}
            onClick={() => toggleTool("mood")}
          >
            <MoodIcon className="diary-page-mood-icon" />
          </button>
          {openTool === "mood" ? (
            <PopoverShell variant="search" ariaLabel="Diary 心情搜索">
              <PopoverSearchInput
                aria-label="按心情筛选"
                placeholder="心情"
                maxLength={50}
                value={moodDraft}
                onChange={(event) => onMoodChange(event.target.value)}
              />
            </PopoverShell>
          ) : null}
        </div>

        <div className="memory-page-tool-wrap">
          <button
            type="button"
            aria-label="按标签筛选"
            aria-expanded={openTool === "tag"}
            aria-pressed={Boolean(tagDraft)}
            disabled={busy}
            onClick={() => toggleTool("tag")}
          >
            <span className="memory-page-tag-icon" aria-hidden="true">#</span>
          </button>
          {openTool === "tag" ? (
            <PopoverShell variant="search" ariaLabel="Diary 标签搜索">
              <PopoverSearchInput
                aria-label="按标签筛选"
                placeholder="标签"
                maxLength={50}
                value={tagDraft}
                onChange={(event) => onTagChange(event.target.value)}
              />
            </PopoverShell>
          ) : null}
        </div>

        <ModuleSearchButton
          label="搜索日记"
          expanded={searchOpen}
          disabled={busy}
          onClick={() => {
            setOpenTool(null);
            setSearchOpen((value) => !value);
          }}
        />
        <button
          type="button"
          aria-label="查看归档"
          disabled={busy}
          onClick={(event) => onOpenArchive(event.currentTarget)}
        >
          <ArchiveIcon />
        </button>
        <button
          type="button"
          aria-label="新增日记"
          disabled={busy}
          onClick={(event) => onCreate(event.currentTarget)}
        >
          <PenIcon className="memory-page-create-icon" />
        </button>
      </div>

      {searchOpen ? <ModuleSearchField className="diary-page-search" ariaLabel="搜索日记内容" placeholder="Search diary entries..." value={searchDraft} onChange={onSearchChange} /> : null}

      {filterError ? (
        <p className="diary-filter-error" role="alert">{filterError}</p>
      ) : null}
    </header>
  );
}
