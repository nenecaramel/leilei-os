import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = "ios/LeileiOS/LeileiOS/Pages/Diary/";
const surfaces = ["DiaryDetailPresentation.swift", "Archive/DiaryArchivePresentation.swift"];
function declaration(source: string, marker: string) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, marker);
  const open = source.indexOf("{", start);
  let end = open + 1, depth = 1;
  for (; depth && end < source.length; end++) {
    if (source[end] === "{") depth++;
    if (source[end] === "}") depth--;
  }
  assert.equal(depth, 0);
  return source.slice(start, end);
}

test("active and archive pages share pure paging rules, retaining local state owners", () => {
  const rules = readFileSync(root + "DiaryCommentPaging.swift", "utf8");
  assert.doesNotMatch(rules, /SwiftUI|UIKit|@State|Task|async|appModel/);
  for (const file of surfaces) {
    const source = readFileSync(root + file, "utf8");
    assert.match(declaration(source, "private func reconcileCommentPage("), /DiaryCommentPaging.reconcile/);
    for (const name of ["commentNextBefore", "commentsHaveMore", "isLoadingOlderComments", "commentError"]) {
      assert.match(source, new RegExp(`@State private var ${name}`));
    }
  }
});

test("actual Swift active/archive reconciliation preserves overlap, order and page metadata", { skip: process.platform !== "darwin" }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "diary-comment-paging-"));
  try {
    // Compile the actual production model declarations and both production reconciliation
    // methods without their unrelated SwiftUI rendering and network dependencies.
    const models = readFileSync(root + "DiaryModels.swift", "utf8");
    const names = ["DiaryEntry", "DiaryComment", "DiaryCommentsMetadata", "DiaryCommentListData", "DiaryCommentListMetadata", "DiaryDetailLoadState"];
    writeFileSync(path.join(dir, "Models.swift"), "import Foundation\n" + names.map(name => declaration(models, `${name === "DiaryDetailLoadState" ? "enum" : "struct"} ${name}${name === "DiaryDetailLoadState" ? " {" : ":"}`)).join("\n"));
    surfaces.forEach((file, index) => {
      const method = declaration(readFileSync(root + file, "utf8"), "private func reconcileCommentPage(").replace("private func", "mutating func");
      writeFileSync(path.join(dir, `Owner${index}.swift`), `struct Owner${index} { var state: DiaryDetailLoadState; var commentsHaveMore = false; var commentNextBefore: String?; ${method} }`);
    });
    const rules = root + "DiaryCommentPaging.swift";
    const files = [path.join(dir, "Models.swift"), path.join(dir, "Owner0.swift"), path.join(dir, "Owner1.swift"), ...(existsSync(rules) ? [rules] : []), "tests/fixtures/diary-comment-paging.swift"];
    const build = spawnSync("xcrun", ["swiftc", "-parse-as-library", "-module-cache-path", path.join(dir, "cache"), ...files, "-o", path.join(dir, "check")], { encoding: "utf8", timeout: 120000 });
    assert.equal(build.status, 0, build.stderr);
    const run = spawnSync(path.join(dir, "check"), [], { encoding: "utf8", timeout: 60000 });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Diary paging: 16 cases PASS/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Expand the shared block back into each owner. Exact baseline hashes pin all UI,
// requests, Tasks, guards, mutations and cursor assignments outside this extraction.
test("only the duplicate value transformation moves; both complete surfaces remain identical", () => {
  const baselineHashes: Record<string, string> = {
  "DiaryDetailPresentation.swift": "3b2dcd808078901b9c20124c89c2b28a2697d797e4f854629a2345d291995c9f",
  "Archive/DiaryArchivePresentation.swift": "1bf047bcf66cadd51680604c38efbbc7a5f333abcfbf50061bf162496113d476"
};
  const rules = readFileSync(root + "DiaryCommentPaging.swift", "utf8");
  const body = rules.slice(rules.indexOf("        let existing ="), rules.lastIndexOf("    }"));
  const call = `        DiaryCommentPaging.reconcile(
            page,
            into: &diary,
            replaceVisiblePage: replaceVisiblePage
        )
`;
  for (const file of surfaces) {
    const source = readFileSync(root + file, "utf8");
    assert.equal(source.split(call).length, 2);
    assert.equal(createHash("sha256").update(source.replace(call, body)).digest("hex"), baselineHashes[file], file);
  }
});
