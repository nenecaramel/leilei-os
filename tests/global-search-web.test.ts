import assert from "node:assert/strict";
import test from "node:test";
import {
  createGlobalSearchLocation,
  DEFAULT_GLOBAL_SEARCH_FILTERS,
  readGlobalSearchFilters,
  toggleGlobalSearchModule,
} from "../web/src/pages/global-search-location.js";
import {
  createGlobalSearchResultDetailLocation,
  GLOBAL_SEARCH_MODULE_LABELS,
  type GlobalSearchResult,
} from "../web/src/pages/global-search-result.js";

test("Global Search URL state exposes only active modules", () => {
  assert.deepEqual(
    readGlobalSearchFilters(
      "?q=%E2%98%95&modules=diary,todo,conversation&scope=all",
    ),
    {
      ...DEFAULT_GLOBAL_SEARCH_FILTERS,
      q: "☕",
      scope: "all",
    },
  );

  assert.deepEqual(
    readGlobalSearchFilters(
      "?modules=memory,task,shared_paper",
    ),
    DEFAULT_GLOBAL_SEARCH_FILTERS,
  );

  assert.deepEqual(
    Object.keys(GLOBAL_SEARCH_MODULE_LABELS),
    [
      "diary",
      "universe",
      "todo",
      "mind",
    ],
  );
});

test("Global Search URL serialization keeps the compact default module set", () => {
  assert.equal(
    createGlobalSearchLocation(
      DEFAULT_GLOBAL_SEARCH_FILTERS,
    ),
    "/search",
  );

  assert.equal(
    createGlobalSearchLocation({
      ...DEFAULT_GLOBAL_SEARCH_FILTERS,
      q: "计划",
      modules: ["todo"],
      scope: "archived",
      mode: "phrase",
      dateFrom: "2026-08-01",
      dateTo: "",
    }),
    "/search?q=%E8%AE%A1%E5%88%92&modules=todo&scope=archived&mode=phrase&date_from=2026-08-01",
  );
});

test("Global Search module toggles never require retired modules", () => {
  const onlyDiary = {
    ...DEFAULT_GLOBAL_SEARCH_FILTERS,
    modules: ["diary" as const],
  };
  assert.deepEqual(
    toggleGlobalSearchModule(
      onlyDiary,
      "diary",
    ),
    onlyDiary,
  );

  assert.deepEqual(
    toggleGlobalSearchModule(
      {
        ...onlyDiary,
        modules: ["diary", "todo"],
      },
      "diary",
    ).modules,
    ["todo"],
  );
});

function result(
  entity_type: GlobalSearchResult["entity_type"],
): GlobalSearchResult {
  return {
    entity_type,
    entity_id:
      entity_type === "universe"
        ? "node-1"
        : "00000000-0000-4000-8000-000000000001",
    stable_name: "Target",
    snippet: "Target",
    matched_field: "content",
    match_reason: "field_match",
    lifecycle_status: "active",
    business_time:
      "2026-08-01T00:00:00.000Z",
    time_basis:
      entity_type === "todo"
        ? "todo_date"
        : entity_type === "diary"
          ? "diary_date"
          : "updated_at",
    updated_at:
      "2026-08-01T00:00:00.000Z",
    author:
      entity_type === "todo"
        ? "C"
        : null,
    detail_tool:
      entity_type === "diary"
        ? "get_diary"
        : entity_type === "todo"
          ? "read_todo_day"
          : "get_universe_node",
    detail_arguments:
      entity_type === "diary"
        ? {
            id:
              "00000000-0000-4000-8000-000000000001",
            scope: "active",
          }
        : entity_type === "todo"
          ? { date: "2026-08-01" }
          : { id: "node-1" },
  };
}

test("Global Search deep links target active product surfaces", () => {
  const returnTo =
    "/search?q=Target";

  assert.match(
    createGlobalSearchResultDetailLocation(
      result("diary"),
      returnTo,
    ),
    /^\/diary\?/,
  );

  assert.equal(
    createGlobalSearchResultDetailLocation(
      result("todo"),
      returnTo,
    ),
    "/day-space?date=2026-08-01&author=C",
  );

  assert.equal(
    createGlobalSearchResultDetailLocation(
      result("universe"),
      returnTo,
    ),
    "/universe?node=node-1",
  );

});
