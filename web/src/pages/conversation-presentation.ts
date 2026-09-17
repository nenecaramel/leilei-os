export type ConversationMonthGroup<T> = {
  key: string;
  label: string;
  items: T[];
};

type DatedItem<T> = {
  item: T;
  value: string | null | undefined;
  time: number | null;
};

/**
 * Conversation dates are instants, so month grouping follows the browser's
 * local calendar in the same way the existing Memory/Diary presentation does.
 *
 * The supplied date is also the visible ordering date for the surface. Keep
 * month groups and rows reverse chronological, with unknown dates last.
 */
export function groupConversationsByMonth<T>(
  items: readonly T[],
  getDate: (item: T) => string | null | undefined,
): ConversationMonthGroup<T>[] {
  const sorted: DatedItem<T>[] = items
    .map((item) => {
      const value = getDate(item);
      const date = value ? new Date(value) : null;
      const time = date && !Number.isNaN(date.getTime())
        ? date.getTime()
        : null;
      return { item, value, time };
    })
    .sort((left, right) => {
      if (left.time === null && right.time === null) return 0;
      if (left.time === null) return 1;
      if (right.time === null) return -1;
      return right.time - left.time;
    });

  const groups: ConversationMonthGroup<T>[] = [];
  const byKey = new Map<string, ConversationMonthGroup<T>>();

  for (const entry of sorted) {
    const date = entry.time === null ? null : new Date(entry.time);
    const parsed = date
      ? { year: date.getFullYear(), month: date.getMonth() + 1 }
      : null;
    const key = parsed
      ? `${parsed.year}-${String(parsed.month).padStart(2, "0")}`
      : "unknown";
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        label: parsed ? `${parsed.year}年${parsed.month}月` : "时间未知",
        items: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(entry.item);
  }

  return groups;
}
