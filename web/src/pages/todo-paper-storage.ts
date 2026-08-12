import type { TodoAuthor, TodoEntryKind } from "./todo-types";

type LegacyTodoStoredEntry = {
  id: string;
  author: TodoAuthor;
  kind: TodoEntryKind;
  text: string;
};

const STORAGE_PREFIX = "leilei.home.todo-paper.v1";
const KINDS = new Set<TodoEntryKind>(["pending", "completed", "record"]);

const twoDigits = (value: number) => String(value).padStart(2, "0");

export function formatTodoStorageDate(date: Date): string {
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
}

export function formatTodoPaperDate(date: Date): string {
  return formatTodoStorageDate(date).replaceAll("-", ".");
}

export function todoPaperStorageKey(author: TodoAuthor, dateKey: string): string {
  return `${STORAGE_PREFIX}:${dateKey}:${author}`;
}

function isLegacyTodoStoredEntry(value: unknown, author: TodoAuthor): value is LegacyTodoStoredEntry {
  if (!value || typeof value !== "object") return false;
  const note = value as Partial<LegacyTodoStoredEntry>;
  return (
    typeof note.id === "string" &&
    note.id.length > 0 &&
    note.author === author &&
    typeof note.kind === "string" &&
    KINDS.has(note.kind as TodoEntryKind) &&
    typeof note.text === "string"
  );
}

export function normalizeTodoPaperEntries(entries: readonly LegacyTodoStoredEntry[]): LegacyTodoStoredEntry[] {
  return entries
    .map((entry) => ({ ...entry, text: entry.text.trim() }))
    .filter((entry) => entry.text.length > 0);
}

export function readTodoPaperEntries(
  storage: Pick<Storage, "getItem">,
  author: TodoAuthor,
  dateKey: string,
  seed: readonly LegacyTodoStoredEntry[],
): LegacyTodoStoredEntry[] {
  try {
    const raw = storage.getItem(todoPaperStorageKey(author, dateKey));
    if (raw === null) return seed.map((entry) => ({ ...entry }));

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((entry) => isLegacyTodoStoredEntry(entry, author))) {
      return seed.map((entry) => ({ ...entry }));
    }

    return normalizeTodoPaperEntries(parsed);
  } catch {
    return seed.map((entry) => ({ ...entry }));
  }
}

export function writeTodoPaperEntries(
  storage: Pick<Storage, "setItem">,
  author: TodoAuthor,
  dateKey: string,
  entries: readonly LegacyTodoStoredEntry[],
): void {
  storage.setItem(
    todoPaperStorageKey(author, dateKey),
    JSON.stringify(normalizeTodoPaperEntries(entries)),
  );
}

export function createTodoPaperEntryId(author: TodoAuthor): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `${author.toLowerCase()}-${suffix}`;
}


export function listPersistedTodoPaperDates(
  storage: Pick<Storage, "length" | "key" | "getItem">,
): string[] {
  const candidates = new Set<string>();
  const pattern = /^leilei\.home\.todo-paper\.v1:(\d{4}-\d{2}-\d{2}):(L|G)$/;

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;
    const match = pattern.exec(key);
    if (!match) continue;
    candidates.add(match[1]);
  }

  return [...candidates]
    .filter((dateKey) =>
      (["L", "G"] as const).some(
        (author) => readTodoPaperEntries(storage, author, dateKey, []).length > 0,
      ),
    )
    .sort();
}
