import type { TodoDay } from "./todo-types";
import type { DaySpaceDiary } from "./day-space-api";

export type DiscoveryResult = {
  todo: { status: "success"; dates: string[] } | { status: "error" };
  diary: { status: "success"; dates: string[] } | { status: "error" };
};

export type ResolvedDaySpaceDate =
  | { status: "ready"; date: string; discoveryIncomplete: boolean }
  | { status: "error" };

function latest(values: readonly string[]): string | null {
  const valid = values.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)).sort();
  return valid.at(-1) ?? null;
}

export function resolveDaySpaceDefaultDate(
  result: DiscoveryResult,
  today: string,
): ResolvedDaySpaceDate {
  const todoOk = result.todo.status === "success";
  const diaryOk = result.diary.status === "success";
  if (!todoOk && !diaryOk) return { status: "error" };
  const todoDates = result.todo.status === "success" ? result.todo.dates : [];
  const diaryDates = result.diary.status === "success" ? result.diary.dates : [];
  const date = latest([...todoDates, ...diaryDates]) ?? today;
  return { status: "ready", date, discoveryIncomplete: !(todoOk && diaryOk) };
}

export type DaySpaceModuleState<T> =
  | { status: "loading"; value?: T }
  | { status: "ready"; value: T }
  | { status: "error"; value?: T; needsRetry?: boolean };

export function visibleTodoPapers(day: TodoDay) {
  return (["L", "G"] as const).flatMap((author) => {
    const paper = day.papers[author];
    return paper && paper.entries.length > 0 ? [paper] : [];
  });
}

export function composeDaySpacePapers(
  date: string,
  todo: TodoDay,
  diaries: readonly DaySpaceDiary[],
) {
  return [
    ...visibleTodoPapers(todo).map((paper) => ({ type: "todo" as const, id: `todo:${date}:${paper.author}`, paper })),
    ...diaries.map((diary) => ({ type: "diary" as const, id: `diary:${diary.id}`, diary })),
  ];
}
