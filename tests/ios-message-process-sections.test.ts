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
test('process section gaps are 18 while body/footer spacing stays 6', () => {
  const layout = readFileSync('ios/LeileiOS/LeileiOS/Chat/ChatPresentationLayout.swift', 'utf8');
  const row = readFileSync(root + 'NativeLiveAssistantTurnRow.swift', 'utf8');
  assert.match(layout, /processSectionSpacing: CGFloat = 18/);
  assert.match(layout, /assistantSpacing: CGFloat = 6/);
  assert.match(row, /\(chatTheme == \.iMessage \? ChatPresentationLayout\.iMessageProcessSectionSpacing : ChatPresentationLayout\.processSectionSpacing\) - ChatPresentationLayout\.assistantSpacing/);
  assert.match(row, /processSections\.showsThinking && \(processSections\.showsActivity \|\| !turn\.bodyPresentation\.nodes\.isEmpty\)/);
  assert.match(row, /processSections\.showsActivity && !turn\.bodyPresentation\.nodes\.isEmpty/);
});
test('process labels stay 14 regular with light arrows and an 8pt gap', () => {
  const thinking = readFileSync(root + 'NativeLiveVisibleThinkingSurface.swift', 'utf8');
  const activity = readFileSync(root + 'NativeLiveRuntimeActivity.swift', 'utf8');
  const row = readFileSync(root + 'NativeLiveAssistantTurnRow.swift', 'utf8');
  assert.match(row, /Text\("Thinking\.\.\."\)\.font\(\.system\(size: 14\)\)/);
  assert.match(thinking, /HStack\(spacing: 8\)/);
  assert.doesNotMatch(thinking, /size: 13\.5|size: 10|weight: \.medium|weight: \.semibold/);
  assert.match(thinking, /Image\(systemName:[^\n]+\n\s*\.font\(\.system\(size: 14, weight: \.light\)\)/);
  assert.ok(thinking.indexOf('Image(systemName:') < thinking.indexOf('Spacer(minLength:'));
  const header = activity.slice(activity.indexOf('var body:'), activity.indexOf('if effectiveExpanded {'));
  assert.match(header, /Text\(header\)\s*\.font\(\.system\(size: 14\)\)/);
  assert.match(header, /\.font\(\.system\(size: 14, weight: \.light\)\)\s*\.foregroundStyle\(iMessageWallpaperVisible \? Color\.white : Color\.secondary\)/);
  assert.doesNotMatch(header, /maxWidth: \.infinity/);
  assert.ok(header.indexOf('? "chevron.down"') < header.indexOf('Spacer(minLength:'));
});

test('message timestamps are 12pt and user-to-assistant row spacing is 25pt', () => {
  for (const name of ['NativeLiveAssistantActions.swift', 'NativeLiveHistoryMessageRow.swift']) {
    const source = readFileSync(root + name, 'utf8');
    assert.match(source, /\.font\(\.system\(size:\s*12\)\)\s*\.tracking\(0\.12\)\s*\.foregroundStyle\(\.secondary\)/);
  }
  const layout = readFileSync('ios/LeileiOS/LeileiOS/Chat/ChatPresentationLayout.swift', 'utf8');
  const list = readFileSync(root + 'NativeLiveMessageList.swift', 'utf8');
  assert.match(layout, /turnSpacing: CGFloat = 25/);
  assert.match(list, /rowSpacing: CGFloat = ChatPresentationLayout\.turnSpacing/);
  assert.match(list, /LazyVStack\(spacing: rowSpacing\)/);
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
test('assistant action glyphs keep centered copy and clockwise retry rotations', () => {
  const actions = readFileSync(root + 'NativeLiveAssistantActions.swift', 'utf8');
  assert.match(actions, /Image\(systemName:isCopied \? "checkmark" : "square.on.square"\)\.rotationEffect\(\.degrees\(isCopied \? 0 : 180\)\)/);
  assert.equal((actions.match(/rotationEffect/g) ?? []).length, 2);
  assert.match(actions, /onCopyMessage\(text\)/);
  assert.match(actions, /onRetryMessage\(user\)/);
});

test('thinking icon uses the reference dotted clock without changing the sheet or work row', () => {
  const surface = readFileSync(root + 'NativeLiveVisibleThinkingSurface.swift', 'utf8');
  assert.match(surface, /NativeLiveThoughtProcessIcon\(\)\s*\.frame\(width: 14, height: 14\)\s*\.scaleEffect\(1\.1\)\s*\.padding\(\.trailing, 1\)\s*\.accessibilityHidden\(true\)/);
  assert.doesNotMatch(surface, /clock\.arrow\.circlepath/);
  assert.match(surface, /struct NativeLiveThoughtProcessIcon: View/);
  assert.match(surface, /for degrees in \[200\.0, 220, 240, 260\]/);
  assert.match(surface, /lineCap: \.round/);
});

test('process and footer glyphs align with body and action spacing is 10pt', () => {
  const layout = readFileSync('ios/LeileiOS/LeileiOS/Chat/ChatPresentationLayout.swift', 'utf8');
  assert.doesNotMatch(layout, /processLeadingInset/);
  assert.match(layout, /actionSpacing: CGFloat = 10/);
  for (const name of ['NativeLiveVisibleThinkingSurface.swift', 'NativeLiveRuntimeActivity.swift']) {
    assert.doesNotMatch(readFileSync(root + name, 'utf8'), /ChatPresentationLayout\.processLeadingInset/);
  }
  const actions = readFileSync(root + 'NativeLiveAssistantActions.swift', 'utf8');
  assert.equal((actions.match(/height:ChatPresentationLayout\.actionDiameter,alignment:\.leading/g) ?? []).length, 2);
});

test('clock paint and thought inset are refined while action icons return to regular', () => {
  const surface = readFileSync(root + 'NativeLiveVisibleThinkingSurface.swift', 'utf8');
  assert.match(surface, /NativeLiveThoughtProcessIcon\(\)\s*\.frame\(width: 14, height: 14\)\s*\.scaleEffect\(1\.1\)/);
  const actions = readFileSync(root + 'NativeLiveAssistantActions.swift', 'utf8');
  assert.match(actions, /Image\(systemName:"arrow.clockwise"\)\.rotationEffect\(\.degrees\(20\)\)\.frame/);
  assert.doesNotMatch(actions, /weight:\s*\.light/);
  assert.match(actions, /\}\.font\(\.system\(size:14\)\)/);
  assert.match(surface, /\.padding\(\.leading, 2\)/);
  assert.match(surface, /\.padding\(\.trailing, 1\)/);
});

test('iMessage loading is text-only at the Original leading edge while Worked for aligns with the Thought icon', () => {
  const row = readFileSync(root + 'NativeLiveAssistantTurnRow.swift', 'utf8');
  const thinking = readFileSync(root + 'NativeLiveVisibleThinkingSurface.swift', 'utf8');
  const activity = readFileSync(root + 'NativeLiveRuntimeActivity.swift', 'utf8');

  assert.match(row, /if processSections\.showsLoading \{\s*if chatTheme == \.iMessage \{/);
  assert.match(row, /NativeLiveProcessStatusHeadline\(\s*title: turn\.header\.isEmpty \? "Thinking…" : turn\.header/);
  assert.match(row, /else \{\s*Text\("Thinking\.\.\."\)\.font\(\.system\(size: 14\)\)\.foregroundStyle\(\.secondary\)/);
  assert.match(thinking, /struct NativeLiveProcessStatusHeadline: View/);
  const idle = thinking.slice(thinking.indexOf('struct NativeLiveProcessStatusHeadline:'), thinking.indexOf('// A small dotted clock'));
  // Like Original's Thinking..., the loading line has no glyph and no 2pt inset.
  assert.doesNotMatch(idle, /NativeLiveThoughtProcessIcon\(\)|HStack|\.padding\(\.leading/);
  assert.match(idle, /Text\(title\)\s*\.font\(\.system\(size: 14\)\)/);
  assert.match(idle, /iMessageWallpaperVisible \? Color\.white : Color\.secondary/);
  assert.match(idle, /iMessageWallpaperVisible \? Color\.black\.opacity\(0\.75\) : \.clear/);
  assert.doesNotMatch(idle, /Button|Image\(systemName: "chevron/);

  assert.match(activity, /@Environment\(\\\.chatTheme\) private var chatTheme/);
  const workHeader = activity.slice(activity.indexOf('    var body: some View {'), activity.indexOf('            if effectiveExpanded {'));
  assert.doesNotMatch(workHeader, /NativeLiveThoughtProcessIcon\(\)|Image\(systemName:\s*"clock"\)/);
  assert.match(thinking, /NativeLiveThoughtProcessIcon\(\)/);
  assert.match(activity, /spacing: chatTheme == \.iMessage \? 8 : 12/);
  assert.match(activity, /\.padding\(\.leading, chatTheme == \.iMessage && !header\.isEmpty \? 2 : 0\)/);
  assert.match(activity, /expansion\.toggleActivity\(\)/);
  assert.match(activity, /effectiveExpanded\s*\? "chevron\.down"\s*: "chevron\.right"/);
});
