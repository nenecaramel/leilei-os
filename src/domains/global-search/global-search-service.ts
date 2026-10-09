import { createHash } from "node:crypto";
import type { ContentAuthor } from "../content-author.js";
import { createSearchSnippet, MAX_SEARCH_SNIPPET_CODE_POINTS } from "../search/search-text.js";
import type {
  GlobalSearchCursorTuple,
  GlobalSearchMatchedField,
  GlobalSearchMatchReason,
  GlobalSearchModule,
  GlobalSearchRepository,
  GlobalSearchRow,
  GlobalSearchScope,
  GlobalSearchTimeBasis,
} from "./global-search-repository.js";

const DEFAULT_MODULES = ["diary", "todo", "universe", "mind"] as const;
const MODULES = DEFAULT_MODULES;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURSOR_BASE64URL = /^[A-Za-z0-9_-]+$/;
const CURSOR_FINGERPRINT = /^[0-9a-f]{64}$/;
const CURSOR_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CURSOR_ENCODED_LENGTH = 2800;
const MAX_CURSOR_DECODED_BYTES = 2000;

export type GlobalSearchInput = {
  userId: string;
  query: string;
  modules?: readonly string[];
  scope?: string;
  mode?: string;
  author?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  cursor?: string;
};

export type GlobalSearchItem = {
  entity_type: GlobalSearchModule;
  entity_id: string;
  stable_name: string;
  snippet: string;
  matched_field: GlobalSearchMatchedField;
  match_reason: GlobalSearchMatchReason;
  lifecycle_status: "active" | "archived";
  business_time: string | null;
  time_basis: GlobalSearchTimeBasis;
  updated_at: string;
  author: ContentAuthor | null;
  detail_tool: "get_diary" | "read_todo_day" | "get_universe_node" | "get_memory" | null;
  detail_arguments:
    | { id: string; scope: "active" | "archived" }
    | { id: string }
    | { date: string }
    | null;
};

export type GlobalSearchResult = {
  results: GlobalSearchItem[];
  metadata: {
    count: number;
    has_more: boolean;
    next_cursor: string | null;
    searched_modules: GlobalSearchModule[];
    searched_scope: GlobalSearchScope;
    searched_author: ContentAuthor | null;
  };
};

export type GlobalSearchErrorCode = "INVALID_GLOBAL_SEARCH" | "USER_NOT_FOUND" | "USER_DISABLED";
export class GlobalSearchError extends Error {
  constructor(readonly code: GlobalSearchErrorCode, message: string) {
    super(message);
    this.name = "GlobalSearchError";
  }
}

export class GlobalSearchService {
  constructor(private readonly repository: GlobalSearchRepository) {}

  async search(input: GlobalSearchInput): Promise<GlobalSearchResult> {
    // Every client-controlled field, including the cursor, is normalized before
    // even the user lookup can touch PostgreSQL.
    const query = normalizeRequired(input.query, 200);
    const modules = normalizeModules(input.modules);
    const scope = enumValue(input.scope ?? "active", ["active", "archived", "all"] as const);
    const mode = enumValue(input.mode ?? "normal", ["phrase", "normal"] as const);
    const author = input.author === undefined
      ? undefined
      : enumValue(input.author, ["L", "G", "C"] as const);
    const dateFrom = validDate(input.date_from);
    const dateTo = validDate(input.date_to);
    if (dateFrom && dateTo && dateFrom > dateTo) invalid();
    const limit = input.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) invalid();
    const fingerprint = hashRequest({ query, modules, scope, mode, author, dateFrom, dateTo });
    const after = decodeCursor(input.cursor, fingerprint);

    const user = await this.repository.findUser(input.userId);
    if (!user) throw new GlobalSearchError("USER_NOT_FOUND", "Search is unavailable.");
    if (user.status !== "active") throw new GlobalSearchError("USER_DISABLED", "Search is unavailable.");
    const rows = await this.repository.search({
      userId: input.userId,
      query,
      modules,
      scope,
      mode,
      author,
      dateFrom,
      dateTo,
      timezone: user.timezone,
      limit: limit + 1,
      after,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      results: page.map((row) => ({
        entity_type: row.entityType,
        entity_id: row.entityId,
        stable_name: row.stableName,
        snippet: createGlobalSearchSnippet(row.matchedValue, query),
        matched_field: row.matchedField,
        match_reason: row.matchReason,
        lifecycle_status: row.lifecycleStatus,
        business_time: row.timeBasis === "undated" ? null : row.businessTime.toISOString(),
        time_basis: row.timeBasis,
        updated_at: row.updatedAt.toISOString(),
        author: row.author,
        detail_tool: detailTool(row.entityType),
        detail_arguments: detailArguments(row),
      })),
      metadata: {
        count: page.length,
        has_more: hasMore,
        next_cursor: hasMore && last
          ? encodeCursor(fingerprint, {
              rank: last.rank,
              businessTime: last.businessTime.toISOString(),
              updatedAt: last.updatedAt.toISOString(),
              entityType: last.entityType,
              entityId: last.entityId,
            })
          : null,
        searched_modules: modules,
        searched_scope: scope,
        searched_author: author ?? null,
      },
    };
  }
}

function detailTool(
  entityType: GlobalSearchModule,
): GlobalSearchItem["detail_tool"] {
  if (entityType === "universe") return "get_universe_node";
  if (entityType === "mind") return "get_memory";
  if (entityType === "todo") return "read_todo_day";
  return "get_diary";
}

function detailArguments(
  row: GlobalSearchRow,
): GlobalSearchItem["detail_arguments"] {
  if (row.entityType === "universe" || row.entityType === "mind") {
    return { id: row.entityId };
  }
  if (row.entityType === "todo") return todoDetailArguments(row);
  return { id: row.entityId, scope: row.lifecycleStatus };
}

function todoDetailArguments(row: GlobalSearchRow): { date: string } {
  const date = row.businessDate;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    throw new Error("Global Search Todo row is missing its business date.");
  }
  return { date };
}

function invalid(): never {
  throw new GlobalSearchError("INVALID_GLOBAL_SEARCH", "The global search request is invalid.");
}

function normalizeRequired(value: unknown, max: number): string {
  if (typeof value !== "string") return invalid();
  const normalized = value.normalize("NFC").trim();
  if (!normalized || [...normalized].length > max) invalid();
  return normalized;
}

function normalizeModules(values?: readonly string[]): GlobalSearchModule[] {
  if (values === undefined) return [...DEFAULT_MODULES];
  if (!Array.isArray(values) || values.length === 0) invalid();
  const unique = [...new Set(values)];
  if (unique.some((value) => typeof value !== "string" || !MODULES.includes(value as GlobalSearchModule))) invalid();
  return MODULES.filter((value) => unique.includes(value));
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) invalid();
  return value as T;
}

function validDate(value?: string): string | undefined {
  if (value === undefined) return undefined;
  if (!DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) invalid();
  return value;
}

function hashRequest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function encodeCursor(fingerprint: string, tuple: GlobalSearchCursorTuple): string {
  return Buffer.from(JSON.stringify({ v: 1, f: fingerprint, t: tuple })).toString("base64url");
}

function isExactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function validCursorInstant(value: unknown): value is string {
  return typeof value === "string"
    && value.length === 24
    && CURSOR_INSTANT.test(value)
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function validUniverseEntityId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim().length > 0;
}

function decodeCursor(cursor: string | undefined, fingerprint: string): GlobalSearchCursorTuple | undefined {
  if (cursor === undefined) return undefined;
  if (!cursor || cursor.length > MAX_CURSOR_ENCODED_LENGTH || !CURSOR_BASE64URL.test(cursor)) invalid();
  try {
    const bytes = Buffer.from(cursor, "base64url");
    if (bytes.length === 0 || bytes.length > MAX_CURSOR_DECODED_BYTES || bytes.toString("base64url") !== cursor) invalid();
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    if (!isExactObject(parsed, ["v", "f", "t"])) invalid();
    if (parsed.v !== 1 || typeof parsed.f !== "string" || !CURSOR_FINGERPRINT.test(parsed.f) || parsed.f !== fingerprint) invalid();
    if (!isExactObject(parsed.t, ["rank", "businessTime", "updatedAt", "entityType", "entityId"])) invalid();
    const tuple = parsed.t;
    if (!Number.isInteger(tuple.rank) || (tuple.rank as number) < 1 || (tuple.rank as number) > 4) invalid();
    if (!validCursorInstant(tuple.businessTime) || !validCursorInstant(tuple.updatedAt)) invalid();
    if (typeof tuple.entityType !== "string" || !MODULES.includes(tuple.entityType as GlobalSearchModule)) invalid();
    if (tuple.entityType === "universe") {
      if (!validUniverseEntityId(tuple.entityId)) invalid();
    } else if (typeof tuple.entityId !== "string" || !UUID.test(tuple.entityId)) {
      invalid();
    }
    return tuple as GlobalSearchCursorTuple;
  } catch {
    return invalid();
  }
}

export function createGlobalSearchSnippet(value: string, query: string): string {
  return createSearchSnippet(value, query, MAX_SEARCH_SNIPPET_CODE_POINTS, "Global search repository returned a non-matching snippet source.");
}
