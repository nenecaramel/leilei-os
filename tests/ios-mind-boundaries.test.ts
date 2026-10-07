import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const pages = "ios/LeileiOS/LeileiOS/Pages/";
const read = (file: string) => fs.readFileSync(`${pages}${file}`, "utf8");
const root = () => read("MindView.swift");
const surface = (file: string) => read(`Mind/${file}.swift`);

test("Mind entry stays thin and coordinates only kind navigation and the add sheet", () => {
  const source = root();
  assert.ok(source.trimEnd().split("\n").length <= 200, "MindView must remain a thin entry");
  assert.match(source, /struct MindView: View/);
  assert.match(source, /MindKindDetailView\(kind: kind\)/);
  assert.match(source, /\.sheet\(isPresented: \$addPresented\)/);
  assert.match(source, /MindManualEntrySheet\(\)/);
  assert.doesNotMatch(source, /struct Mind(?:KindDetailView|ItemRow|ItemDetailView|ManualEntrySheet)\b|appModel\.api\.|func (?:reload|loadMore|save|delete|dateText)\b/);
});

test("Mind list owns its existing loading, retry, pagination and private row presentation", () => {
  const source = surface("MindKindList");
  assert.match(source, /struct MindKindDetailView: View/);
  assert.match(source, /private struct MindItemRow: View/);
  for (const state of ["items", "nextCursor", "loading", "loadingMore", "failed", "reloadToken"]) {
    assert.match(source, new RegExp(`@State private var ${state}\\b`));
  }
  assert.match(source, /else if failed && items\.isEmpty/);
  assert.match(source, /actionTitle: "Retry"/);
  assert.match(source, /AppStateSurface\(title: "Nothing here"\)/);
  assert.match(source, /Button\("More"\)/);
  assert.match(source, /cursor: nextCursor/);
  assert.match(source, /!existing\.contains\(\$0\.id\)/);
  assert.match(source, /onDeleted: \{\s*reloadToken = UUID\(\)/);
  assert.doesNotMatch(source, /createManualMind|deleteMind/);
});

test("Mind detail retains local item, reload and delete coordination", () => {
  const source = surface("MindItemDetail");
  assert.match(source, /struct MindItemDetailView: View/);
  assert.match(source, /@State private var item: MindProductItem/);
  assert.match(source, /_item = State\(initialValue: initialItem\)/);
  assert.match(source, /mindItem\(\s*stateID: item\.id/);
  assert.match(source, /deleteMind\(\s*stateID: item\.id/);
  assert.match(source, /onDeleted\(\)\s*dismiss\(\)/);
  assert.match(source, /private func dateText/);
  assert.doesNotMatch(source, /createManualMind|mindPage/);
});

test("Mind manual entry retains its form state and signature-based retry identity", () => {
  const source = surface("MindManualEntry");
  assert.match(source, /struct MindManualEntrySheet: View/);
  for (const state of ["text", "note", "hasOccurredAt", "occurredAt", "saving", "failed", "pendingRequestID", "pendingRequestSignature"]) {
    assert.match(source, new RegExp(`@State private var ${state}\\b`));
  }
  assert.match(source, /value\.count <= 20_000/);
  assert.match(source, /\.joined\(separator: "\\u\{0\}"\)/);
  assert.match(source, /if pendingRequestSignature == signature,\s*let pendingRequestID/);
  assert.match(source, /createManualMind\(\s*kind: \.memory,\s*text: normalizedText,\s*occurredAt: desiredOccurredAt,\s*note: desiredNote,\s*requestID: requestID/);
  assert.doesNotMatch(source, /deleteMind|mindPage|\bPicker\(|typePicker|@State private var kind/);
});

test("Mind extraction adds no observable state authority or persistence and stays focused", () => {
  for (const file of ["MindKindList", "MindItemDetail", "MindManualEntry"]) {
    const source = surface(file);
    assert.ok(source.trimEnd().split("\n").length <= 350, `${file} must remain focused`);
    assert.match(source, /@EnvironmentObject private var appModel: AppModel/);
    assert.doesNotMatch(source, /ObservableObject|@Observable\b|@StateObject|@ObservedObject|@Published|UserDefaults|@AppStorage/);
  }
  const presentation = surface("MindPresentation");
  assert.match(presentation, /enum MindPresentation/);
  assert.match(presentation, /static func normalized/);
  assert.doesNotMatch(presentation, /@State|AppModel|\.api\.|UserDefaults/);
  assert.match(surface("MindKindList"), /MindPresentation\.normalized/);
  assert.match(surface("MindItemDetail"), /MindPresentation\.normalized/);
});
