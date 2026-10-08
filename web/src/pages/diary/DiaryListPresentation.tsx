import type { DiaryEntry } from "./diary-page-types";
import { formatDiaryRowDate, formatDiaryRowMeta, groupDiariesByMonth } from "../diary-presentation";

export function MobileDiaryLoading({ label }: { label: string }) {
  return (
    <section className="memory-months" aria-label={label} aria-busy="true">
      <span className="visually-hidden" role="status" aria-live="polite">正在读取日记…</span>
      {[0, 1].map((index) => (
        <div className="memory-month-skeleton" aria-hidden="true" key={index}>
          <span className="memory-month-skeleton-label" />
          <div className="memory-month-skeleton-card">
            <span />
            <span />
          </div>
        </div>
      ))}
    </section>
  );
}

export function MobileDiaryRows({
  diaries,
  busy,
  label,
  onOpen,
}: {
  diaries: DiaryEntry[];
  busy: boolean;
  label: string;
  onOpen(id: string, trigger: HTMLElement): void;
}) {
  const groups = groupDiariesByMonth(diaries);

  return (
    <section className="memory-months" aria-label={label}>
      {groups.map((group) => (
        <section className="memory-month-section" key={group.key}>
          <h2 className="memory-month-label">{group.label}</h2>
          <div className="memory-month-card">
            {group.diaries.map((diary) => {
              const metadata = formatDiaryRowMeta(diary);
              return (
                <button
                  key={diary.id}
                  type="button"
                  className="memory-row"
                  data-diary-id={diary.id}
                  disabled={busy}
                  onClick={(event) => onOpen(diary.id, event.currentTarget)}
                >
                  <span className="memory-row-title">{diary.title}</span>
                  <span className="memory-row-meta">
                    <span>{formatDiaryRowDate(diary.date)}</span>
                    <span>{metadata}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </section>
  );
}
