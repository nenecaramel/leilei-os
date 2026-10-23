import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { assertInteractionThemePreservesOriginal } from './ios-theme-interaction-assertions.js';
import { withoutSwiftPaint } from './helpers/swift-paint.js';

const root = 'ios/LeileiOS/LeileiOS/Chat/MessageSurface/';
const fixture = 'tests/fixtures/runtime-activity-main-8efd5977/';
const read = (file: string) => readFileSync(root + file, 'utf8');
const old = (file: string) => readFileSync(fixture + file, 'utf8');
// Preserve string literals as well as whitespace inside them: only formatting
// whitespace outside Swift quoted strings is insignificant. Appearance is not
// conserved; structure, actions and data flow are.
const normalize = (source: string) => withoutSwiftPaint(source).replace(/"(?:\\.|[^"\\])*"|\s+/g, text => text.startsWith('"') ? text : '');
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
  // The drawer text constant is appearance; the sheets themselves are conserved.
  if (file === 'NativeLiveActivitySheets.swift') source = source.replace(/enum NativeLiveDrawerText \{[\s\S]*?\n\}\n\n/, '');
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
  if (file === 'NativeLiveTaskActivity.swift') {
    // Task status/child rows are still driven by canonical projections. Glass
    // is presentation-only; prepareID is the approved Tasks sheet route.
    for (const required of [
      'struct NativeLiveActivityGlassRow: ViewModifier',
      'let task: NativeLiveTurnActivityProjection.TaskActivity',
      'var prepareID: String? = nil',
      'Text(task.displayTitle)',
      'ForEach(childTools) { tool in',
      'ForEach(childQuestions) { question in',
      'if !task.resourceLinks.isEmpty',
      'permissionInteractions(tool)',
      'onResolveInteraction: onResolveInteraction',
      'if prepareID != nil { showingTasks = true }',
      'if let prepareID { NativeLiveTasksSheet(prepareID: prepareID) }',
      '.sheet(isPresented: $isShowingResources)',
      'nativeLiveJSONDetail(',
    ]) assert.ok(source.includes(required), 'Task boundary: '+required);
    assert.match(source,/if task\.isFailed|if task\.isFailed/);
    assert.match(source,/else if task\.isCancelled/);
    assert.match(source,/else if task\.isTerminal/);
    assert.match(source,/turnIsActive\s*\|\|\s*task\.isBackgrounded == true/);
    assert.match(source,/if iMessageWallpaperVisible \{\s*content[\s\S]*?\.glassEffect\(/);
    assert.match(source,/else \{\s*content\s*\}/);
    return;
  }
  if (file === 'NativeLiveToolActivity.swift') {
    for (const required of [
      'NativeLiveToolCallCard(',
      'ForEach(permissionInteractions) { interaction in',
      'interaction.isPending',
      'let onResolveInteraction',
      'NativeLivePermissionInteractionCard(',
      'onResolve: onResolveInteraction',
      'NativeLiveInteractionHistoryRow(',
      'presentation: .nestedPermission',
      'private var stateLabel: String',
      'isShowingDetails = true',
      '.sheet(isPresented: $isShowingDetails)',
      'title: nativeLiveToolDisplayName(toolName)',
      'secondaryDetail: resultDetail',
      'tertiaryDetail: resourceDetail',
      'status: isError ? "Failed" : "Done"',
    ]) assert.ok(source.includes(required), 'Tool boundary: '+required);
    assert.match(source,/private struct NativeLiveToolWallpaperGlass: ViewModifier/);
    assert.match(source,/if enabled \{\s*content\.glassEffect/);
    assert.match(source,/else \{\s*content\s*\}/);
    assert.equal(normalize(source.slice(source.indexOf('enum NativeLiveToolCallState:'), source.indexOf('struct NativeLiveToolCallCard:'))),
      normalize(baseline.slice(baseline.indexOf('enum NativeLiveToolCallState:'),baseline.indexOf('struct NativeLiveToolCallCard:'))),
      'Tool result states are unchanged');
    return;
  }
  if (file === 'NativeLiveRuntimeInteractions.swift') {
    for (const required of [
      'question.interaction',
      'interaction.isPending',
      'let onResolveInteraction',
      'NativeLiveQuestionInteractionCard(',
      'onResolve: onResolveInteraction',
      'status: question.statusLabel',
      'detail: question.questionDetail',
      'secondaryDetail: question.responseDetail',
      'presentation.title(for: interaction)',
      'presentation.statusLabel(for: interaction)',
      '.object(interaction.request)',
      'interaction.response.flatMap',
      'nativeLiveJSONDetail(.object($0))',
      'isShowingDetails = true',
      '.modifier(NativeLiveActivityGlassRow())',
    ]) assert.ok(source.includes(required), 'Question/history boundary: '+required);
    assert.match(source,/interaction\.status == "resolved"[\s\S]*interaction\.status == "cancelled"/);
    assert.equal((source.match(/\.sheet\(isPresented: \$isShowingDetails\)/g)??[]).length,2);
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
