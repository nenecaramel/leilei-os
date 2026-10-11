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
test('thinking disclosure is independent and timestamp belongs only to the footer', () => {
  const row = readFileSync(root + 'NativeLiveAssistantTurnRow.swift', 'utf8');
  const thinking = readFileSync(root + 'NativeLiveVisibleThinkingSurface.swift', 'utf8');
  const actions = readFileSync(root + 'NativeLiveAssistantActions.swift', 'utf8');
  assert.match(row, /processSections\.showsLoading/);
  assert.match(row, /processSections\.showsActivity/);
  assert.doesNotMatch(row, /timestampText:turn\.timestamp|else if let timestamp/);
  assert.match(thinking, /Text\("Thought process"\)/);
  assert.match(thinking, /@State private var isExpanded/);
  assert.doesNotMatch(thinking, /toggleActivity|nativeLiveMessageUIState/);
  assert.match(actions, /if let timestamp = turn\.timestamp/);
  assert.ok(actions.indexOf('if let timestamp') > actions.indexOf('if turn.canRetry'));
});
test('process section gaps are 18 while body/footer spacing stays 6', () => {
  const layout = readFileSync('ios/LeileiOS/LeileiOS/Chat/ChatPresentationLayout.swift', 'utf8');
  const row = readFileSync(root + 'NativeLiveAssistantTurnRow.swift', 'utf8');
  assert.match(layout, /processSectionSpacing: CGFloat = 18/);
  assert.match(layout, /assistantSpacing: CGFloat = 6/);
  assert.match(row, /ChatPresentationLayout\.processSectionSpacing - ChatPresentationLayout\.assistantSpacing/);
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
  assert.match(header, /\.font\(\.system\(size: 14, weight: \.light\)\)\s*\.foregroundStyle\(\.tertiary\)/);
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
  assert.match(list, /LazyVStack\(spacing: ChatPresentationLayout\.turnSpacing\)/);
});
