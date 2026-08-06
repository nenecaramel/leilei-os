import type { HomeAuthor, HomeNote, HomeNoteKind } from "./home-prototype-data";

const STORAGE_PREFIX = "leilei.home.todo-paper.v1";
const KINDS = new Set<HomeNoteKind>(["pending", "completed", "record"]);

const twoDigits = (value: number) => String(value).padStart(2, "0");

export function formatTodoStorageDate(date: Date): string {
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
}

export function formatTodoPaperDate(date: Date): string {
  return formatTodoStorageDate(date).replaceAll("-", ".");
}

export function todoPaperStorageKey(author: HomeAuthor, dateKey: string): string {
  return `${STORAGE_PREFIX}:${dateKey}:${author}`;
}

function isHomeNote(value: unknown, author: HomeAuthor): value is HomeNote {
  if (!value || typeof value !== "object") return false;
  const note = value as Partial<HomeNote>;
  return (
    typeof note.id === "string" &&
    note.id.length > 0 &&
    note.author === author &&
    typeof note.kind === "string" &&
    KINDS.has(note.kind as HomeNoteKind) &&
    typeof note.text === "string"
  );
}

export function normalizeTodoPaperEntries(entries: readonly HomeNote[]): HomeNote[] {
  return entries
    .map((entry) => ({ ...entry, text: entry.text.trim() }))
    .filter((entry) => entry.text.length > 0);
}

export function readTodoPaperEntries(
  storage: Pick<Storage, "getItem">,
  author: HomeAuthor,
  dateKey: string,
  seed: readonly HomeNote[],
): HomeNote[] {
  try {
    const raw = storage.getItem(todoPaperStorageKey(author, dateKey));
    if (raw === null) return seed.map((entry) => ({ ...entry }));

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((entry) => isHomeNote(entry, author))) {
      return seed.map((entry) => ({ ...entry }));
    }

    return normalizeTodoPaperEntries(parsed);
  } catch {
    return seed.map((entry) => ({ ...entry }));
  }
}

export function writeTodoPaperEntries(
  storage: Pick<Storage, "setItem">,
  author: HomeAuthor,
  dateKey: string,
  entries: readonly HomeNote[],
): void {
  storage.setItem(
    todoPaperStorageKey(author, dateKey),
    JSON.stringify(normalizeTodoPaperEntries(entries)),
  );
}

export function createTodoPaperEntryId(author: HomeAuthor): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `${author.toLowerCase()}-${suffix}`;
}
