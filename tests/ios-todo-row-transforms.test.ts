import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
const root = "ios/LeileiOS/LeileiOS/Pages/DaySpace/";
const page = root + "TodoPaper/DaySpaceTodoPaperDetail.swift";
function declaration(source: string, marker: string) {
  const start = source.indexOf(marker); assert.notEqual(start, -1, marker);
  const open = source.indexOf("{", start); let end = open + 1, depth = 1;
  for (; depth && end < source.length; end++) { if (source[end] === "{") depth++; if (source[end] === "}") depth--; }
  assert.equal(depth, 0); return source.slice(start, end);
}
test("Todo row calculations have one Foundation boundary without moving state or UIKit", () => {
  const source = readFileSync(root + "TodoPaper/DaySpaceTodoRowTransforms.swift", "utf8");
  assert.doesNotMatch(source, /SwiftUI|UIKit|@State|@Binding|Task|UUID|requestFocus|firstResponder|appModel/);
  const owner = readFileSync(page, "utf8");
  for (const name of ["normalizedEntries", "visibleRowTargetCount", "splitText", "mergeText", "pasteText"]) assert.match(owner, new RegExp(`DaySpaceTodoRowTransforms.${name}\\(`));
  assert.match(owner, /@State private var rows:/);
  assert.match(owner, /@State private var focusRequest:/);
});
test("Todo UI, save, focus scheduling, shared Memory editor and models are conserved", () => {
  const owner = readFileSync(page, "utf8");
  const hashes: Record<string, string> = {"var body:": "8d458636aa956fa6b4a9c91486db4d33cd3181672879b7c6a7b759819ad008ff", "private var isDirty:": "9036aeb665307d0e5891a5530bffefb724ae26f421bd5b5b27db07113ee79086", "private func requestFocus(": "3f2064f43629239a7491f2fa74f8972a64384d9e96462327ee14588947bf2b83", "private func updateText(": "5b06576b10515b6979e73d35214053f79a23616518f28b31344686be13d46149", "private func cycleStatus(": "ecca79a330a8819e3623015f9a64d9aca22539f7eff1fd2e6caa8b436447504c", "private func moveToPrevious(": "aed2d7d4ddec3b2317541a6addd9e0ec8c5d705d470c69e2f2e38d1871cc883d", "private func moveToNext(": "1202bc4169a8efb4d22cd16e620e4deb113d679b7ca0443b7f57f117b9bfb911", "private func requestClose()": "f9d81518fe9d7bf1a929bcaa186f4083be719b6a22101879783d5719166ad46c", "private func saveAndClose()": "00079694eeb806615ed1199ff1290a647dcac88e25f33a8b753edca19d07fc1b"};
  for (const [marker, expected] of Object.entries(hashes)) assert.equal(createHash("sha256").update(declaration(owner, marker).replace(/\s/g, "")).digest("hex"), expected, marker);
  // Shared editors pinned to main@372735d4 after #976 PaperLayout; full-file protection remains.
  const files: Record<string, string> = {"Editors/DaySpaceTodoEditor.swift": "d191e0ce7e01525ab6dcfb7a531ddc3dc41d6a794e38fe99648240474e645a65", "Editors/DaySpacePaperBodyEditor.swift": "bfe3fe982356dc6fdccb0444d85f56cb811821b697051ca2e716e02900e404c5", "DaySpaceModels.swift": "f9b00f6af44dc20bd11d1d5bcb4c1f6143fadbdaa2ea8dd5b3e315148dda812d"};
  for (const [file, expected] of Object.entries(files)) assert.equal(createHash("sha256").update(readFileSync(root + file)).digest("hex"), expected, file);
});
test("actual Swift Todo owner preserves row identities, paste, UTF16 caret and boundaries", { skip: process.platform !== "darwin" }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "todo-row-transforms-"));
  try {
    const models = readFileSync(root + "DaySpaceModels.swift", "utf8");
    const names = ["enum DaySpaceAuthor:", "enum DaySpaceTodoEntryKind:", "struct DaySpaceTodoEntry:", "struct DaySpaceEditableTodoEntry:", "struct DaySpaceTodoFocusRequest:"];
    writeFileSync(path.join(dir, "Models.swift"), "import Foundation\n" + names.map(name => declaration(models, name)).join("\n"));
    const source = readFileSync(page, "utf8");
    const functions = ["cycleStatus", "updateText", "splitRow", "mergeWithPrevious", "mergeWithNext", "moveToPrevious", "moveToNext", "pasteMultiline", "rowIndex", "requestFocus", "normalizeVisibleRows"];
    const methods = functions.map(name => {
      let method = declaration(source, `private func ${name}(`).replace("private func", name === "rowIndex" ? "func" : "mutating func");
      // Record calls in the harness only; execute the production operation bodies.
      if (name === "requestFocus") method = method.replace("{", '{ events.append("focus:" + String(rows.count))');
      if (name === "normalizeVisibleRows") method = method.replace("{", '{ events.append("normalize")');
      return method;
    });
    writeFileSync(path.join(dir, "Owner.swift"), "import Foundation\nstruct Owner { var events: [String] = []; var rows: [DaySpaceEditableTodoEntry]; var focusRequest: DaySpaceTodoFocusRequest?; var errorMessage: String? = \"error\";\n" + declaration(source, "private var normalizedEntries:").replace("private var", "var") + "\n" + methods.join("\n") + "\n}");
    const helper = root + "TodoPaper/DaySpaceTodoRowTransforms.swift";
    const build = spawnSync("xcrun", ["swiftc", "-parse-as-library", "-module-cache-path", path.join(dir, "cache"), path.join(dir, "Models.swift"), path.join(dir, "Owner.swift"), ...(existsSync(helper) ? [helper] : []), "tests/fixtures/todo-row-transforms.swift", "-o", path.join(dir, "check")], { encoding: "utf8", timeout: 120000 });
    assert.equal(build.status, 0, build.stderr);
    const run = spawnSync(path.join(dir, "check"), [], { encoding: "utf8", timeout: 60000 });
    assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /Todo row transforms PASS/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
