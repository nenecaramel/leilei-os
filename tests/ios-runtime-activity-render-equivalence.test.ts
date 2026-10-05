import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';

const files = ['NativeLiveRuntimeActivity.swift', 'NativeLiveTaskActivity.swift', 'NativeLiveToolActivity.swift', 'NativeLiveRuntimeInteractions.swift', 'NativeLiveActivitySheets.swift', 'NativeLiveToolPresentation.swift', 'NativeLiveInteractions.swift'];
const fixture = 'tests/fixtures/runtime-activity-main-8efd5977/';
// These copies alone are instrumented. Product sources are never modified by
// the harness. Both versions receive precisely the same probes.
function closing(source: string, open: number) {
  let depth = 1, quoted = false;
  for (let i = open + 1; i < source.length; i++) {
    if (source[i] === '"' && source[i - 1] !== '\\') quoted = !quoted;
    if (quoted) continue;
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return i;
  }
  throw new Error('Unbalanced Swift block');
}
function instrument(source: string) {
  const matches = [...source.matchAll(/^(?:private )?struct (\w+): View/gm)];
  for (const match of matches.reverse()) {
    const start = match.index!, open = source.indexOf('{', start), end = closing(source, open);
    let block = source.slice(start, end + 1);
    const type = match[1];
    const id = type.includes('InteractionCard') || type.includes('HistoryRow') ? 'interaction.id' : type.includes('QuestionActivity') ? 'question.id' : type.includes('Task') ? 'task.id' : type.includes('ToolActivityRow') ? 'tool.id' : type.includes('Lifecycle') ? 'lifecycle.id' : '""';
    const key = `"${type}-\\(${id})"`;
    const bodyAt = block.indexOf('var body: some View {');
    const bodyOpen = block.indexOf('{', bodyAt), bodyEnd = closing(block, bodyOpen);
    let body = block.slice(bodyOpen + 1, bodyEnd);
    const buttons = [...body.matchAll(/Button(?:\([^\n]*\))?\s*\{/g)];
    // Reverse replacements keep original offsets valid; indices are lexical.
    for (let index = buttons.length - 1; index >= 0; index--) {
      const b = buttons[index], at = b.index!, actionOpen = body.indexOf('{', at), actionEnd = closing(body, actionOpen);
      const action = body.slice(actionOpen + 1, actionEnd);
      const prefix = body.slice(at, actionOpen).trim();
      const actionKey = `"${type}.button${index}-\\(${id})"`;
      const captured = `ActivityProbe.capture(${actionKey}, {${action}})`;
      if (prefix === 'Button') {
        const labelOpen = body.indexOf('{', actionEnd + 1), labelEnd = closing(body, labelOpen);
        const label = body.slice(labelOpen + 1, labelEnd);
        body = body.slice(0, at) + `Button(action: ${captured}) {${label}}.activityEnabled(${actionKey})` + body.slice(labelEnd + 1);
      } else {
        body = body.slice(0, at) + prefix.slice(0, -1) + `, action: ${captured}).activityEnabled(${actionKey})${prefix.startsWith('Button("Done"') ? '.activityFrame("system.nav-button.done")' : ''}` + body.slice(actionEnd + 1);
      }
    }
    if (type === 'NativeLiveToolActivityRow') body = body.replace(/state: tool.state\s*\)/, match => match + '.activityFrame("tool-card-\\(tool.id)")');
    if (type === 'NativeLiveTurnActivityView') body = body.replace('\n            if effectiveExpanded', '\n            .activityFrame("header")\n            if effectiveExpanded');
    let state = type === 'NativeLiveTurnActivityView' ? 'isShowingMurmur' : type === 'NativeLiveTaskResourceRow' ? 'isShowingResources' : /Card|QuestionActivity|HistoryRow/.test(type) && !type.includes('InteractionCard') ? 'isShowingDetails' : null;
    body += `\n.activityFrame(${key})` + (state ? `\n.onAppear { ActivityProbe.states[ActivityProbe.key(${key})] = { ${state} } }` : '') + '\n';
    block = block.slice(0, bodyOpen + 1) + body + block.slice(bodyEnd);
    block = block.replace(/ProgressView\(\)/g, `ProgressView().activityFrame("spinner-${type}-\\(${id})")`);
    source = source.slice(0, start) + block + source.slice(end + 1);
  }
  return source.replace(/^private struct /gm, 'struct ');
}

test('Runtime Activity real rendering and compiled interactions match exact main; padding negative is rejected', {
  skip: process.platform !== 'darwin' || !process.env.UI_ACTIVITY_SIMULATOR_ID ? 'Requires UI_ACTIVITY_SIMULATOR_ID' : false,
}, () => {
  const dir = process.env.UI_ACTIVITY_RENDER_CACHE ?? mkdtempSync(path.join(os.tmpdir(), 'leilei-activity-render-'));
  mkdirSync(dir, { recursive: true });
  const sim = process.env.UI_ACTIVITY_SIMULATOR_ID!, bundle = 'com.leileios.tests.activity-equivalence';
  try {
    cpSync('ios/LeileiOS', path.join(dir, 'ios'), { recursive: true, filter: p => !p.includes('xcuserdata') });
    const root = path.join(dir, 'ios/LeileiOS/Chat/MessageSurface');
    const original = readFileSync(fixture + 'NativeLiveRuntimeActivity.swift', 'utf8');
    const cards = readFileSync(fixture + 'NativeLiveInteractions.swift', 'utf8');
    const names = [...new Set([...original.matchAll(/\b(?:struct|enum|func|let)\s+(\w+)/g)].filter(m => /^[A-Z]/.test(m[1]) || m[1].startsWith('nativeLive')).filter(m => m[1] !== 'NativeLiveToolCallState').map(m => m[1]).concat('NativeLivePermissionInteractionCard', 'NativeLiveQuestionInteractionCard'))];
    const rename = (s: string, prefix: string) => s.replace(new RegExp('\\b(' + names.join('|') + ')\\b', 'g'), n => prefix + n);
    for (const file of files) writeFileSync(path.join(root, file), instrument(readFileSync('ios/LeileiOS/LeileiOS/Chat/MessageSurface/' + file, 'utf8')));
    writeFileSync(path.join(root, 'BaselineRuntimeActivity.swift'), rename(instrument(original.replace(/enum NativeLiveToolCallState: Equatable \{[\s\S]*?\n\}/, '')), 'Baseline'));
    writeFileSync(path.join(root, 'BaselineInteractions.swift'), rename(instrument(cards), 'Baseline'));
    const bad = original.replace('.padding(.vertical, 9)', '.padding(.vertical, 10)');
    assert.notEqual(bad, original);
    writeFileSync(path.join(root, 'RejectedRuntimeActivity.swift'), rename(instrument(bad.replace(/enum NativeLiveToolCallState: Equatable \{[\s\S]*?\n\}/, '')), 'Rejected'));
    writeFileSync(path.join(root, 'RejectedInteractions.swift'), rename(instrument(cards), 'Rejected'));
    writeFileSync(path.join(dir, 'ios/LeileiOS/App/LeileiOSApp.swift'), readFileSync('tests/fixtures/ios-runtime-activity-render-equivalence.swift', 'utf8'));
    const build = spawnSync('xcodebuild', ['-project', path.join(dir, 'ios/LeileiOS.xcodeproj'), '-scheme', 'LeileiOS', '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', path.join(dir, 'build'), 'CODE_SIGNING_ALLOWED=NO', `PRODUCT_BUNDLE_IDENTIFIER=${bundle}`, 'build'], { encoding: 'utf8', timeout: 600000, maxBuffer: 30_000_000 });
    writeFileSync(path.join(dir, 'build.log'), build.stdout + build.stderr);
    assert.equal(build.status, 0, (build.stdout + build.stderr).split('\n').filter(l => l.includes('error:')).join('\n'));
    const installed = spawnSync('xcrun', ['simctl', 'install', sim, path.join(dir, 'build/Build/Products/Debug-iphonesimulator/LeileiOS.app')], { encoding: 'utf8' });
    assert.equal(installed.status, 0, installed.stderr);
    const fd = openSync(path.join(dir, 'run.log'), 'w');
    const run = spawnSync('xcrun', ['simctl', 'launch', '--console', '--terminate-running-process', sim, bundle], { stdio: ['ignore', fd, fd], timeout: 600000, env: { ...process.env, SIMCTL_CHILD_ACTIVITY_NEGATIVE: process.env.UI_ACTIVITY_NEGATIVE ?? '0' } });
    closeSync(fd);
    const output = readFileSync(path.join(dir, 'run.log'), 'utf8');
    console.info(output.trim());
    assert.ifError(run.error); assert.equal(run.status, 0, output); assert.match(output, /RuntimeActivity equivalence PASS/);
  } finally {
    spawnSync('xcrun', ['simctl', 'uninstall', sim, bundle]);
    if (!process.env.UI_ACTIVITY_RENDER_CACHE) rmSync(dir, { recursive: true, force: true });
  }
});
