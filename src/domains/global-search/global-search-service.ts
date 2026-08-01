import { createHash } from "node:crypto";
import type { GlobalSearchCursorTuple, GlobalSearchMatchReason, GlobalSearchMode, GlobalSearchModule, GlobalSearchRepository, GlobalSearchScope, GlobalSearchTimeBasis } from "./global-search-repository.js";

const MODULES = ["memory", "diary", "task"] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export type GlobalSearchInput = { userId: string; query: string; modules?: readonly string[]; scope?: string; mode?: string; date_from?: string; date_to?: string; limit?: number; cursor?: string };
export type GlobalSearchResult = { results: Array<{ entity_type: GlobalSearchModule; entity_id: string; stable_name: string; snippet: string; matched_field: string; match_reason: GlobalSearchMatchReason; lifecycle_status: "active" | "archived"; business_time: string; time_basis: GlobalSearchTimeBasis; updated_at: string; detail_tool: "get_memory" | "get_diary" | "get_task"; detail_arguments: { id: string; scope: "active" | "archived" } }>; metadata: { count: number; has_more: boolean; next_cursor: string | null; searched_modules: GlobalSearchModule[]; searched_scope: GlobalSearchScope } };
export type GlobalSearchErrorCode = "INVALID_GLOBAL_SEARCH" | "USER_NOT_FOUND" | "USER_DISABLED";
export class GlobalSearchError extends Error { constructor(readonly code: GlobalSearchErrorCode, message: string) { super(message); this.name = "GlobalSearchError"; } }

export class GlobalSearchService {
  constructor(private readonly repository: GlobalSearchRepository) {}
  async search(input: GlobalSearchInput): Promise<GlobalSearchResult> {
    const user = await this.repository.findUser(input.userId);
    if (!user) throw new GlobalSearchError("USER_NOT_FOUND", "Search is unavailable.");
    if (user.status !== "active") throw new GlobalSearchError("USER_DISABLED", "Search is unavailable.");
    const query = normalizeRequired(input.query, 200);
    const modules = normalizeModules(input.modules);
    const scope = enumValue(input.scope ?? "active", ["active", "archived", "all"] as const);
    const mode = enumValue(input.mode ?? "normal", ["phrase", "normal"] as const);
    const dateFrom = validDate(input.date_from); const dateTo = validDate(input.date_to);
    if (dateFrom && dateTo && dateFrom > dateTo) invalid();
    const limit = input.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) invalid();
    const fingerprint = hashRequest({ query, modules, scope, mode, dateFrom, dateTo });
    const after = decodeCursor(input.cursor, fingerprint);
    const rows = await this.repository.search({ userId: input.userId, query, modules, scope, mode, dateFrom, dateTo, timezone: user.timezone, limit: limit + 1, after });
    const hasMore = rows.length > limit; const page = rows.slice(0, limit);
    const last = page.at(-1);
    return { results: page.map((row) => ({ entity_type: row.entityType, entity_id: row.entityId, stable_name: row.stableName, snippet: snippet(row.matchedValue, query), matched_field: row.matchedField, match_reason: row.matchReason, lifecycle_status: row.lifecycleStatus, business_time: row.businessTime.toISOString(), time_basis: row.timeBasis, updated_at: row.updatedAt.toISOString(), detail_tool: ({ memory: "get_memory", diary: "get_diary", task: "get_task" } as const)[row.entityType], detail_arguments: { id: row.entityId, scope: row.lifecycleStatus } })), metadata: { count: page.length, has_more: hasMore, next_cursor: hasMore && last ? encodeCursor(fingerprint, { rank: last.rank, businessTime: last.businessTime.toISOString(), updatedAt: last.updatedAt.toISOString(), entityType: last.entityType, entityId: last.entityId }) : null, searched_modules: modules, searched_scope: scope } };
  }
}
function invalid(): never { throw new GlobalSearchError("INVALID_GLOBAL_SEARCH", "The global search request is invalid."); }
function normalizeRequired(value: unknown, max: number): string { if (typeof value !== "string") return invalid(); const v=value.normalize("NFC").trim(); if (!v || [...v].length>max) invalid(); return v; }
function normalizeModules(values?: readonly string[]): GlobalSearchModule[] { if (values===undefined) return [...MODULES]; if (!Array.isArray(values)||values.length===0) invalid(); const unique=[...new Set(values)]; if (unique.some((v)=>!MODULES.includes(v as GlobalSearchModule))) invalid(); return MODULES.filter((v)=>unique.includes(v)); }
function enumValue<T extends string>(value: string, allowed: readonly T[]): T { if (!allowed.includes(value as T)) invalid(); return value as T; }
function validDate(value?: string): string|undefined { if (value===undefined) return undefined; if (!DATE.test(value)||Number.isNaN(Date.parse(`${value}T00:00:00Z`))||new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value) invalid(); return value; }
function hashRequest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function encodeCursor(fingerprint:string, tuple:GlobalSearchCursorTuple):string { return Buffer.from(JSON.stringify({v:1,f:fingerprint,t:tuple})).toString("base64url"); }
function decodeCursor(cursor:string|undefined,fingerprint:string):GlobalSearchCursorTuple|undefined { if (!cursor) return undefined; if (cursor.length>1200) invalid(); try { const p=JSON.parse(Buffer.from(cursor,"base64url").toString("utf8")); if(p.v!==1||p.f!==fingerprint||!p.t||![1,2,3,4].includes(p.t.rank)||!MODULES.includes(p.t.entityType)||typeof p.t.entityId!=="string"||Number.isNaN(Date.parse(p.t.businessTime))||Number.isNaN(Date.parse(p.t.updatedAt))) invalid(); return p.t; } catch { return invalid(); } }
function snippet(value:string, query:string):string { const normalized=value.normalize("NFC"); const flexible=query.normalize("NFC").replace(/[.*+?^${}()|[\]\\]/gu,"\\$&").replace(/\s+/gu,"\\s+"); const match=new RegExp(flexible,"iu").exec(normalized); const charAt=match?[...normalized.slice(0,match.index)].length:0; const chars=[...value]; const start=Math.max(0,charAt-80); const end=Math.min(chars.length,start+240); return `${start>0?"…":""}${chars.slice(start,end).join("")}${end<chars.length?"…":""}`; }
