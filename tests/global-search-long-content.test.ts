import assert from "node:assert/strict";
import test from "node:test";
import { GlobalSearchService } from "../src/domains/global-search/global-search-service.js";
import type {
  GlobalSearchRepository,
  GlobalSearchRow,
} from "../src/domains/global-search/global-search-repository.js";

const USER_ID =
  "00000000-0000-4000-8000-000000000901";

class LongContentRepository
implements GlobalSearchRepository {
  async findUser() {
    return {
      status: "active" as const,
      timezone: "Asia/Shanghai",
    };
  }

  async search() {
    return [
      row(
        "diary",
        "00000000-0000-4000-8000-000000000002",
        "Diary 目标",
      ),
      row(
        "universe",
        "节点-中文-901",
        "Universe 目标",
      ),
      {...row("mind", "00000000-0000-4000-8000-000000000003", ""), matchedField: "text" as const, timeBasis: "undated" as const},
    ];
  }
}

function row(
  entityType: GlobalSearchRow["entityType"],
  entityId: string,
  stableName: string,
): GlobalSearchRow {
  return {
    entityType,
    entityId,
    stableName,
    matchedField: "content",
    matchedValue:
      `${"正文 ".repeat(50_000)}目标`,
    matchReason: "field_match",
    lifecycleStatus: "active",
    businessTime:
      new Date("2026-08-25T10:00:00.000Z"),
    timeBasis:
      entityType === "diary"
        ? "diary_date"
        : "updated_at",
    updatedAt:
      new Date("2026-08-25T10:00:00.000Z"),
    rank: 4,
    author:
      entityType === "diary"
        ? "C"
        : null,
  };
}

test("global search keeps long active-module body matches compact and exact-read addressable", async () => {
  const result = await new GlobalSearchService(
    new LongContentRepository(),
  ).search({
    userId: USER_ID,
    query: "目标",
    modules: ["diary", "universe", "mind"],
    scope: "active",
    limit: 25,
  });

  assert.equal(result.results.length, 3);
  for (const item of result.results) {
    assert.equal(
      Object.hasOwn(item, "content"),
      false,
    );
    assert.ok(
      [...item.snippet].length <= 240,
    );
    assert.equal(
      item.snippet.includes("目标"),
      true,
    );
    assert.ok(item.detail_tool);
    assert.ok(item.detail_arguments);
  }
});
