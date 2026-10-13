import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const mindList = readFileSync("ios/LeileiOS/LeileiOS/Pages/Mind/MindKindList.swift", "utf8");
const diaryTitle = readFileSync("ios/LeileiOS/LeileiOS/Pages/Diary/DiaryListPresentation.swift", "utf8");
const mindModels = readFileSync("ios/LeileiOS/LeileiOS/Infrastructure/API/Mind/MindModels.swift", "utf8");

test("Mind reuses the centered Diary title and the server count, never page length", () => {
  assert.match(diaryTitle, /struct DiaryNavigationTitle: View/u);
  assert.match(diaryTitle, /\.hidden\(\)/u);
  assert.match(mindList, /ToolbarItem\(placement: \.principal\)\s*\{\s*DiaryNavigationTitle\(title: "Mind", count: totalCount\)/u);
  assert.match(mindList, /@State private var totalCount: Int\?/u);
  assert.match(mindList, /totalCount = page\.totalCount/u);
  assert.doesNotMatch(mindList, /totalCount\s*=\s*(?:items|searchRows)\.count/u);
  assert.match(mindModels, /struct MindProductPage[\s\S]*?let totalCount: Int\?/u);
});

test("Swift Mind page decoding handles both new and older list responses", { skip: process.platform !== "darwin" }, () => {
  const directory = mkdtempSync(join(tmpdir(), "mind-title-count-swift-"));
  try {
    writeFileSync(join(directory, "main.swift"), `
import Foundation
let decoder = JSONDecoder()
let newPage = try decoder.decode(MindProductPage.self, from: Data(#"{"items":[],"nextCursor":null,"totalCount":237}"#.utf8))
precondition(newPage.totalCount == 237)
let oldPage = try decoder.decode(MindProductPage.self, from: Data(#"{"items":[],"nextCursor":null}"#.utf8))
precondition(oldPage.totalCount == nil)
let emptyPage = try decoder.decode(MindProductPage.self, from: Data(#"{"items":[],"nextCursor":null,"totalCount":0}"#.utf8))
precondition(emptyPage.totalCount == 0)
print("PASS")
`);
    execFileSync("swiftc", [
      "-module-cache-path", join(directory, "cache"),
      "ios/LeileiOS/LeileiOS/Infrastructure/API/Mind/MindModels.swift",
      join(directory, "main.swift"), "-o", join(directory, "check"),
    ], { timeout: 120_000 });
    assert.match(execFileSync(join(directory, "check"), { encoding: "utf8", timeout: 10_000 }), /PASS/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
