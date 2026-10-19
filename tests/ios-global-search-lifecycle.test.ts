import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { swiftDeclarations } from "./helpers/ios-swift-declarations.js";

test("actual Swift Global Search tasks fence stale responses and preserve pagination on retry", { skip: process.platform !== "darwin" }, () => {
  const directory = mkdtempSync(join(tmpdir(), "global-search-lifecycle-"));
  try {
    const declaration = swiftDeclarations("ios/LeileiOS/LeileiOS/Pages/GlobalSearchView.swift");
    const methods = ["scheduleSearch()", "loadMore(_:)", "uniqueResults(_:)"]
      .map(signature => declaration("func_decl", signature)).join("\n");
    const models = readFileSync("ios/LeileiOS/LeileiOS/Pages/GlobalSearch/GlobalSearchService.swift", "utf8")
      .split("final class LeileiGlobalSearchService")[0];
    const fixture = readFileSync("tests/fixtures/global-search/lifecycle.swift", "utf8");
    const source = join(directory, "main.swift");
    writeFileSync(source, models + fixture.replace("// PRODUCTION_METHODS", methods));
    const executable = join(directory, "check");
    execFileSync("swiftc", ["-module-cache-path", join(directory, "cache"), source, "-o", executable], {
      encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024,
    });
    const output = execFileSync(executable, [], { encoding: "utf8", timeout: 20_000 });
    for (const scenario of ["stale-search success/failure", "pagination retry/identity/single-flight", "cancelled-pagination", "failure/empty/query-limit"]) {
      assert.ok(output.includes(`PASS ${scenario}`), scenario);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
