export type ConversationMonthGroup<T> = {
  key: string;
  label: string;
  items: T[];
};

/**
 * Conversation dates are instants, so month grouping follows the browser's
 * local calendar in the same way the existing Memory/Diary presentation does.
 */
export function groupConversationsByMonth<T>(
  items: readonly T[],
  getDate: (item: T) => string | null | undefined,
): ConversationMonthGroup<T>[] {
  const groups: ConversationMonthGroup<T>[] = [];
  const byKey = new Map<string, ConversationMonthGroup<T>>();

  for (const item of items) {
    const value = getDate(item);
    const date = value ? new Date(value) : null;
    const parsed = date && !Number.isNaN(date.getTime())
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
    group.items.push(item);
  }

  return groups;
}
