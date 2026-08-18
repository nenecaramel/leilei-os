import { useMemo, useState } from "react";
import {
  businessDateToLocalDate,
  formatLocalBusinessDate,
} from "./day-space-location.js";

type DaySpaceDatePickerProps = {
  selectedDate: string;
  todayDate: string;
  onSelect(value: string): void;
  onClose(): void;
};

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function startOfVisibleGrid(month: Date): Date {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  first.setDate(first.getDate() - first.getDay());
  return first;
}

export function DaySpaceDatePicker({
  selectedDate,
  todayDate,
  onSelect,
  onClose,
}: DaySpaceDatePickerProps) {
  const selected = businessDateToLocalDate(selectedDate) ?? new Date();
  const [month, setMonth] = useState(
    () => new Date(selected.getFullYear(), selected.getMonth(), 1),
  );

  const cells = useMemo(() => {
    const start = startOfVisibleGrid(month);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [month]);

  const monthLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(month);

  return (
    <div className="day-space-date-picker" role="dialog" aria-label="选择 Day Space 日期">
      <div className="day-space-date-picker-head">
        <button
          type="button"
          aria-label="上个月"
          onClick={() =>
            setMonth((value) => new Date(value.getFullYear(), value.getMonth() - 1, 1))
          }
        >
          ‹
        </button>
        <span>{monthLabel}</span>
        <button
          type="button"
          aria-label="下个月"
          onClick={() =>
            setMonth((value) => new Date(value.getFullYear(), value.getMonth() + 1, 1))
          }
        >
          ›
        </button>
      </div>

      <div className="day-space-calendar-weekdays" aria-hidden="true">
        {WEEKDAYS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="day-space-calendar-grid">
        {cells.map((date) => {
          const value = formatLocalBusinessDate(date);
          const selectedCell = value === selectedDate;
          const todayCell = value === todayDate;
          const outside = date.getMonth() !== month.getMonth();

          return (
            <button
              type="button"
              key={value}
              data-selected={selectedCell ? "true" : undefined}
              data-today={!selectedCell && todayCell ? "true" : undefined}
              data-outside={outside ? "true" : undefined}
              aria-current={todayCell ? "date" : undefined}
              onClick={() => onSelect(value)}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>

      <button type="button" className="day-space-date-picker-close" onClick={onClose}>
        关闭
      </button>
    </div>
  );
}
