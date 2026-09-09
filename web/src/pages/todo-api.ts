import type { WebApiClient } from "../api/useWebApiClient";
import type { TodoAuthor, TodoDay, TodoEntry, TodoPaper } from "./todo-types";

export type TodoSearchEntry = {
  entry_id: string;
  date: string;
  author: TodoAuthor;
  kind: TodoEntry["kind"];
  text: string;
  snippet: string;
};

type Envelope<T> = { success: true; data: T };
export async function loadTodoDay(api: WebApiClient, date: string, signal?: AbortSignal): Promise<TodoDay> {
  const response = await api.request<Envelope<TodoDay>>(`/todo/${encodeURIComponent(date)}`, signal ? { signal } : undefined);
  return response.data;
}
export async function listTodoDates(api: WebApiClient, signal?: AbortSignal): Promise<string[]> {
  const response = await api.request<Envelope<{ dates: string[] }>>("/todo/dates", signal ? { signal } : undefined);
  return response.data.dates;
}
export async function searchTodo(api: WebApiClient, query: string, signal?: AbortSignal): Promise<{ entries: TodoSearchEntry[]; metadata: { count: number; author: TodoAuthor | null } }> {
  const params = new URLSearchParams({ query });
  const response = await api.request<Envelope<{ entries: TodoSearchEntry[]; metadata: { count: number; author: TodoAuthor | null } }>>(`/todo/search?${params.toString()}`, signal ? { signal } : undefined);
  return response.data;
}
export async function saveTodoPaper(api: WebApiClient, input: { date: string; author: TodoAuthor; revision: number | null; entries: TodoEntry[] }): Promise<TodoPaper> {
  const response = await api.request<Envelope<TodoPaper>>(`/todo/${encodeURIComponent(input.date)}/${input.author}`, {
    method: "PUT",
    body: JSON.stringify({ revision: input.revision, entries: input.entries }),
  });
  return response.data;
}
