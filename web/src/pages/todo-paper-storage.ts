import type { TodoAuthor } from "./todo-types";

const twoDigits = (value: number) =>
  String(value).padStart(2, "0");

export function formatTodoStorageDate(date: Date): string {
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
}

export function formatTodoPaperDate(date: Date): string {
  return formatTodoStorageDate(date).replaceAll("-", ".");
}

export function createTodoPaperEntryId(
  author: TodoAuthor,
): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `${author.toLowerCase()}-${suffix}`;
}
