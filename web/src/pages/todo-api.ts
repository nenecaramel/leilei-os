import type { WebApiClient } from "../api/useWebApiClient";
import type { TodoAuthor, TodoDay, TodoEntry, TodoPaper } from "./todo-types";

type Envelope<T> = { success: true; data: T };
export async function loadTodoDay(api: WebApiClient, date: string): Promise<TodoDay> {
  const response = await api.request<Envelope<TodoDay>>(`/todo/${encodeURIComponent(date)}`);
  return response.data;
}
export async function listTodoDates(api: WebApiClient): Promise<string[]> {
  const response = await api.request<Envelope<{ dates: string[] }>>("/todo/dates");
  return response.data.dates;
}
export async function saveTodoPaper(api: WebApiClient, input: { date: string; author: TodoAuthor; revision: number | null; entries: TodoEntry[] }): Promise<TodoPaper> {
  const response = await api.request<Envelope<TodoPaper>>(`/todo/${encodeURIComponent(input.date)}/${input.author}`, {
    method: "PUT",
    body: JSON.stringify({ revision: input.revision, entries: input.entries }),
  });
  return response.data;
}
