export type SharedPaperPresentationRecord = {
  id: string;
  updatedAt: string;
};

export type SharedPaperMonthGroup<T> = {
  key: string;
  label: string;
  papers: T[];
  unknown: boolean;
};

export function groupSharedPapersByMonth<T extends SharedPaperPresentationRecord>(
  papers: readonly T[],
): SharedPaperMonthGroup<T>[] {
  const dated: SharedPaperMonthGroup<T>[] = [];
  const byKey = new Map<string, SharedPaperMonthGroup<T>>();
  const unknown: T[] = [];

  for (const paper of papers) {
    const date = new Date(paper.updatedAt);
    if (Number.isNaN(date.getTime())) {
      unknown.push(paper);
      continue;
    }

    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const key = `${year}-${month}`;
    let group = byKey.get(key);

    if (!group) {
      group = {
        key,
        label: `${year}年${month}月`,
        papers: [],
        unknown: false,
      };
      byKey.set(key, group);
      dated.push(group);
    }

    group.papers.push(paper);
  }

  return unknown.length > 0
    ? [
        ...dated,
        {
          key: "unknown",
          label: "时间未知",
          papers: unknown,
          unknown: true,
        },
      ]
    : dated;
}

export function formatSharedPaperRowDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";

  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function formatSharedPaperDetailDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";

  const calendar = [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join(".");

  const time = [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
  ].join(":");

  return `${calendar} ${time}`;
}
