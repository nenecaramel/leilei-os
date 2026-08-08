export type MemoryPresentationRecord = {
  id: string;
  category: string;
  key: string;
  content: string;
  tags: string[];
  updated_at: string;
};

export type MemoryMonthGroup<T> = {
  key: string;
  label: string;
  memories: T[];
  unknown: boolean;
};

export function getMemoryRowTitle(
  memory: Pick<MemoryPresentationRecord, "key" | "content">,
): string {
  const key = memory.key.trim();
  if (key) return key;

  return (
    memory.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "未命名记忆"
  );
}

export function formatMemoryRowMeta(
  memory: Pick<MemoryPresentationRecord, "category" | "tags">,
  categoryLabel: string,
): string {
  const tags = memory.tags.map((tag) => `#${tag}`).join(" ");
  return tags ? `${categoryLabel} · ${tags}` : categoryLabel;
}

export function groupMemoriesByMonth<T extends MemoryPresentationRecord>(
  memories: readonly T[],
): MemoryMonthGroup<T>[] {
  const dated: MemoryMonthGroup<T>[] = [];
  const byKey = new Map<string, MemoryMonthGroup<T>>();
  const unknown: T[] = [];

  for (const memory of memories) {
    const date = new Date(memory.updated_at);
    if (Number.isNaN(date.getTime())) {
      unknown.push(memory);
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
        memories: [],
        unknown: false,
      };
      byKey.set(key, group);
      dated.push(group);
    }

    group.memories.push(memory);
  }

  return unknown.length > 0
    ? [
        ...dated,
        {
          key: "unknown",
          label: "时间未知",
          memories: unknown,
          unknown: true,
        },
      ]
    : dated;
}

export function formatMemoryRowDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";

  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function formatMemoryPaperDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";

  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join(".");
}
