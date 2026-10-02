export type MindProtectedRange = { start: number; end: number };

const RETIRED_WRAPPER_TAG = /<(\/?)(drive|curiosity|topic|dream)>/gi;

/** Complete retired wrappers are opaque text, including nested wrappers. */
export function retiredMindProtectedRanges(source: string): MindProtectedRange[] {
  const openings = new Map<string, number[]>();
  const ranges: MindProtectedRange[] = [];
  for (const match of source.matchAll(RETIRED_WRAPPER_TAG)) {
    const kind = match[2]!.toLowerCase();
    const stack = openings.get(kind) ?? [];
    if (!match[1]) {
      stack.push(match.index);
      openings.set(kind, stack);
      continue;
    }
    const start = stack.pop();
    if (start !== undefined) {
      ranges.push({ start, end: match.index + match[0].length });
    }
  }

  const merged: MindProtectedRange[] = [];
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export function overlapsMindProtectedRange(
  ranges: readonly MindProtectedRange[],
  start: number,
  end: number,
): boolean {
  return ranges.some((range) => start < range.end && end > range.start);
}

/** Keep the existing prose cleanup, but preserve opaque wrapper bytes. */
export function normalizeMindVisibleText(source: string): string {
  const clean = (text: string) => text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  let visible = "";
  let cursor = 0;
  for (const range of retiredMindProtectedRanges(source)) {
    visible += clean(source.slice(cursor, range.start));
    visible += source.slice(range.start, range.end);
    cursor = range.end;
  }
  return (visible + clean(source.slice(cursor))).trim();
}
