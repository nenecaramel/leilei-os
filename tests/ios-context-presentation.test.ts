import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import test from "node:test";
const root = "ios/LeileiOS/LeileiOS/Pages/";
function declaration(source: string, marker: string) {
  const start = source.indexOf(marker); assert.notEqual(start, -1, marker);
  const open = source.indexOf("{", start); let end = open + 1, depth = 1;
  for (; depth && end < source.length; end++) { if (source[end] === "{") depth++; if (source[end] === "}") depth--; }
  assert.equal(depth, 0); return source.slice(start, end);
}
const compact = (s: string) => s.replace(/\s/g, "");
const hash = (s: string) => createHash("sha256").update(compact(s)).digest("hex");

test("Context separates stateless presentation from the existing compact owner", () => {
  const sheet = readFileSync(root + "ContextOverviewSheet.swift", "utf8");
  const usage = readFileSync(root + "Context/ContextUsageSection.swift", "utf8");
  const environment = readFileSync(root + "Context/ContextEnvironmentSection.swift", "utf8");
  assert.match(sheet, /ContextUsageSection\(metadata: metadata\)/);
  assert.match(sheet, /ContextEnvironmentSection\(/);
  for (const source of [usage, environment]) assert.doesNotMatch(source, /@State|@EnvironmentObject|Task|async|appModel|api\./);
  assert.match(sheet, /@State private var isCompacting = false/);
  assert.match(sheet, /@State private var compactError: String\?/);
  assert.match(sheet, /@State private var hasLoadedRuntimeMetadata = false/);
});

test("expanded presentation and compact coordination match the main baseline", () => {
  const sheet = readFileSync(root + "ContextOverviewSheet.swift", "utf8");
  const hashes: Record<string, string> = {"private func compactContext()": "30b1032265bc18c73a3be8785aca0ba7ebe2ef09cfc20d34e2b65784778d748e", "private func manualCompactStatusText(": "f2fa87beee9f1fdb55cab73f0b507a9b8991899c5db836fc3d00a84cca53a4ca", "var body:": "e97099e5857d7d960d9903d6d55bba2b4a1d1e66707e9d95f3af627ce0fef4a9"};
  for (const marker of ["private func compactContext()", "private func manualCompactStatusText("]) assert.equal(hash(declaration(sheet, marker)), hashes[marker]);
  function body(file: string) {
    const value = declaration(readFileSync(root + file, "utf8"), "var body:");
    return value.slice(value.indexOf("{") + 1, -1);
  }
  const expanded = declaration(sheet, "var body:")
    .replace("ContextUsageSection(metadata: metadata)", body("Context/ContextUsageSection.swift"))
    .replace(/ContextEnvironmentSection\(\s*metadata: metadata,\s*hasLoadedRuntimeMetadata: hasLoadedRuntimeMetadata\s*\)/, body("Context/ContextEnvironmentSection.swift"))
    .replaceAll("ContextOverviewFormat.", "");
  assert.equal(hash(expanded), hashes["var body:"]);
});

test("actual Swift Context formatting preserves rounding, clamping, whitespace and locale", { skip: process.platform !== "darwin" }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "context-format-"));
  try {
    const file = root + "Context/ContextOverviewFormat.swift";
    let production = file;
    if (!existsSync(file)) {
      // Before extraction, execute the existing private helpers directly.
      const source = readFileSync(root + "ContextOverviewSheet.swift", "utf8");
      production = path.join(dir, "Format.swift");
      const helpers = ["clampedProgress", "percentText", "integerText", "normalized"].map(name => declaration(source, `private func ${name}(`).replace("private func", "static func"));
      writeFileSync(production, "import Foundation\nenum ContextOverviewFormat {\n" + helpers.join("\n") + "\n}");
    }
    const build = spawnSync("xcrun", ["swiftc", "-parse-as-library", "-module-cache-path", path.join(dir, "cache"), production, "tests/fixtures/context-overview-format.swift", "-o", path.join(dir, "check")], { encoding: "utf8", timeout: 120000 });
    assert.equal(build.status, 0, build.stderr);
    const run = spawnSync(path.join(dir, "check"), [], { encoding: "utf8", timeout: 60000 });
    assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /Context format PASS/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Moving a display value must not change token arithmetic, fallback precedence,
// provider-limit threshold, labels, styles or environment normalization.
test("all moved display calculations and row builders conserve their exact baseline bodies", () => {
  const expected: Record<string, Record<string, string>> = {
  "ContextUsageSection.swift": {
    "private var usageProgress:": "5a71a058f5650ab100ab33ed6ccacbe55242462e714d43d787c0e8f2d974d475",
    "private var usageText:": "79a4701b5adb3f8664d8e1c6e46f7129b74c1ade4f2470422e2618fa355830c2",
    "private var tokensText:": "2b2ba0bec8fe9474725dc8ca880bb475ad1276c0d84834f00346481e9ddb5eb0",
    "private var remainingText:": "42ba49eee581009a588dcc41ff2ad5a3854ae2b4b656b4ef1dc7d9d7069e2379",
    "private var rawLimitText:": "030a7e649aa01e330ffc79315a8b7ca4c839f510a5079d1d1440b4b6ee668396",
    "private var modelText:": "08da08694c6bda2f32eb7534893a43d7c336dfe2363ba932885cb6611802c705",
    "private var effortText:": "9fbfd29b3305e4c7b53ef5ae62f4c964416531ac5cec66788467098607c52da0"
  },
  "ContextEnvironmentSection.swift": {
    "private func environmentRow(": "2d3a079e6926e436cd1178e5fdc24dad29bdd476ac39433013a562415b0688e1",
    "private func environmentBlockRow(": "7d9f07efb77314dec7c98a2918b6c6d2ebdc4fbe9e103da68942d4bb2ed388b1",
    "private func environmentListRow(": "ac7c537361cf4fceb3ae53061f44e563a40f94893e53a65707e123ff6c6edd7c",
    "private func fastModeText(": "baed79400a0caf0f0e919d7936fff00d7eef8a0b6a1f6f0bf59b68a4f2034a52"
  },
  "ContextOverviewFormat.swift": {
    "private func clampedProgress(": "f631ff648112965e865f420a7085e3057322502ae547e71f1719c8d34596b4d8",
    "private func percentText(": "79cca15bfe005bae941cf287708db6d8ae17cf3a01bbc7620fd75820ae00d5a1",
    "private func integerText(": "6ff3637fa23aa08d069ac7627c61ff3fa1feadbd27f40e00497e99876067e0ee",
    "private func normalized(": "8da10d861876f22482574c513c719534748c1befa293bac2de180fdae4a23a0a"
  }
};
  for (const [file, declarations] of Object.entries(expected)) {
    const source = readFileSync(root + "Context/" + file, "utf8").replaceAll("ContextOverviewFormat.", "").replaceAll("static func", "private func");
    for (const [marker, digest] of Object.entries(declarations)) assert.equal(hash(declaration(source, marker)), digest, `${file}: ${marker}`);
  }
});

test("Context normalization is safe in synchronous callbacks under default MainActor isolation", { skip: process.platform !== "darwin" }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "context-isolation-"));
  try {
    const executable = path.join(dir, "check");
    const production = path.join(dir, "Format.swift");
    // Pin the reported isolation: newer compilers may infer stateless helpers
    // differently even with the same default-MainActor project setting.
    writeFileSync(production, readFileSync(root + "Context/ContextOverviewFormat.swift", "utf8").replace("enum ContextOverviewFormat", "@MainActor\nenum ContextOverviewFormat"));
    const build = spawnSync("xcrun", ["swiftc", "-swift-version", "5", "-strict-concurrency=complete", "-warnings-as-errors", "-default-isolation", "MainActor", "-parse-as-library", "-module-cache-path", path.join(dir, "cache"), production, "tests/fixtures/context-overview-isolation.swift", "-o", executable], { encoding: "utf8", timeout: 120000 });
    assert.equal(build.status, 0, build.stderr);
    const run = spawnSync(executable, [], { encoding: "utf8", timeout: 60000 });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Context isolation PASS/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
