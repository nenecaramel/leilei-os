import type { TodoEntry } from "./todo-types";

export type EditableTodoRow = TodoEntry & { creation?: boolean };

export function normalizeRows(rows: readonly EditableTodoRow[]): TodoEntry[] {
  return rows
    .map(({ id, kind, text }) => ({ id, kind, text: text.trim() }))
    .filter((entry) => entry.text.length > 0);
}

export function withText(
  row: EditableTodoRow,
  text: string,
): EditableTodoRow {
  return {
    ...row,
    text,
    creation: text.trim().length === 0 ? (row.creation ?? true) : undefined,
  };
}

export function splitTodoText(text: string, start: number, end: number) {
  return { before: text.slice(0, start), after: text.slice(end) };
}

export function splitPastedTodoLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

export function planTodoPaste(text: string, start: number, end: number, lines: string[]) {
  const prefix = text.slice(0, start);
  const suffix = text.slice(end);
  return {
    first: prefix + (lines[0] ?? ""),
    following: lines.slice(1).map((line, index, rest) =>
      index === rest.length - 1 ? line + suffix : line
    ),
    caretOffset: (lines.at(-1) ?? "").length,
  };
}

export function mergeTodoRows(
  rows: readonly EditableTodoRow[],
  index: number,
  direction: "previous" | "next",
): { rows: EditableTodoRow[]; caret: { rowId: string; offset: number } } | null {
  if (direction === "previous" && index <= 0) return null;
  const leftIndex = direction === "previous" ? index - 1 : index;
  const left = rows[leftIndex];
  const right = rows[leftIndex + 1];
  if (!left || !right) return null;
  if (direction === "next" && right.creation && right.text.length === 0) return null;
  const next = [...rows];
  next[leftIndex] = withText(left, left.text + right.text);
  next.splice(leftIndex + 1, 1);
  return { rows: next, caret: { rowId: left.id, offset: left.text.length } };
}
