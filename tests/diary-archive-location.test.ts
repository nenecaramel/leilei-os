import assert from "node:assert/strict";
import test from "node:test";
import {
  createArchivedDiaryDetailLocation,
  createDiaryArchiveLocation,
  getArchivedDiaryDetailLocation,
  getDiaryArchiveLocation,
  getSafeDiaryArchiveReturnTo,
  getSafeDiaryReturnTo,
} from "../web/src/pages/diary-location.js";
import { createUniverseNodeReturnTo, getSafeUniverseNodeReturnTo } from "../web/src/pages/universe/universe-location.js";

test("Diary archive and archived detail URLs preserve a safe active-list return chain", () => {
  const active = "/diary?q=goal&tag=MCP&mood=calm&date_from=2026-07-01";
  const archive = createDiaryArchiveLocation(active);
  assert.deepEqual(
    getDiaryArchiveLocation(new URL(archive, "https://local").search),
    { archived: true, returnTo: active },
  );

  const detail = createArchivedDiaryDetailLocation("diary-1", archive);
  assert.deepEqual(
    getArchivedDiaryDetailLocation(
      new URL(detail, "https://local").search,
    ),
    { diaryId: "diary-1", returnTo: archive },
  );
});

test("Diary archived returnTo rejects external, active-detail, and nested values", () => {
  for (const unsafe of [
    "https://example.com/diary?view=archived",
    "//example.com/diary?view=archived",
    "/diary?diary=active-1",
    "/diary?view=archived&returnTo=/diary&archivedDiary=x",
  ]) {
    assert.equal(
      getSafeDiaryArchiveReturnTo(unsafe),
      createDiaryArchiveLocation("/diary"),
    );
  }
});

test("Universe node return targets are exact same-origin single-key locations", () => {
  const target = createUniverseNodeReturnTo("中文 node 1");
  assert.equal(target, "/universe?node=%E4%B8%AD%E6%96%87+node+1");
  assert.equal(getSafeUniverseNodeReturnTo(target), target);
  for (const unsafe of [
    "https://example.com/universe?node=n1",
    "/universe?node=n1&extra=1",
    "/universe?node=n1&node=n2",
    "/universe?node=",
    "/universe?node=n1#fragment",
    "/diary?node=n1",
  ]) {
    assert.equal(getSafeUniverseNodeReturnTo(unsafe), "/universe");
  }
  assert.equal(getSafeDiaryReturnTo("/universe?node=n1"), "/universe?node=n1");
  assert.equal(getSafeDiaryArchiveReturnTo("/universe?node=n1"), "/universe?node=n1");
});
