import type { WebApiClient } from "../api/useWebApiClient";
import { WebApiError } from "../api/web-api-error";
import { loadTodoDay, saveTodoPaper } from "./todo-api";
import type { TodoAuthor, TodoEntry, TodoEntryKind } from "./todo-types";

const LEGACY_PREFIX = "leilei.home.todo-paper.v1";
const MARKER_PREFIX = "leilei.home.todo-paper.migration.v1";
const KINDS = new Set<TodoEntryKind>(["pending", "completed", "record"]);

type LegacyTodoAuthor = Exclude<TodoAuthor, "C">;

const LEGACY_HOME_SEED_ENTRIES: Record<
  LegacyTodoAuthor,
  readonly { id: string; author: LegacyTodoAuthor; kind: TodoEntryKind; text: string }[]
> = {
  L: [
    { id: "l-1", author: "L", kind: "pending", text: "整理今天的事情" },
    { id: "l-2", author: "L", kind: "completed", text: "项目视觉方向已经确认" },
    { id: "l-3", author: "L", kind: "record", text: "记录一个不强制完成的小念头" },
    { id: "l-4", author: "L", kind: "record", text: "留一点空白，晚些时候再决定" },
  ],
  G: [
    { id: "g-1", author: "G", kind: "pending", text: "项目下一步：确定侧边栏交互" },
    { id: "g-2", author: "G", kind: "record", text: "明天记得向蕾蕾推进进度展开方式" },
    { id: "g-3", author: "G", kind: "record", text: "准备提醒蕾蕾吃午饭啦" },
    { id: "g-4", author: "G", kind: "record", text: "下一轮继续调整首页细节" },
  ],
};

type TodoMigrationTerminalState = "migrated" | "server-wins" | "invalid";
export type TodoMigrationNotice = { date: string; author: LegacyTodoAuthor; state: "server-wins" };
type LegacyTodoCandidate = { author: LegacyTodoAuthor; date: string; key: string };

export function legacyTodoPaperKey(author: LegacyTodoAuthor, date: string): string {
  return `${LEGACY_PREFIX}:${date}:${author}`;
}
export function legacyTodoMigrationMarkerKey(author: LegacyTodoAuthor, date: string): string {
  return `${MARKER_PREFIX}:${date}:${author}`;
}

export function listLegacyTodoPaperCandidates(storage: Pick<Storage, "length" | "key">): LegacyTodoCandidate[] {
  const pattern = /^leilei\.home\.todo-paper\.v1:(\d{4}-\d{2}-\d{2}):(L|G)$/;
  const result: LegacyTodoCandidate[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    const match = key ? pattern.exec(key) : null;
    if (match) result.push({ date: match[1]!, author: match[2] as LegacyTodoAuthor, key: key! });
  }
  return result.sort((a, b) => a.key.localeCompare(b.key));
}

function sameEntries(a: unknown, b: readonly { id: string; author: string; kind: string; text: string }[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isKnownLegacyHomeSeed(raw: string, author: LegacyTodoAuthor): boolean {
  try {
    return sameEntries(JSON.parse(raw) as unknown, LEGACY_HOME_SEED_ENTRIES[author]);
  } catch {
    return false;
  }
}

export function parseLegacyTodoPaper(raw: string, author: LegacyTodoAuthor): { author: LegacyTodoAuthor; entries: TodoEntry[] } | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (sameEntries(parsed, LEGACY_HOME_SEED_ENTRIES[author])) return null;
    if (!Array.isArray(parsed)) return null;
    const seen = new Set<string>();
    const entries: TodoEntry[] = [];
    for (const value of parsed) {
      if (!value || typeof value !== "object") return null;
      const row = value as Record<string, unknown>;
      if (row.author !== author || typeof row.id !== "string" || !row.id.trim() || typeof row.kind !== "string" || !KINDS.has(row.kind as TodoEntryKind) || typeof row.text !== "string") return null;
      const id = row.id.trim();
      const text = row.text.trim();
      if (!text) continue;
      if (seen.has(id)) return null;
      seen.add(id);
      entries.push({ id, kind: row.kind as TodoEntryKind, text });
    }
    return { author, entries };
  } catch {
    return null;
  }
}

function mark(storage: Storage, author: LegacyTodoAuthor, date: string, state: TodoMigrationTerminalState): void {
  storage.setItem(legacyTodoMigrationMarkerKey(author, date), JSON.stringify({ state }));
}

export async function migrateLegacyTodoPapers(input: { storage: Storage; api: WebApiClient; onNotice?: (notice: TodoMigrationNotice) => void }): Promise<void> {
  const candidates = listLegacyTodoPaperCandidates(input.storage);
  const dates = [...new Set(candidates.map((candidate) => candidate.date))];
  for (const date of dates) {
    let day;
    try { day = await loadTodoDay(input.api, date); } catch { continue; }
    for (const candidate of candidates.filter((item) => item.date === date)) {
      if (input.storage.getItem(legacyTodoMigrationMarkerKey(candidate.author, date))) continue;
      const raw = input.storage.getItem(candidate.key);
      if (raw === null) continue;
      if (day.papers[candidate.author]) {
        mark(input.storage, candidate.author, date, "server-wins");
        input.storage.removeItem(candidate.key);
        input.onNotice?.({ date, author: candidate.author, state: "server-wins" });
        continue;
      }
      if (isKnownLegacyHomeSeed(raw, candidate.author)) {
        mark(input.storage, candidate.author, date, "migrated");
        input.storage.removeItem(candidate.key);
        continue;
      }
      const parsed = parseLegacyTodoPaper(raw, candidate.author);
      if (!parsed) { mark(input.storage, candidate.author, date, "invalid"); continue; }
      try {
        await saveTodoPaper(input.api, { date, author: candidate.author, revision: null, entries: parsed.entries });
        mark(input.storage, candidate.author, date, "migrated");
        input.storage.removeItem(candidate.key);
      } catch (error) {
        if (error instanceof WebApiError && error.status === 409) {
          mark(input.storage, candidate.author, date, "server-wins");
          input.storage.removeItem(candidate.key);
          input.onNotice?.({ date, author: candidate.author, state: "server-wins" });
        }
        // network and server errors stay retryable and leave the raw key untouched
      }
    }
  }
}
