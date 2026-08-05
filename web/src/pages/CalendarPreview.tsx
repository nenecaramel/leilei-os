import React from "react";
import type { HomeCalendarDay } from "./home-prototype-data";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

export function CalendarPreview({ days, date = new Date() }: { days: HomeCalendarDay[]; date?: Date }) {
  const monthLabel = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(date);
  const firstWeekday = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  const leading = firstWeekday === 0 ? 6 : firstWeekday - 1;
  return (
    <section className="home-section calendar-preview" aria-labelledby="calendar-preview-title">
      <div className="home-section-heading">
        <h2 id="calendar-preview-title">Calendar</h2>
        <span>{monthLabel}</span>
      </div>
      <div className="calendar-weekdays" aria-hidden="true">
        {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
      </div>
      <div className="calendar-grid" role="grid" aria-label={`${monthLabel} 日历预览`}>
        {Array.from({ length: leading }, (_, index) => <span className="calendar-day calendar-day-empty" key={`empty-${index}`} />)}
        {days.map((item) => (
          <span className="calendar-day" role="gridcell" key={item.day}>
            <span>{item.day}</span>
            {item.hasContent && <i aria-label="有记录" />}
          </span>
        ))}
      </div>
    </section>
  );
}
