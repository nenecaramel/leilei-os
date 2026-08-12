import type { WebApiClient } from "../api/useWebApiClient";
import type { PaperAuthorValue } from "./PaperAuthorSignature";
import { loadTodoDay, listTodoDates } from "./todo-api";
import type { TodoDay } from "./todo-types";

export type DaySpaceDiary = {
  id: string;
  title: string;
  content: string;
  date: string;
  author: PaperAuthorValue;
  tags: string[];
  mood: string | null;
  created_at: string;
  updated_at: string;
};

type Envelope<T> = { success: true; data: T };

export async function listDiaryDates(api: WebApiClient, signal?: AbortSignal): Promise<string[]> {
  const response = await api.request<Envelope<{ dates: string[] }>>(
    "/diary/dates",
    signal ? { signal } : undefined,
  );
  return response.data.dates;
}

export type DaySpaceApi = {
  webClient: WebApiClient;
  listTodoDates(signal?: AbortSignal): Promise<string[]>;
  loadTodoDay(date: string, signal?: AbortSignal): Promise<TodoDay>;
  listDiaryDates(signal?: AbortSignal): Promise<string[]>;
  loadDiariesByDate(date: string, signal?: AbortSignal): Promise<{ date: string; diaries: DaySpaceDiary[] }>;
  updateDiary(input: {
    id: string;
    title: string;
    content: string;
    author: Exclude<PaperAuthorValue, null>;
    date: string;
    tags: string[];
    mood: string | null;
  }): Promise<DaySpaceDiary>;
};

export function createDaySpaceApi(api: WebApiClient): DaySpaceApi {
  return {
    webClient: api,
    listTodoDates: (signal) => listTodoDates(api, signal),
    loadTodoDay: (date, signal) => loadTodoDay(api, date, signal),
    listDiaryDates: (signal) => listDiaryDates(api, signal),
    async loadDiariesByDate(date, signal) {
      const response = await api.request<Envelope<{ date: string; diaries: DaySpaceDiary[] }>>(
        `/diary/by-date/${encodeURIComponent(date)}`,
        signal ? { signal } : undefined,
      );
      return response.data;
    },
    async updateDiary(input) {
      const response = await api.request<Envelope<DaySpaceDiary>>(`/diary/${encodeURIComponent(input.id)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
      return response.data;
    },
  };
}
