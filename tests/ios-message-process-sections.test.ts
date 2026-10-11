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
