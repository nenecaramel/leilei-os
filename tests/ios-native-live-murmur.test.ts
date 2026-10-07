import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const activityPath =
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveRuntimeActivity.swift";
const rowPath =
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveAssistantTurnRow.swift";
const presentationPath =
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveAssistantTurnPresentation.swift";
const assemblerPath =
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveConversationPresentationAssembler.swift";
const projectionPath =
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMessagePresentationProjection.swift";
const modelsPath =
  "ios/LeileiOS/LeileiOS/Infrastructure/API/NativeLive/NativeLiveModels.swift";

test("murmur is a separate activity-row bubble that opens a sheet", () => {
  const activity = fs.readFileSync(activityPath, "utf8") + fs.readFileSync(activityPath.replace("NativeLiveRuntimeActivity.swift", "NativeLiveActivitySheets.swift"), "utf8");
  const row = fs.readFileSync(rowPath, "utf8");

  assert.match(row, /!turn\.header\.isEmpty \|\| turn\.murmurText != nil/u);
  assert.match(row, /murmurText:turn\.murmurText/u);

  assert.match(activity, /let murmurText: String\?/u);
  assert.match(activity, /@State private var isShowingMurmur = false/u);
  assert.match(
    activity,
    /Button \{[\s\S]*isShowingMurmur = true[\s\S]*Image\(systemName: "bubble\.left"\)/u,
  );
  assert.match(
    activity,
    /\.sheet\(isPresented: \$isShowingMurmur\)[\s\S]*NativeLiveMurmurSheet/u,
  );
  assert.match(activity, /\.presentationDetents\(\[\.medium\]\)/u);
  assert.match(activity, /\.presentationDragIndicator\(\.visible\)/u);

  const header = activity.match(
    /HStack\(\s*alignment: \.firstTextBaseline,\s*spacing: 8\s*\) \{([\s\S]*?)\n            if effectiveExpanded/u,
  )?.[1] ?? "";
  assert.ok(header.indexOf('Image(systemName: "bubble.left")') >= 0);
  assert.ok(header.indexOf('"chevron.right"') > header.indexOf('"bubble.left"'));
});

test("murmur never becomes assistant body or generic display text", () => {
  const projection = fs.readFileSync(projectionPath, "utf8");
  const models = fs.readFileSync(modelsPath, "utf8");

  assert.match(
    projection,
    /block\.kind == "murmur"[\s\S]*return nil/u,
  );
  assert.match(
    models,
    /var displayText: String \{[\s\S]*\.filter \{ \$0\.kind == "text" \}/u,
  );
});

test("canonical murmur is projected separately and raw streaming tags are fail-closed", () => {
  const presentation = fs.readFileSync(presentationPath, "utf8");
  const assembler = fs.readFileSync(assemblerPath, "utf8");

  assert.match(presentation, /var murmurText: String\? = nil/u);
  assert.match(
    assembler,
    /first\(where: \{ \$0\.kind == "murmur" \}\)/u,
  );
  assert.match(assembler, /murmurStrippedRuntimeText/u);
  assert.match(
    assembler,
    /guard let close = result\.range\([\s\S]*else \{[\s\S]*result\.removeSubrange\(open\.lowerBound<\.\.result\.endIndex\)/u,
  );
  assert.match(
    assembler,
    /"<murmur>"\.hasPrefix\(suffix\)[\s\S]*"<\/murmur>"\.hasPrefix\(suffix\)/u,
  );
});
