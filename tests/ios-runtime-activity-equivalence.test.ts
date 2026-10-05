import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';

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
  assert.equal(normalize(source), normalize(expected(boundaries[file])), file);
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
    if (file !== 'NativeLiveRuntimeActivity.swift') assert.equal(read(file), old(file), file);
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
