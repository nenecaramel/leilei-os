import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { assertInteractionThemePreservesOriginal } from './ios-theme-interaction-assertions.js';

const root = 'ios/LeileiOS/LeileiOS/Chat/MessageSurface/';
const fixture = 'tests/fixtures/runtime-activity-main-8efd5977/';
const read = (file: string) => readFileSync(root + file, 'utf8');
const old = (file: string) => readFileSync(fixture + file, 'utf8');
// Preserve string literals as well as whitespace inside them: only formatting
// whitespace outside Swift quoted strings is insignificant.
const normalize = (source: string) => source.replace(/"(?:\\.|[^"\\])*"|\s+/g, text => text.startsWith('"') ? text : '');
const original = old('NativeLiveRuntimeActivity.swift');
const markers = [...original.matchAll(/^(?:private )?(?:struct|enum|func|let) (\w+)/gm)];
const blocks = new Map(markers.map((match, index) => [match[1], original.slice(match.index, markers[index + 1]?.index ?? original.length).trim()]));
const boundaries: Record<string, string[]> = {
  'NativeLiveRuntimeActivity.swift': ['NativeLiveTurnActivityView'],
  'NativeLiveTaskActivity.swift': ['NativeLiveLifecycleActivityRow', 'NativeLiveTaskActivityRow', 'NativeLiveTaskResourceRow'],
  'NativeLiveToolActivity.swift': ['NativeLiveToolActivityRow', 'NativeLiveToolCallState', 'NativeLiveToolCallCard', 'NativeLiveToolResultCard'],
  'NativeLiveRuntimeInteractions.swift': ['NativeLiveQuestionActivityRow', 'NativeLiveInteractionHistoryRow'],
  'NativeLiveActivitySheets.swift': ['NativeLiveMurmurSheet', 'NativeLiveToolDetailSheet'],
  'NativeLiveToolPresentation.swift': ['nativeLiveLeileiOSToolDisplayNames', 'nativeLiveToolDisplayName', 'nativeLiveJSONDetail', 'nativeLiveJSONDescription'],
};
function expected(names: string[]) {
  return 'import SwiftUI\nimport Foundation\n\n' + names.map(name => {
    const block = blocks.get(name)!;
    return block.replace(/^private struct /, 'struct ');
  }).join('\n\n') + '\n';
}
function conserve(file: string, source: string) {
  // Stage 6 permits exactly this provider-specific presentation seam. The
  // generic card, permission subtree and all other complete blocks remain pinned.
  if (file === 'NativeLiveToolActivity.swift') source = source
    .replace(/            if tool.state != \.running,[\s\S]*?            \} else \{\n/, '')
    .replace(/\n            \}\n\n            ForEach/, '\n\n            ForEach');
  let baseline = expected(boundaries[file]);
  if (file === 'NativeLiveToolPresentation.swift') {
    // Only the four retired album display labels and their prefix are removed.
    baseline = baseline.split('\n').filter(line => !line.includes('"mcp__leileios_album__')).join('\n');
    assert.doesNotMatch(source, /mcp__leileios_album__/);
  }
  if (file === 'NativeLiveRuntimeActivity.swift') {
    // Header typography/arrow placement intentionally changed. Keep its init,
    // every expanded subtree, lifecycle, interaction dispatch and sheet exact.
    const body='    var body: some View {';
    const content='            if effectiveExpanded {';
    const themeDeclaration = /^\s*@Environment\(\\\.(?:chatTheme|iMessageWallpaperVisible)\) private var [^\n]+/gm;
    assert.match(source, /@Environment\(\\\.chatTheme\) private var chatTheme/);
    assert.match(source, /@Environment\(\\\.iMessageWallpaperVisible\) private var iMessageWallpaperVisible/);
    assert.equal(normalize(source.slice(0,source.indexOf(body)).replace(themeDeclaration, '')),
      normalize(baseline.slice(0,baseline.indexOf(body))), 'Activity inputs, state and initializer');
    // prepareID was intentionally added to Task rows. Every other expanded
    // subtree and interaction dispatch remains pinned to the historical code.
    assert.match(source, /prepareID: projection\.prepareID/);
    assert.equal(normalize(source.slice(source.indexOf(content)).replace('prepareID: projection.prepareID,', '')),
      normalize(baseline.slice(baseline.indexOf(content))), 'Expanded Activity, callbacks and sheets');
    const header=source.slice(source.indexOf(body),source.indexOf(content));
    assert.equal((header.match(/expansion\.toggleActivity\(\)/g)??[]).length,2);
    assert.match(header,/\.disabled\(header\.isEmpty\)/);
    assert.match(header,/isShowingMurmur = true/);
    return;
  }
  assert.equal(normalize(source), normalize(baseline), file);
}
test('Runtime Activity baseline fixtures are exact 8efd5977 Git blobs', () => {
  const manifest = JSON.parse(readFileSync(fixture + 'blobs.json', 'utf8'));
  assert.equal(manifest.commit, '8efd59775ce08cb1560e8f97d3ac939577fcd2c0');
  for (const [file, sha] of Object.entries(manifest.files)) {
    const bytes = readFileSync(fixture + file);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), sha, file);
  }
});
test('All six Activity presentation boundaries conserve complete original blocks', () => {
  for (const file of Object.keys(boundaries)) conserve(file, read(file));
});
test('Projection, interaction state/submit/answers and history semantics remain byte identical', () => {
  const manifest = JSON.parse(readFileSync(fixture + 'blobs.json', 'utf8'));
  for (const file of Object.keys(manifest.files)) {
    if (file === 'NativeLiveInteractions.swift') {
      assertInteractionThemePreservesOriginal(read(file), old(file));
    } else if (file !== 'NativeLiveRuntimeActivity.swift') {
      assert.equal(read(file), old(file), file);
    }
  }
});
test('Conservation rejects wrong pending-question dispatch and changed JSON string whitespace', () => {
  const file = 'NativeLiveRuntimeActivity.swift';
  let source = read(file);
  if (process.env.ACTIVITY_CALLBACK_NEGATIVE) source = source.replace('case "question":', 'case "wrong-question":');
  conserve(file, source);
  const wrong = source.replace('case "question":', 'case "wrong-question":');
  assert.notEqual(wrong, source);
  assert.throws(() => conserve(file, wrong));
  const helper = read('NativeLiveToolPresentation.swift');
  assert.throws(() => conserve('NativeLiveToolPresentation.swift', helper.replace('separator: ", "', 'separator: ","')));
});
