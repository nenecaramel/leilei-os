import assert from "node:assert/strict";
import test from "node:test";
import {
  createArchivedDiaryDetailLocation,
  createDiaryArchiveLocation,
  getArchivedDiaryDetailLocation,
  getDiaryArchiveLocation,
  getSafeDiaryArchiveReturnTo,
} from "../web/src/pages/diary-location.js";

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
