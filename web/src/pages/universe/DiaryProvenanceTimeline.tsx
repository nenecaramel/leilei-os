import type { UniverseDiarySourceSummary } from "./universe-types";
import { formatDiarySourceDate } from "./universe-node-presentation";

export function DiaryProvenanceTimeline({ sources, onOpen }: { sources: UniverseDiarySourceSummary[]; onOpen?: (diaryId: string) => void }) {
  if (!sources.length) return null;
  const ordered = sources.slice().sort((left, right) => left.date.localeCompare(right.date) || left.diaryId.localeCompare(right.diaryId));
  return (
    <div className="universe-diary-provenance" aria-label="来源日记">
      {ordered.map((source) => (
        <div className="universe-diary-provenance-row" key={source.diaryId}>
          <span className="universe-diary-provenance-line" aria-hidden="true"><i /></span>
          <button type="button" className="universe-diary-provenance-link" onClick={() => onOpen?.(source.diaryId)}>
            <span className="universe-diary-provenance-date">{formatDiarySourceDate(source.date)}</span>
            <span className="universe-diary-provenance-title" title={source.title}>{source.title}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
