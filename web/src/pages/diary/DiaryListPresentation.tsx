import type { DiaryEntry } from "./diary-page-types";
import { formatDiaryRowDate, formatDiaryRowMeta, groupDiariesByMonth } from "../diary-presentation";
import { ModuleMonthLoading, ModuleMonthRows } from "../ModuleMonthRows";

export function MobileDiaryLoading({ label }: { label: string }) {
  return <ModuleMonthLoading label={label} loadingText="正在读取日记…" />;
}
export function MobileDiaryRows({ diaries, busy, label, onOpen }: {
  diaries: DiaryEntry[]; busy: boolean; label: string;
  onOpen(id: string, trigger: HTMLElement): void;
}) {
  return <ModuleMonthRows label={label} busy={busy} onOpen={onOpen}
    groups={groupDiariesByMonth(diaries).map(group => ({
      key: group.key, label: group.label,
      rows: group.diaries.map(diary => ({id: diary.id, title: diary.title,
        date: formatDiaryRowDate(diary.date), meta: formatDiaryRowMeta(diary),
        attributes: {"data-diary-id": diary.id}})),
    }))} />;
}

