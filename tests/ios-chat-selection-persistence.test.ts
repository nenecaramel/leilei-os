import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const chat = readFileSync("ios/LeileiOS/LeileiOS/Chat/ChatView.swift", "utf8");
const models = readFileSync("ios/LeileiOS/LeileiOS/Infrastructure/API/NativeLive/NativeLiveModels.swift", "utf8");

test("actual composer model and effort storage survives recreation and process restart", { skip: process.platform !== "darwin" }, (t) => {
  const directory = mkdtempSync(join(tmpdir(), "leileios-selection-test-"));
  const suite = `leileios.selection.test.${directory.split("/").at(-1)}`;
  t.after(() => {
    spawnSync("defaults", ["delete", suite], { timeout: 10_000 });
    rmSync(directory, { recursive: true, force: true });
  });
  const declarations = ["model", "effort"].map((name) => {
    const matches = [...chat.matchAll(new RegExp(`^    @(?:State|AppStorage\\([^\\n]+\\)) var ${name}: [^\\n]+$`, "gm"))];
    assert.equal(matches.length, 1, `${name} must have exactly one storage owner`);
    return matches[0][0].replace(/@AppStorage\(("[^"]+")\)/, "@AppStorage($1, store: testDefaults)");
  }).join("\n");
  const enumStart = models.indexOf("enum NativeLiveClaudeModel:");
  const enumEnd = models.indexOf("struct NativeLiveExecutionSelection:", enumStart);
  assert.ok(enumStart >= 0 && enumEnd > enumStart);
  const source = `import Foundation
import SwiftUI
${models.slice(enumStart, enumEnd)}
let suiteName = CommandLine.arguments[1]
let testDefaults = UserDefaults(suiteName: suiteName)!
@MainActor struct SelectionHarness {
${declarations}
}
@main struct Check {
 @MainActor static func main() {
   if CommandLine.arguments[2] == "write" {
     testDefaults.removePersistentDomain(forName: suiteName)
     var first = SelectionHarness()
     precondition(first.model == .opus55 && first.effort == .high)
     first.model = .sonnet55
     first.effort = .max
     let recreated = SelectionHarness()
     precondition(recreated.model == .sonnet55 && recreated.effort == .max, "recreated view lost selection")
     var otherConversation = SelectionHarness()
     otherConversation.model = .opus46
     otherConversation.effort = .low
     let reopened = SelectionHarness()
     precondition(reopened.model == .opus46 && reopened.effort == .low, "conversation switch lost selection")
     testDefaults.synchronize()
   } else {
     let afterRestart = SelectionHarness()
     precondition(afterRestart.model == .opus46 && afterRestart.effort == .low, "process restart lost selection")
     testDefaults.set("future-model", forKey: "nativeLive.model")
     testDefaults.set("future-effort", forKey: "nativeLive.effort")
     let invalid = SelectionHarness()
     precondition(invalid.model == .opus55 && invalid.effort == .high, "invalid persisted enum should use safe default")
     testDefaults.removePersistentDomain(forName: suiteName)
     testDefaults.synchronize()
   }
   print("Selection persistence PASS")
 }
}
`;
  const swift = join(directory, "selection.swift");
  const executable = join(directory, "selection");
  writeFileSync(swift, source);
  const env = { ...process.env, CLANG_MODULE_CACHE_PATH: join(directory, "clang-cache"), SWIFT_MODULE_CACHE_PATH: join(directory, "swift-cache") };
  const compiled = spawnSync("swiftc", ["-parse-as-library", swift, "-o", executable], { encoding: "utf8", env, timeout: 120_000 });
  assert.equal(compiled.status, 0, compiled.stderr);
  for (const phase of ["write", "read"]) {
    const result = spawnSync(executable, [suite, phase], { encoding: "utf8", env, timeout: 15_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Selection persistence PASS/);
  }
});
