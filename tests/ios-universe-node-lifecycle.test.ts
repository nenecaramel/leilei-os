import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { swiftDeclarations } from "./helpers/ios-swift-declarations.js";
let directory: string, executable: string;
const mac = process.platform === "darwin";
before(() => {
  if (!mac) return;
  directory = mkdtempSync(join(tmpdir(), "universe-node-tasks-")); executable = join(directory, "check");
  const pages = "ios/LeileiOS/LeileiOS/Pages/";
  const models = readFileSync(pages + "UniverseModels.swift", "utf8");
  const draft = swiftDeclarations(pages + "Universe/UniverseViewModels.swift")("struct_decl", "UniverseNodeDraft");
  const api = readFileSync("ios/LeileiOS/LeileiOS/Infrastructure/LeileiAPIClient.swift", "utf8").split("@MainActor")[0];
  const mapper = swiftDeclarations(pages + "UniverseService.swift");
  const error = `enum UniverseAPIService { ${mapper("func_decl", "isVersionConflict(_:)")}\n${mapper("func_decl", "userMessage(for:)")} }`;
  const coordination = readFileSync(pages + "Universe/Nodes/UniverseNodeCoordination.swift", "utf8");
  const fixture = readFileSync("tests/fixtures/universe/node-lifecycle.swift", "utf8").replace("// COORDINATION", coordination);
  writeFileSync(join(directory, "main.swift"), [models, draft, api, error, fixture].join("\n"));
  execFileSync("swiftc", ["-module-cache-path", join(directory, "cache"), join(directory, "main.swift"), "-o", executable], { encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 });
});
after(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });
for (const scenario of ["cancel-discard", "save-single-flight", "failure-retry-create"]) {
  test(`actual Swift Universe ${scenario}`, { skip: !mac }, () => {
    const output = execFileSync(executable, [scenario], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
    assert.match(output, new RegExp(`PASS ${scenario}`));
  });
}
