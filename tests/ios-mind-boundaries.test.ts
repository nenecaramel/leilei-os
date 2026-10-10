import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const pages = "ios/LeileiOS/LeileiOS/Pages/";
const read = (file: string) => fs.readFileSync(`${pages}${file}`, "utf8");
const root = () => read("MindView.swift");
const surface = (file: string) => read(`Mind/${file}.swift`);

test("Mind entry stays thin and opens the direct memory feed plus native composer", () => {
  const source = root();
  assert.ok(source.trimEnd().split("\n").length <= 120, "MindView must remain a thin entry");
  assert.match(source, /struct MindView: View/);
  assert.match(source, /MindMemoryListView\(\)/);
  assert.match(source, /\.sheet\(isPresented: \$addPresented, onDismiss:/);
  assert.match(source, /MindManualEntrySheet\(\)/);
  assert.doesNotMatch(source, /MindProductKind\.allCases|MindKindDetailView|appModel\.api\.|func (?:reload|loadMore|save|delete|dateText)\b/);
});

test("Mind memory feed owns loading, retry, pagination and useful row metadata", () => {
  const source = surface("MindKindList");
  assert.match(source, /struct MindMemoryListView: View/);
  assert.match(source, /private struct MindItemRow: View/);
  for (const state of ["items", "nextCursor", "loading", "loadingMore", "failed", "reloadToken"]) {
    assert.match(source, new RegExp(`@State private var ${state}\\b`));
  }
  assert.match(source, /else if failed && items\.isEmpty/);
  assert.match(source, /actionTitle: "Retry"/);
  assert.match(source, /AppStateSurface\(title: "No memories yet"\)/);
  assert.match(source, /Button\("More"\)/);
  assert.match(source, /kind: \.memory/);
  assert.match(source, /cursor: nextCursor/);
  assert.match(source, /!existing\.contains\(\$0\.id\)/);
  assert.match(source, /MindPresentation\.sourceLabel\(item\.source\)/);
  assert.match(source, /MindPresentation\.dateText/);
  assert.match(source, /onDeleted: \{\s*reloadToken = UUID\(\)/);
  assert.doesNotMatch(source, /createManualMind|deleteMind|let kind: MindProductKind/);
});

test("Mind detail keeps refresh and delete coordination without redundant kind metadata", () => {
  const source = surface("MindItemDetail");
  assert.match(source, /struct MindItemDetailView: View/);
  assert.match(source, /@State private var item: MindProductItem/);
  assert.match(source, /_item = State\(initialValue: initialItem\)/);
  assert.match(source, /mindItem\(\s*stateID: item\.id/);
  assert.match(source, /deleteMind\(\s*stateID: item\.id/);
  assert.match(source, /onDeleted\(\)\s*dismiss\(\)/);
  assert.match(source, /\.appFailureAlert\([\s\S]*message: "The memory could not be deleted\. Try again\."/);
  assert.match(source, /LabeledContent\(\s*"Types"/);
  assert.doesNotMatch(source, /LabeledContent\("Kind"/);
  assert.doesNotMatch(source, /private func dateText|createManualMind|mindPage/);
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

test("Mind presentation stays pure and shared across list and detail", () => {
  for (const file of ["MindKindList", "MindItemDetail", "MindManualEntry"]) {
    const source = surface(file);
    assert.ok(source.trimEnd().split("\n").length <= 350, `${file} must remain focused`);
    assert.match(source, /@EnvironmentObject private var appModel: AppModel/);
    assert.doesNotMatch(source, /ObservableObject|@Observable\b|@StateObject|@ObservedObject|@Published|UserDefaults|@AppStorage/);
  }
  const presentation = surface("MindPresentation");
  assert.match(presentation, /enum MindPresentation/);
  assert.match(presentation, /static func normalized/);
  assert.match(presentation, /static func sourceLabel/);
  assert.match(presentation, /static func dateText/);
  assert.doesNotMatch(presentation, /@State|AppModel|\.api\.|UserDefaults/);
  assert.match(surface("MindKindList"), /MindPresentation\.normalized/);
  assert.match(surface("MindItemDetail"), /MindPresentation\.normalized/);
});

test("Mind iOS uses native search/composer and its own Memory editor design", () => {
  const rootView = root();
  const feed = surface("MindKindList");
  const detail = surface("MindItemDetail");
  const editor = surface("MemoryEditor");
  const transport = fs.readFileSync("ios/LeileiOS/LeileiOS/Infrastructure/API/Mind/MindAPI.swift", "utf8");

  assert.match(rootView, /DefaultToolbarItem\(kind: \.search, placement: \.bottomBar\)/);
  assert.match(rootView, /Image\(systemName: "square\.and\.pencil"\)/);
  assert.doesNotMatch(rootView, /Image\(systemName: "plus"\)/);
  assert.match(feed, /\.searchable\(text: \$query, prompt: "Search"\)/);
  assert.match(feed, /memorySearch\(\s*query:/);
  assert.match(feed, /searchCursor = page\.nextCursor/);
  assert.doesNotMatch(feed, /MindUndatedList|NavigationLink\("未指定日期"\)/);
  assert.ok(!fs.existsSync(`${pages}Mind/MindUndatedList.swift`));
  assert.match(transport, /URLQueryItem\(name: "query", value: query\)/);
  assert.match(detail, /Menu \{/);
  assert.match(detail, /Image\(systemName: "ellipsis"\)/);
  assert.match(detail, /Button\("Delete", role: \.destructive\)/);
  assert.doesNotMatch(detail, /Image\(systemName: "trash"\)/);
  assert.match(editor, /Form \{/);
  assert.match(editor, /\.formStyle\(\.grouped\)/);
  assert.match(editor, /Section\("Mind"\)/);
  assert.match(editor, /Section\("Time"\)/);
  assert.match(editor, /TextEditor\(text: \$text\)/);
  assert.match(editor, /DatePicker\(/);
  assert.match(editor, /Color\.settingsBackground/);
  assert.doesNotMatch(editor, /ScrollView \{|RoundedRectangle/);
  assert.equal((feed.match(/\.listStyle\(\.plain\)/g) ?? []).length, 2);
  assert.doesNotMatch(feed, /\.listStyle\(\.insetGrouped\)/);
  assert.match(editor, /conflictUnresolved/);
  assert.match(editor, /Button\("Keep my draft"\)/);
});
