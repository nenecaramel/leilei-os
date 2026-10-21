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

  assert.match(row, /processSections\.showsActivity \|\| activityMurmurText != nil/u);
  assert.match(row, /murmurText:activityMurmurText/u);

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

  // iMessage changes the HStack's alignment; inspect the header contents
  // without depending on the Original-only alignment expression.
  const header = activity.slice(
    activity.indexOf("    var body: some View {"),
    activity.indexOf("            if effectiveExpanded {"),
  );
  assert.ok(header.length > 0, "Activity header must be present");
  assert.ok(header.indexOf('Image(systemName: "bubble.left")') >= 0);
  // de3bd060 places disclosure next to its label, before the independent murmur button.
  assert.ok(header.indexOf('"chevron.right"') >= 0);
  assert.ok(header.indexOf('Image(systemName: "bubble.left")') > header.indexOf('"chevron.right"'));
  assert.match(header, /if normalizedMurmurText != nil/);
  assert.match(header, /\.accessibilityLabel\("Murmur"\)/);
});

// The bubble always trails the first process row: Thought process when it is
// shown, otherwise Worked for, otherwise a row of its own before the body.
test("murmur trails the first process row", () => {
  const row = fs.readFileSync(rowPath, "utf8");
  const thinking = fs.readFileSync(rowPath.replace("NativeLiveAssistantTurnRow.swift", "NativeLiveVisibleThinkingSurface.swift"), "utf8");
  const button = fs.readFileSync(activityPath.replace("NativeLiveRuntimeActivity.swift", "NativeLiveMurmurButton.swift"), "utf8");

  assert.match(row, /NativeLiveVisibleThinkingSurface\(items: turn\.visibleThinking, murmurText: turn\.murmurText\)/u);
  assert.match(row, /var activityMurmurText: String\? \{ turn\.visibleThinking\.isEmpty \? turn\.murmurText : nil \}/u);

  assert.match(thinking, /var murmurText: String\? = nil/u);
  assert.ok(thinking.indexOf("NativeLiveMurmurButton(text: murmurText)") > thinking.indexOf('"chevron.right"'),
    "Thought process disclosure precedes the murmur bubble");
  assert.ok(thinking.indexOf("NativeLiveMurmurButton(text: murmurText)") < thinking.indexOf("Spacer(minLength: 8)"));

  assert.match(button, /struct NativeLiveMurmurButton: View/u);
  assert.match(button, /Image\(systemName: "bubble\.left"\)/u);
  assert.match(button, /\.sheet\(isPresented: \$isShowingMurmur\)[\s\S]*NativeLiveMurmurSheet\(text: text\)/u);
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
    /guard let close = result\.range\([\s\S]*else \{[\s\S]*result\.removeSubrange\(open\.lowerBound\.\.<result\.endIndex\)/u,
  );
  assert.match(
    assembler,
    /"<murmur>"\.hasPrefix\(suffix\)[\s\S]*"<\/murmur>"\.hasPrefix\(suffix\)/u,
  );
});
