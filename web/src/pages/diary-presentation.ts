export type DiaryPresentationRecord = {
  id: string;
  title: string;
  date: string;
  tags: string[];
  mood: string | null;
};

export type DiaryMonthGroup<T> = {
  key: string;
  label: string;
  diaries: T[];
};

function parseDiaryDate(value: string): {
  year: number;
  month: number;
  day: number;
} | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));

  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

export function groupDiariesByMonth<T extends DiaryPresentationRecord>(
  diaries: readonly T[],
): DiaryMonthGroup<T>[] {
  const groups: DiaryMonthGroup<T>[] = [];
  const byKey = new Map<string, DiaryMonthGroup<T>>();

  for (const diary of diaries) {
    const parsed = parseDiaryDate(diary.date);
    const key = parsed
      ? `${parsed.year}-${String(parsed.month).padStart(2, "0")}`
      : `unknown:${diary.date}`;
    let group = byKey.get(key);

    if (!group) {
      group = {
        key,
        label: parsed
          ? `${parsed.year}年${parsed.month}月`
          : "日期未知",
        diaries: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }

    group.diaries.push(diary);
  }

  return groups;
}

export function formatDiaryRowDate(value: string): string {
  const parsed = parseDiaryDate(value);
  return parsed ? `${parsed.month}/${parsed.day}` : value;
}

export function formatDiaryPaperDate(value: string): string {
  const parsed = parseDiaryDate(value);
  if (!parsed) return value;

  return [
    String(parsed.year).padStart(4, "0"),
    String(parsed.month).padStart(2, "0"),
    String(parsed.day).padStart(2, "0"),
  ].join(".");
}

export function formatDiaryRowMeta(
  diary: Pick<DiaryPresentationRecord, "mood" | "tags">,
): string {
  const mood = diary.mood?.trim() ?? "";
  const tags = diary.tags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => `#${tag}`)
    .join(" ");

  if (mood && tags) return `${mood} · ${tags}`;
  return mood || tags;
}
