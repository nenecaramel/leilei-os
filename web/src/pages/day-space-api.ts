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

export type DaySpaceApi = {
  webClient: WebApiClient;
  listTodoDates(): Promise<string[]>;
  loadTodoDay(date: string): Promise<TodoDay>;
  listDiaryDates(): Promise<string[]>;
  loadDiariesByDate(date: string): Promise<{ date: string; diaries: DaySpaceDiary[] }>;
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
    listTodoDates: () => listTodoDates(api),
    loadTodoDay: (date) => loadTodoDay(api, date),
    async listDiaryDates() {
      const response = await api.request<Envelope<{ dates: string[] }>>("/diary/dates");
      return response.data.dates;
    },
    async loadDiariesByDate(date) {
      const response = await api.request<Envelope<{ date: string; diaries: DaySpaceDiary[] }>>(
        `/diary/by-date/${encodeURIComponent(date)}`,
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
