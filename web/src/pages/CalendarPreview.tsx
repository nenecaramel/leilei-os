import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type CalendarLoadState = "loading" | "ready" | "error";

type CalendarPreviewProps = {
  contentDates: readonly string[];
  date?: Date;
  status: CalendarLoadState;
  onRetry?: () => void | Promise<void>;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function businessDateKey(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}

export function CalendarPreview({
  contentDates,
  date = new Date(),
  status,
  onRetry,
}: CalendarPreviewProps) {
  const anchorYear = date.getFullYear();
  const anchorMonth = date.getMonth();
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(anchorYear, anchorMonth, 1));

  useEffect(() => {
    setVisibleMonth(new Date(anchorYear, anchorMonth, 1));
  }, [anchorMonth, anchorYear]);

  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const monthLabel = `${year}年 ${month + 1}月`;
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const previousMonthDays = new Date(year, month, 0).getDate();
  const readyContentDates = useMemo(
    () => new Set(status === "ready" ? contentDates : []),
    [contentDates, status],
  );
  const isAnchorMonth = year === anchorYear && month === anchorMonth;
  const cells = Array.from({ length: 42 }, (_, index) => {
    const dayOffset = index - firstWeekday + 1;
    if (dayOffset < 1) {
      return { day: previousMonthDays + dayOffset, outside: true, key: `previous-${index}`, dateKey: null };
    }
    if (dayOffset > daysInMonth) {
      return { day: dayOffset - daysInMonth, outside: true, key: `next-${index}`, dateKey: null };
    }
    return {
      day: dayOffset,
      outside: false,
      key: `current-${index}`,
      dateKey: businessDateKey(year, month, dayOffset),
    };
  });

  const shiftMonth = (offset: number) => {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  return (
    <section className="home-section home-preview-section calendar-preview" aria-labelledby="calendar-preview-title">
      <div className="home-section-heading calendar-section-heading">
        <h2 id="calendar-preview-title">Calendar</h2>
        {status === "error" ? <div className="home-inline-unavailable" role="alert"><span>Unable to read Calendar.</span>{onRetry ? <button type="button" onClick={() => void onRetry()}>Retry</button> : null}</div> : null}
      </div>
      <div className="calendar-frame">
        <div className="calendar-preview-header">
          <button className="calendar-month-button" type="button" aria-label="上一个月" disabled={status === "loading"} onClick={() => shiftMonth(-1)}>‹</button>
          <strong>{monthLabel}</strong>
          <button className="calendar-month-button" type="button" aria-label="下一个月" disabled={status === "loading"} onClick={() => shiftMonth(1)}>›</button>
        </div>
        <div className="calendar-weekdays" aria-hidden="true">
          {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
        </div>
        <div className="calendar-grid" role="grid" aria-label={`${monthLabel} 日历预览`} aria-busy={status === "loading"}>
          {cells.map((item) => {
            const current = !item.outside && isAnchorMonth && item.day === date.getDate();
            const hasContent = item.dateKey ? readyContentDates.has(item.dateKey) : false;
            const className = `calendar-day${item.outside ? " calendar-day-outside" : ""}${current ? " calendar-day-current" : ""}`;
            if (!item.dateKey) {
              return <span className={className} role="gridcell" key={item.key}><span>{item.day}</span></span>;
            }
            return (
              <Link
                className={`${className} calendar-day-link`}
                role="gridcell"
                key={item.key}
                to={`/day-space?date=${item.dateKey}`}
                aria-label={`${item.dateKey}${hasContent ? "，有内容" : ""}`}
              >
                <span>{item.day}</span>
                {hasContent ? <i className="calendar-day-marker" aria-hidden="true" /> : null}
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
