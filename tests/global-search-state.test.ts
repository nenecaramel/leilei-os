import assert from "node:assert/strict";
import test from "node:test";
import { decodeSearchSnapshot, keyOf, uniqueResults, groupGlobalSearchResults } from "../web/src/pages/global-search-state.js";
import type { GlobalSearchResult } from "../web/src/pages/global-search-result.js";
const result: GlobalSearchResult = {
  entity_type: "diary", entity_id: "one", stable_name: "First", snippet: "Text",
  matched_field: "content", match_reason: "field_match", lifecycle_status: "active",
  business_time: "2026-08-09", time_basis: "diary_date", updated_at: "2026-08-09",
  author: "C", detail_tool: "get_diary", detail_arguments: { id: "one", scope: "active" },
};
const snapshot = { version: 1 as const, url: "/search?q=day", results: [result], cursor: "page-2", scrollY: 120, focusKey: "diary:one" };
test("Snapshot retains cursor, focus, scroll and object identity for the exact URL", () => {
  assert.equal(decodeSearchSnapshot(snapshot, snapshot.url), snapshot);
  assert.equal(decodeSearchSnapshot({ ...snapshot, cursor: null, focusKey: null, scrollY: -1 }, snapshot.url)?.scrollY, -1);
});
test("Snapshot rejects another URL or version instead of restoring stale results", () => {
  assert.equal(decodeSearchSnapshot(snapshot, "/search?q=other"), null);
  assert.equal(decodeSearchSnapshot({ ...snapshot, version: 2 } as any, snapshot.url), null);
});
test("Snapshot rejects missing and malformed restoration fields", () => {
  for (const candidate of [null, undefined, {}, { ...snapshot, results: {} }, { ...snapshot, cursor: undefined }, { ...snapshot, cursor: 4 }, { ...snapshot, scrollY: NaN }, { ...snapshot, scrollY: Infinity }, { ...snapshot, focusKey: 1 }]) {
    assert.equal(decodeSearchSnapshot(candidate as any, snapshot.url), null);
  }
});
test("Empty snapshot is valid and does not lose the no-more-pages cursor", () => {
  const empty = { ...snapshot, results: [], cursor: null, focusKey: null, scrollY: 0 };
  assert.equal(decodeSearchSnapshot(empty, snapshot.url), empty);
});
test("Overlapping pages replace the last value at the original stable position", () => {
  const second = { ...result, entity_id: "two" };
  const replacement = { ...result, stable_name: "Updated" };
  const input = [result, second, replacement];
  assert.deepEqual(uniqueResults(input), [replacement, second]);
  assert.equal(input.length, 3);
});
test("Equal IDs in different modules remain distinct", () => {
  const todo = { ...result, entity_type: "todo" as const };
  assert.equal(keyOf(todo), "todo:one");
  assert.deepEqual(uniqueResults([result, todo]), [result, todo]);
});
test("Groups follow module order while preserving each module's incoming order", () => {
  const todo = { ...result, entity_type: "todo" as const };
  const universe = { ...result, entity_type: "universe" as const };
  const later = { ...result, entity_id: "later" };
  assert.deepEqual(groupGlobalSearchResults([universe, todo, result, later]), [
    { module: "diary", items: [result, later] }, { module: "todo", items: [todo] }, { module: "universe", items: [universe] },
  ]);
  assert.deepEqual(groupGlobalSearchResults([]), []);
});
