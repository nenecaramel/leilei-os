import { useEffect, useState } from "react";
import {
  ArchiveIcon,
  CalendarIcon,
  MoodIcon,
  PenIcon,
} from "../components/icons";
import { ModuleSearchButton, ModuleSearchField } from "../components/ModuleSearch";
import { NativeDateInput } from "../components/NativeDateInput";

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

  useEffect(() => {
    if (searchDraft) setSearchOpen(true);
  }, [searchDraft]);

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
            <div
              className="memory-page-popover diary-filter-popover diary-date-popover"
              aria-label="Diary 日期筛选"
            >
              <button
                type="button"
                role="menuitemradio"
                aria-checked={!dateFrom && !dateTo}
                onClick={onDateRangeClear}
              >
                全部时间
              </button>
              <div className="diary-filter-field">
                <span>开始日期</span>
                <NativeDateInput
                  type="date"
                  aria-label="开始日期"
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(event) => onDateFromChange(event.target.value)}
                />
              </div>
              <div className="diary-filter-field">
                <span>结束日期</span>
                <NativeDateInput
                  type="date"
                  aria-label="结束日期"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(event) => onDateToChange(event.target.value)}
                />
              </div>
            </div>
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
            <div className="memory-page-popover diary-filter-popover diary-text-popover">
              <input
                type="text"
                aria-label="按心情筛选"
                placeholder="心情"
                maxLength={50}
                value={moodDraft}
                onChange={(event) => onMoodChange(event.target.value)}
              />
            </div>
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
            <div className="memory-page-popover diary-filter-popover diary-text-popover">
              <input
                type="text"
                aria-label="按标签筛选"
                placeholder="标签"
                maxLength={50}
                value={tagDraft}
                onChange={(event) => onTagChange(event.target.value)}
              />
            </div>
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
