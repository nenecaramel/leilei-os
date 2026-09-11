export type ContiguousRangeEdit = {
  start: number;
  end: number;
  replacement: string;
};

/** Compute a single code-point range replacement, preserving Unicode offsets. */
export function createContiguousRangeEdit(
  baseline: string,
  draft: string,
): ContiguousRangeEdit | null {
  const before = Array.from(baseline);
  const after = Array.from(draft);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  if (prefix === before.length && prefix === after.length) return null;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  return {
    start: prefix,
    end: before.length - suffix,
    replacement: after.slice(prefix, after.length - suffix).join(""),
  };
}

export function diffText(deleted: string, inserted: string): { deleted: string; inserted: string } {
  const edit = createContiguousRangeEdit(deleted, inserted);
  if (!edit) return { deleted: "", inserted: "" };
  const deletedPoints = Array.from(deleted);
  const insertedPoints = Array.from(inserted);
  let suffix = 0;
  while (suffix < deletedPoints.length - edit.start && suffix < insertedPoints.length - edit.start && deletedPoints[deletedPoints.length - 1 - suffix] === insertedPoints[insertedPoints.length - 1 - suffix]) suffix += 1;
  return {
    deleted: deletedPoints.slice(edit.start, deletedPoints.length - suffix).join(""),
    inserted: insertedPoints.slice(edit.start, insertedPoints.length - suffix).join(""),
  };
}
