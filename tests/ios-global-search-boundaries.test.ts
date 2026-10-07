import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";

const pages = "ios/LeileiOS/LeileiOS/Pages/";
const root = fs.readFileSync(`${pages}GlobalSearchView.swift`, "utf8");
const read = (name: string) => fs.readFileSync(`${pages}GlobalSearch/${name}.swift`, "utf8");

test("Global Search entry remains coordinator-sized with presentation extracted", () => {
  assert.ok(root.trimEnd().split("\n").length <= 300);
  assert.match(root, /struct GlobalSearchView: View/);
  assert.match(root, /private extension GlobalSearchView \{\s*enum SearchState/);
  assert.doesNotMatch(root, /(?:struct|enum) GlobalSearch(?:ResultsList|ResultRow|ResultGroup|CustomDateRangeSheet|Date)\b/);
  assert.match(read("GlobalSearchResults"), /struct GlobalSearchResultsList: View/);
  assert.match(read("GlobalSearchResultRow"), /struct GlobalSearchResultRow: View/);
  assert.match(read("GlobalSearchDateRange"), /struct GlobalSearchCustomDateRangeSheet: View/);
});

test("Search task ownership, debounce, normalization and cancellation stay in the root", () => {
  for (const name of ["query", "modules", "scope", "mode", "author", "state", "searchTask", "loadMoreTask", "isLoadingMore", "loadMoreFailed"]) {
    assert.match(root, new RegExp(`@State private var ${name}\\b`));
  }
  assert.match(root, /Task\.sleep\(for: \.milliseconds\(300\)\)/);
  assert.match(root, /normalizedQuery\.unicodeScalars\.count <= 200/);
  assert.match(root, /\.precomposedStringWithCanonicalMapping/);
  assert.match(root, /guard let request = currentRequest else \{\s*state = \.idle/);
  assert.match(root, /\.onDisappear \{\s*searchTask\?\.cancel\(\)\s*loadMoreTask\?\.cancel\(\)/);
  for (const value of ["query", "modules", "timePreset", "scope", "mode", "author"]) {
    assert.match(root, new RegExp(`\\.onChange\\(of: ${value}\\)`));
  }
  assert.match(root, /catch is CancellationError/);
  assert.match(root, /guard !Task\.isCancelled else \{ return \}/);
});

test("Root retains complete request construction, custom date boundaries and pagination identity", () => {
  assert.match(root, /private var currentRequest: GlobalSearchRequest\?/);
  assert.match(root, /GlobalSearchRequest\(\s*query: trimmedQuery,\s*modules: modules,\s*scope: scope,\s*mode: mode,\s*author: author,\s*dateFrom: dateRange.dateFrom,\s*dateTo: dateRange.dateTo/);
  assert.match(root, /timePreset\.dateRange\(\)/);
  assert.match(root, /Locale\(identifier: "en_US_POSIX"\)/);
  assert.match(root, /formatter\.timeZone = \.current/);
  assert.match(root, /formatter\.dateFormat = "yyyy-MM-dd"/);
  assert.match(root, /cursor: cursor/);
  assert.match(root, /uniqueResults\(existing \+ next.results\)/);
  assert.match(root, /seen\.insert\(\$0\.id\)\.inserted/);
  assert.match(root, /nextCursor: next.nextCursor/);
  assert.match(root, /loadMoreFailed = true/);
});

test("Results keep module order, retry presentation and navigation callbacks without async ownership", () => {
  const results = read("GlobalSearchResults");
  const rows = read("GlobalSearchResultRow");
  assert.match(results, /GlobalSearchModule\.allCases\.compactMap/);
  assert.match(results, /private struct GlobalSearchResultGroup/);
  assert.match(results, /if response.nextCursor != nil/);
  assert.match(results, /loadMoreFailed\s*\? "Retry"\s*: "More"/);
  assert.match(results, /\.disabled\(isLoadingMore\)/);
  for (const callback of ["onOpenDiary", "onOpenDaySpace", "onOpenUniverseNode"]) {
    assert.match(rows, new RegExp(`${callback}\\(`));
  }
  assert.match(rows, /result.detailArguments\?\["id"\]\s*\?\? result.entityID/);
  assert.match(rows, /result.detailArguments\?\["scope"\]\s*\?\? result.lifecycleStatus/);
  assert.match(rows, /result.detailArguments\?\["date"\]/);
  assert.match(rows, /private enum GlobalSearchDate/);
  for (const name of ["GlobalSearchResults", "GlobalSearchResultRow", "GlobalSearchDateRange"]) {
    const source = read(name);
    assert.ok(source.trimEnd().split("\n").length <= 350);
    assert.doesNotMatch(source, /ObservableObject|@Observable\b|@StateObject|@ObservedObject|@Published|UserDefaults|@AppStorage|@State\b|Task\s*\{|service\.search|GlobalSearchRequest\(/);
  }
});

// This PR's scope gate must not freeze API/backend files for future feature branches.
const branch = process.env.GITHUB_HEAD_REF
  ?? execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
test("Global Search structural branch leaves API and backend tracked files untouched", {
  skip: branch !== "refactor/ios-global-search-structure",
}, () => {
  const base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { encoding: "utf8" }).trim();
  for (const args of [["diff", "--name-only", base], ["diff", "--cached", "--name-only"]]) {
    const paths = execFileSync("git", args, { encoding: "utf8" }).trim().split("\n");
    assert.deepEqual(paths.filter(path => /^(?:src\/|drizzle\/|railway)|\/Infrastructure\/API\/|GlobalSearchService\.swift$/.test(path)), []);
  }
});
