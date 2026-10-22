import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
const root = 'ios/LeileiOS/LeileiOS/Chat/MessageSurface/';
test('Swift process sections follow actual content throughout a turn', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'leilei-process-'));
  try {
    const binary = path.join(dir, 'check');
    const compile = spawnSync('xcrun', ['swiftc', '-parse-as-library', root + 'NativeLiveProcessSections.swift', 'tests/fixtures/ios-message-process-sections.swift', '-o', binary], { encoding: 'utf8', timeout: 120000 });
    assert.equal(compile.status, 0, compile.stderr);
    const run = spawnSync(binary, [], { encoding: 'utf8', timeout: 30000 });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Process sections PASS/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('thinking sheet is independent and timestamp belongs only to the footer', () => {
  const row = readFileSync(root + 'NativeLiveAssistantTurnRow.swift', 'utf8');
  const thinking = readFileSync(root + 'NativeLiveVisibleThinkingSurface.swift', 'utf8');
  const actions = readFileSync(root + 'NativeLiveAssistantActions.swift', 'utf8');
  assert.match(row, /processSections\.showsLoading/);
  assert.match(row, /processSections\.showsActivity/);
  assert.doesNotMatch(row, /timestampText:turn\.timestamp|else if let timestamp/);
  assert.match(thinking, /Text\("Thought process"\)/);
  assert.match(thinking, /@State private var isShowingThoughtProcess/);
  assert.doesNotMatch(thinking, /toggleActivity|nativeLiveMessageUIState/);
  assert.match(actions, /if let timestamp = turn\.visibleTimestamp/);
  assert.ok(actions.indexOf('if let timestamp') > actions.indexOf('if turn.canRetry'));
});
// Appearance (fonts, spacing, insets, icon sizes, colors) is owner-tuned on
// device and deliberately unpinned. These tests cover which rows appear, what
// they open or toggle, and where callbacks go.
test('process sections drive which rows appear between thinking, activity and body', () => {
  const row = readFileSync(root + 'NativeLiveAssistantTurnRow.swift', 'utf8');
  assert.match(row, /if processSections\.showsLoading \{\s*if chatTheme == \.iMessage \{/);
  assert.match(row, /NativeLiveProcessStatusHeadline\(\s*title: turn\.header\.isEmpty \? "Thinking…" : turn\.header/);
  assert.match(row, /else \{\s*Text\("Thinking\.\.\."\)/);
  assert.match(row, /processSections\.showsThinking && \(processSections\.showsActivity \|\| !turn\.bodyPresentation\.nodes\.isEmpty\)/);
  assert.match(row, /processSections\.showsActivity && !turn\.bodyPresentation\.nodes\.isEmpty/);
  const list = readFileSync(root + 'NativeLiveMessageList.swift', 'utf8');
  assert.match(list, /LazyVStack\(spacing: rowSpacing\)/);
});

test('the loading line is a passive status; only Thought process and Worked for are interactive', () => {
  const thinking = readFileSync(root + 'NativeLiveVisibleThinkingSurface.swift', 'utf8');
  const activity = readFileSync(root + 'NativeLiveRuntimeActivity.swift', 'utf8');
  const idle = thinking.slice(thinking.indexOf('struct NativeLiveProcessStatusHeadline:'), thinking.indexOf('// A small dotted clock'));
  assert.match(idle, /Text\(title\)/);
  assert.doesNotMatch(idle, /Button|Image\(systemName: "chevron|NativeLiveThoughtProcessIcon\(\)/);
  const workHeader = activity.slice(activity.indexOf('    var body: some View {'), activity.indexOf('            if effectiveExpanded {'));
  assert.doesNotMatch(workHeader, /NativeLiveThoughtProcessIcon\(\)|Image\(systemName:\s*"clock"\)/);
  assert.match(activity, /expansion\.toggleActivity\(\)/);
  assert.match(activity, /effectiveExpanded\s*\? "chevron\.down"\s*: "chevron\.right"/);
});

test('thought process opens a native sheet with a leading icon and no toolbar buttons', () => {
  const surface = readFileSync(root + 'NativeLiveVisibleThinkingSurface.swift', 'utf8');
  assert.match(surface, /Button \{ isShowingThoughtProcess = true \}/);
  assert.match(surface, /\.sheet\(isPresented: \$isShowingThoughtProcess\)/);
  assert.match(surface, /NativeLiveThoughtProcessSheet\(items: items\)/);
  assert.ok(surface.indexOf('NativeLiveThoughtProcessIcon()') < surface.indexOf('Text("Thought process")'));
  assert.match(surface, /Image\(systemName: "chevron.right"\)/);
  assert.doesNotMatch(surface, /isExpanded|Collapse thought process/);
  const sheet = surface.slice(surface.indexOf('private struct NativeLiveThoughtProcessSheet'));
  assert.match(sheet, /NavigationStack/);
  assert.match(sheet, /ScrollView/);
  assert.match(sheet, /ForEach\(items\)/);
  assert.match(sheet, /Text\(item.text\)/);
  assert.match(sheet, /\.textSelection\(\.enabled\)/);
  assert.match(sheet, /\.navigationTitle\("Thought process"\)/);
  assert.match(sheet, /\.presentationDetents\(\[\.medium, \.large\]\)/);
  assert.match(sheet, /\.presentationDragIndicator\(\.visible\)/);
  assert.doesNotMatch(sheet, /toolbar|Button|dismiss|raw_metadata/);
});

test('assistant footer actions copy the reply and retry its parent user message', () => {
  const actions = readFileSync(root + 'NativeLiveAssistantActions.swift', 'utf8');
  assert.match(actions, /Image\(systemName:isCopied \? "checkmark" : "square.on.square"\)/);
  assert.match(actions, /Image\(systemName:"arrow.clockwise"\)/);
  assert.match(actions, /onCopyMessage\(text\)/);
  assert.match(actions, /onRetryMessage\(user\)/);
});
