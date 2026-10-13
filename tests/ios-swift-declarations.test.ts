import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, cpSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import test from 'node:test';
import { swiftDeclarations } from './helpers/ios-swift-declarations.js';

const mac = { skip: process.platform !== 'darwin' };
function fixture(t: test.TestContext, source: string) {
  const root = mkdtempSync(join(tmpdir(), 'swift-declarations-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'source.swift'); writeFileSync(path, source);
  return { root, path };
}
test('Swift harness executes the whole selected method despite braces in strings and comments', mac, t => {
  const f = fixture(t, `
    private func selected() -> String {
      let marker = #"}"#
      /* } misleading brace */
      return "{" + marker
    }
    private func unrelated() -> String { "wrong" }
`);
  const declaration = swiftDeclarations(f.path)('func_decl', 'selected()');
  const main = join(f.root, 'main.swift'); writeFileSync(main, declaration + '\nprint(selected())\n');
  execFileSync('swiftc', ['-module-cache-path', join(f.root, 'cache'), main, '-o', join(f.root, 'check')], { timeout: 30_000 });
  assert.equal(execFileSync(join(f.root, 'check'), { encoding: 'utf8' }).trim(), '{}');
});
test('Swift selection follows the compiler through formatting and overloads', mac, t => {
  const f = fixture(t, `private func selected(value: String) -> String { value }
private func selected(_ value: Int) -> Int { value }
`);
  const declaration = swiftDeclarations(f.path)('func_decl', 'selected(value:)');
  const main = join(f.root, 'main.swift'); writeFileSync(main, declaration + '\nprint(selected(value: "chosen"))\n');
  execFileSync('swiftc', ['-module-cache-path', join(f.root, 'cache'), main, '-o', join(f.root, 'check')], { timeout: 30_000 });
  assert.equal(execFileSync(join(f.root, 'check'), { encoding: 'utf8' }).trim(), 'chosen');
});
test('Swift selection refuses missing, ambiguous and malformed declarations', mac, t => {
  const f = fixture(t, `struct A { private func selected() {} }
struct B { private func selected() {} }`);
  const declaration = swiftDeclarations(f.path);
  assert.throws(() => declaration('func_decl', 'missing()'));
  assert.throws(() => declaration('func_decl', 'selected()'));
  writeFileSync(f.path, 'func invalid( {');
  assert.throws(() => swiftDeclarations(f.path));
});

test('harmless padding, method spacing and a string brace leave production Swift behavior checks intact', mac, t => {
  const root = mkdtempSync(join(tmpdir(), 'swift-format-contract-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = [
    'ios/LeileiOS/LeileiOS/Pages/Mind',
    'ios/LeileiOS/LeileiOS/Pages/MindView.swift',
    'ios/LeileiOS/LeileiOS/Pages/DiaryView.swift',
    'ios/LeileiOS/LeileiOS/Pages/Diary/DiaryListPresentation.swift',
    'ios/LeileiOS/LeileiOS/Infrastructure/API/Mind',
  ];
  for (const file of files) { mkdirSync(dirname(join(root, file)), { recursive: true }); cpSync(file, join(root, file), { recursive: true }); }
  const path = join(root, files[0], 'MindKindList.swift');
  const source = readFileSync(path, 'utf8');
  writeFileSync(path, '\n'.repeat(200) + source
    .replace('    @MainActor\n    private func', '    @MainActor\n\n    private func')
    .replace('private func reload(preservingContent: Bool = false) async {',
      'private func reload(preservingContent: Bool = false) async {\n        let brace = "}"; _ = brace'));
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const result = execFileSync(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), '--test', '--test-reporter=tap',
    resolve('tests/ios-mind-header-count.test.ts'), resolve('tests/ios-list-refresh-retention.test.ts'),
    resolve('tests/ios-mind-boundaries.test.ts')], { cwd: root, env, encoding: 'utf8', timeout: 60_000 });
  assert.match(result, /# fail 0/);
});
