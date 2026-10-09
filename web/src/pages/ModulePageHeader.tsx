import { useEffect, useRef, useState } from "react";
import {
  ArchiveIcon,
  CalendarIcon,
  MoodIcon,
  PenIcon,
} from "../components/icons";
import {
  ModuleSearchButton,
  ModuleSearchField,
} from "../components/ModuleSearch";
import { NativeDateInput } from "../components/NativeDateInput";

type ModulePageHeaderProps = {
  title: string;
  countLabel: string;
  searchLabel: string;
  searchPlaceholder: string;
  createLabel: string;
  diaryTools?: boolean;
  dateFrom: string;
  dateTo: string;
  moodDraft?: string;
  tagDraft?: string;
  searchDraft: string;
  filterError: string;
  busy: boolean;
  onDateFromChange(value: string): void;
  onDateToChange(value: string): void;
  onDateRangeClear(): void;
  onMoodChange?(value: string): void;
  onTagChange?(value: string): void;
  onSearchChange(value: string): void;
  onOpenArchive?(trigger: HTMLElement): void;
  onCreate(trigger: HTMLElement): void;
};

type OpenTool = "date" | "mood" | "tag" | null;

export function ModulePageHeader({
  title,
  countLabel,
  searchLabel,
  searchPlaceholder,
  createLabel,
  diaryTools = false,
  dateFrom,
  dateTo,
  moodDraft = "",
  tagDraft = "",
  searchDraft,
  filterError,
  busy,
  onDateFromChange,
  onDateToChange,
  onDateRangeClear,
  onMoodChange = () => {},
  onTagChange = () => {},
  onSearchChange,
  onOpenArchive = () => {},
  onCreate,
}: ModulePageHeaderProps) {
  const header = useRef<HTMLElement | null>(null);
  const [openTool, setOpenTool] = useState<OpenTool>(null);
  const [searchOpen, setSearchOpen] = useState(Boolean(searchDraft));
  const [customDateOpen, setCustomDateOpen] = useState(
    Boolean(dateFrom || dateTo),
  );

  useEffect(() => {
    if (searchDraft) setSearchOpen(true);
  }, [searchDraft]);

  useEffect(() => {
    if (dateFrom || dateTo) setCustomDateOpen(true);
  }, [dateFrom, dateTo]);

  useEffect(() => {
    if (!openTool) return;
    const dismiss = (event: MouseEvent) => {
      if (!header.current?.contains(event.target as Node)) setOpenTool(null);
    };
    document.addEventListener("click", dismiss);
    return () => document.removeEventListener("click", dismiss);
  }, [openTool]);

  function toggleTool(next: Exclude<OpenTool, null>) {
    setSearchOpen(false);
    setOpenTool((current) => (current === next ? null : next));
  }

  return (
    <header
      ref={header}
      className="memory-page-header diary-page-header"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        setOpenTool(null);
        setSearchOpen(false);
      }}
    >
      <div className="memory-page-heading">
        <div className="memory-page-title">{title}</div>
        <div className="memory-page-count">{countLabel}</div>
      </div>

      <div className="memory-page-tools diary-page-tools">
        <div className="memory-page-tool-wrap task-time-tool-wrap">
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
              className="memory-page-popover task-filter-popover task-time-popover"
              aria-label={`${title} 日期筛选`}
            >
              <button
                type="button"
                role="menuitemradio"
                aria-checked={!dateFrom && !dateTo}
                onClick={() => {
                  setCustomDateOpen(false);
                  onDateRangeClear();
                }}
              >
                全部时间
              </button>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={Boolean(dateFrom || dateTo)}
                onClick={() => setCustomDateOpen(true)}
              >
                自定义范围
              </button>
              {customDateOpen ? (
                <div className="task-custom-range">
                  <NativeDateInput
                    type="date"
                    aria-label={`${title} 自定义开始时间`}
                    value={dateFrom}
                    max={dateTo || undefined}
                    onChange={(event) => onDateFromChange(event.target.value)}
                  />
                  <NativeDateInput
                    type="date"
                    aria-label={`${title} 自定义结束时间`}
                    value={dateTo}
                    min={dateFrom || undefined}
                    onChange={(event) => onDateToChange(event.target.value)}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {diaryTools ? (
          <>
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
                <span className="memory-page-tag-icon" aria-hidden="true">
                  #
                </span>
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
          </>
        ) : null}
        <ModuleSearchButton
          label={searchLabel}
          expanded={searchOpen}
          disabled={busy}
          onClick={() => {
            setOpenTool(null);
            setSearchOpen((value) => !value);
          }}
        />
        {diaryTools ? (
          <button
            type="button"
            aria-label="查看归档"
            disabled={busy}
            onClick={(event) => onOpenArchive(event.currentTarget)}
          >
            <ArchiveIcon />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={createLabel}
          disabled={busy}
          onClick={(event) => onCreate(event.currentTarget)}
        >
          <PenIcon className="memory-page-create-icon" />
        </button>
      </div>

      {searchOpen ? (
        <ModuleSearchField
          className="diary-page-search"
          ariaLabel={`${searchLabel}内容`}
          placeholder={searchPlaceholder}
          value={searchDraft}
          onChange={onSearchChange}
        />
      ) : null}

      {filterError ? (
        <p className="diary-filter-error" role="alert">
          {filterError}
        </p>
      ) : null}
    </header>
  );
}
