import React from "react";
import type { HomeCalendarDay } from "./home-prototype-data";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarPreview({ days, date = new Date() }: { days: HomeCalendarDay[]; date?: Date }) {
  void days;
  const monthLabel = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long" }).format(date);
  const firstWeekday = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const previousMonthDays = new Date(date.getFullYear(), date.getMonth(), 0).getDate();
  const cells = Array.from({ length: 42 }, (_, index) => {
    const dayOffset = index - firstWeekday + 1;
    if (dayOffset < 1) return { day: previousMonthDays + dayOffset, outside: true, key: `previous-${index}` };
    if (dayOffset > daysInMonth) return { day: dayOffset - daysInMonth, outside: true, key: `next-${index}` };
    return { day: dayOffset, outside: false, key: `current-${index}` };
  });
  return (
    <section className="home-section calendar-preview" aria-labelledby="calendar-preview-title">
      <div className="home-section-heading calendar-section-heading">
        <h2 id="calendar-preview-title">Calendar</h2>
      </div>
      <div className="calendar-frame">
        <div className="calendar-preview-header" aria-hidden="true">
          <span>‹</span>
          <strong>{monthLabel}</strong>
          <span>›</span>
        </div>
        <div className="calendar-weekdays" aria-hidden="true">
          {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
        </div>
        <div className="calendar-grid" role="grid" aria-label={`${monthLabel} 日历预览`}>
          {cells.map((item) => (
            <span className={`calendar-day${item.outside ? " calendar-day-outside" : ""}${!item.outside && item.day === date.getDate() ? " calendar-day-current" : ""}`} role="gridcell" key={item.key}>
              <span>{item.day}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
