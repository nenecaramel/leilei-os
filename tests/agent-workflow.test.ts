import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
const source = resolve('.');
const statusScript = join(source, 'scripts/agent-status.mjs');
const verifyScript = join(source, 'scripts/agent-verify.mjs');
function git(root: string, ...args: string[]) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function fixture(t: test.TestContext, map?: unknown) {
  const root = mkdtempSync(join(tmpdir(), 'leilei-agent-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Agent test');
  git(root, 'config', 'user.email', 'agent-test@example.invalid');
  mkdirSync(join(root, '.agent'));
  mkdirSync(join(root, 'drizzle/meta'), { recursive: true });
  const domainMap = map ?? (existsSync(join(source, '.agent/domain-map.json')) ? JSON.parse(readFileSync(join(source, '.agent/domain-map.json'), 'utf8')) : { surfaces: [], gates: {} });
  writeFileSync(join(root, '.agent/domain-map.json'), JSON.stringify(domainMap));
  writeFileSync(join(root, 'drizzle/meta/_journal.json'), JSON.stringify({ entries: [{ idx: 93, tag: '0093_test_journal_head' }] }));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.9.0' }));
  writeFileSync(join(root, '.gitignore'), 'ignored.txt\n');
  writeFileSync(join(root, 'baseline.txt'), 'base\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'baseline');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(root, 'switch', '-c', 'feature');
  return root;
}
function run(script: string, root: string, ...args: string[]) { assert.ok(existsSync(script), `${script} entrypoint is missing`); return spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' }); }
function json(script: string, root: string, ...args: string[]) { const r = run(script, root, ...args, '--json'); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); }
function file(root: string, path: string, content = 'changed\n') { mkdirSync(resolve(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), content); }
test('status includes branch commits, staged/unstaged/untracked paths, surfaces and refresh requirements', (t) => {
  const root = fixture(t);
  file(root, 'src/domains/bridge/native-live-mac-daemon.ts');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'native change');
  file(root, 'ios/LeileiOS/Smoke.swift');
  git(root, 'add', 'ios');
  file(root, 'web/src/smoke.ts');
  file(root, 'ignored.txt');
  file(root, 'baseline.txt', 'dirty\n');
  const s = json(statusScript, root);
  assert.equal(s.branch, 'feature');
  assert.equal(s.head, git(root, 'rev-parse', 'HEAD'));
  assert.equal(s.originMain, git(root, 'rev-parse', 'origin/main'));
  assert.equal(s.ahead, 1);
  assert.equal(s.behind, 0);
  assert.ok(s.dirtyFiles.some((r: {
    path: string;
  }) => r.path === 'web/src/smoke.ts'));
  assert.ok(s.changedFiles.includes('ios/LeileiOS/Smoke.swift'));
  assert.ok(!s.changedFiles.includes('ignored.txt'));
  assert.ok(s.changedSurfaces.includes('native-live'));
  assert.ok(s.changedSurfaces.includes('web'));
  assert.ok(s.changedSurfaces.includes('ios'));
  assert.equal(s.migrationJournalHead.tag, '0093_test_journal_head');
  assert.match(s.nodeVersion, /^v\d+/);
  assert.match(s.pnpmVersion, /^\d+/);
  assert.equal(s.macDaemonFreshRequired, true);
  assert.equal(s.iosRebuildRequired, true);
  assert.equal(s.productionAcceptanceRequired, true);
  assert.ok(s.recommendedVerification.length > 0);
});
test('status reports divergence and both old and new paths of a rename', (t) => {
  const root = fixture(t);
  git(root, 'switch', 'main');
  file(root, 'remote.txt');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'main advances');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(root, 'switch', 'feature');
  git(root, 'mv', 'baseline.txt', 'file with spaces.txt');
  git(root, 'commit', '-m', 'rename');
  const s = json(statusScript, root);
  assert.equal(s.ahead, 1);
  assert.equal(s.behind, 1);
  assert.ok(s.changedFiles.includes('baseline.txt'));
  assert.ok(s.changedFiles.includes('file with spaces.txt'));
});
test('status fails closed when origin/main cannot be resolved', (t) => {
  const root = fixture(t);
  git(root, 'update-ref', '-d', 'refs/remotes/origin/main');
  const r = run(statusScript, root, '--json');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /origin\/main/);
});
test('plan merges surfaces and deduplicates gates without running the canonical suite', (t) => {
  const root = fixture(t);
  file(root, 'src/domains/bridge/native-live-attachment-service.ts');
  file(root, 'src/domains/runtime/runtime-memory.ts');
  const p = json(verifyScript, root, '--plan');
  assert.ok(p.changedSurfaces.includes('native-live'));
  assert.ok(p.changedSurfaces.includes('mind-runtime'));
  const commands = p.gates.map((g: {
    command: string[];
    cwd: string;
  }) => JSON.stringify([g.cwd, g.command]));
  assert.equal(new Set(commands).size, commands.length);
  assert.ok(p.gates.some((g: {
    id: string;
  }) => g.id === 'production-runtime'));
  assert.ok(!p.gates.some((g: {
    command: string[];
  }) => JSON.stringify(g.command) === '["pnpm","test"]'));
});
test('workflow-only plan selects targeted workflow tests and marks unknown paths for review', (t) => {
  const root = fixture(t);
  file(root, 'scripts/agent-status.mjs');
  file(root, 'new-unmapped.txt');
  const p = json(verifyScript, root, '--plan');
  assert.ok(p.gates.some((g: {
    id: string;
  }) => g.id === 'agent-workflow'));
  assert.ok(!p.gates.some((g: {
    id: string;
  }) => g.id === 'production-runtime'));
  assert.deepEqual(p.unmappedFiles, ['new-unmapped.txt']);
});
test('default/plan never executes gates; run executes real commands and propagates gate failure', (t) => {
  const map = { version: 1, common_verification: [], gates: { one: { command: [process.execPath, '-e', "require('node:fs').appendFileSync('ran.txt','one\\n')"], cwd: '.' }, two: { command: [process.execPath, '-e', "require('node:fs').appendFileSync('ran.txt','two\\n');process.exit(7)"], cwd: '.' }, three: { command: [process.execPath, '-e', "require('node:fs').appendFileSync('ran.txt','three\\n')"], cwd: '.' } }, surfaces: [{ id: 'controlled', paths: ['change.txt'], verification: ['one', 'one', 'two', 'three'], runtime_locations: [], local_refresh: { mac_daemon: false, ios_rebuild: false, instructions: 'none' }, production_acceptance: { required: false, instructions: 'none' }, conflict_hotspots: [] }] };
  const root = fixture(t, map);
  file(root, 'change.txt');
  for (const args of [[], ['--plan']]) {
    const r = run(verifyScript, root, ...args);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(join(root, 'ran.txt')), false);
  }
  const r = run(verifyScript, root, '--run');
  assert.equal(r.status, 7, r.stderr);
  assert.equal(readFileSync(join(root, 'ran.txt'), 'utf8'), 'one\ntwo\n');
});
test('verify rejects conflicting modes and wrong Node gates before running anything', (t) => {
  const map = { version: 1, common_verification: [], gates: { web: { command: [process.execPath, '-e', "require('node:fs').writeFileSync('ran.txt','bad')"], cwd: '.', node_major: 999 } }, surfaces: [{ id: 'web', paths: ['change.txt'], verification: ['web'], runtime_locations: ['Web'], local_refresh: { mac_daemon: false, ios_rebuild: false, instructions: 'none' }, production_acceptance: { required: true, instructions: 'web' }, conflict_hotspots: [] }] };
  const root = fixture(t, map);
  file(root, 'change.txt');
  assert.notEqual(run(verifyScript, root, '--plan', '--run').status, 0);
  const r = run(verifyScript, root, '--run');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Node/);
  assert.equal(existsSync(join(root, 'ran.txt')), false);
});
test('run refuses unmapped paths before executing an otherwise valid gate', (t) => {
  const root = fixture(t, { version: 1, common_verification: ['marker'], gates: { marker: { command: [process.execPath, '-e', "require('node:fs').writeFileSync('ran.txt','bad')"], cwd: '.' } }, surfaces: [] });
  file(root, 'unknown.txt');
  const r = run(verifyScript, root, '--run');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unmapped/i);
  assert.equal(existsSync(join(root, 'ran.txt')), false);
});
test('whitespace gate covers committed branch diff as well as local edits', (t) => {
  const root = fixture(t);
  file(root, 'scripts/agent-status.mjs', 'trailing whitespace   \n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'committed whitespace');
  const p = json(verifyScript, root, '--plan');
  const gate = p.gates.find((g: {
    id: string;
  }) => g.id === 'diff-check');
  assert.ok(gate);
  const r = spawnSync(gate.command[0], gate.command.slice(1), { cwd: root, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /trailing whitespace/i);
});

test('source-only Native Live conversation changes retain runtime gates and refresh evidence', (t) => {
  const root = fixture(t);
  file(root, 'src/domains/conversation/native-live-conversation-service.ts');
  const plan = json(verifyScript, root, '--plan');
  assert.ok(plan.changedSurfaces.includes('native-live'));
  assert.ok(plan.gates.some((gate: { id: string }) => gate.id === 'production-runtime'));
  assert.equal(plan.macDaemonFreshRequired, true);
  assert.equal(plan.productionAcceptanceRequired, true);
});

test('actual Mac, relay and protocol paths select Native Live gates without needing a matching test edit', (t) => {
  for (const path of [
    'src/domains/bridge/mac/native-live-mac-working-directory-runtime.ts',
    'src/domains/bridge/relay/native-live-backend-relay.ts',
    'src/domains/bridge/protocol/native-live-runtime-protocol.ts',
  ]) {
    const root = fixture(t);
    file(root, path);
    const plan = json(verifyScript, root, '--plan');
    assert.ok(plan.changedSurfaces.includes('native-live'), path);
    assert.ok(plan.gates.some((gate: { id: string }) => gate.id === 'production-runtime'), path);
    assert.equal(plan.macDaemonFreshRequired, true, path);
  }
});

test('status remains bounded when the package-manager version probe stalls', (t) => {
  const root = fixture(t);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'pnpm'), `#!${process.execPath}\nsetTimeout(() => {}, 10000);\n`, { mode: 0o755 });
  const result = spawnSync(process.execPath, [statusScript, '--json'], {
    cwd: root, encoding: 'utf8', timeout: 8000,
    env: { ...process.env, PATH: bin + ':' + process.env.PATH },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).pnpmVersion, 'unavailable');
});

test('workflow-only changes include the existing workspace policy regression gate', (t) => {
  const root = fixture(t);
  file(root, 'AGENTS.md');
  const plan = json(verifyScript, root, '--plan');
  assert.ok(plan.gates.some((gate: { command: string[] }) =>
    gate.command.includes('tests/repository-hygiene.test.ts') &&
    gate.command.includes('coding-agent workspace policy is enforced by closeout commands')));
});

test('canonical typecheck covers executable TypeScript scripts as well as server source', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.match(pkg.scripts.typecheck, /tsconfig\.scripts\.json/);
  const scripts = JSON.parse(readFileSync('tsconfig.scripts.json', 'utf8'));
  assert.ok(scripts.include.includes('scripts/**/*.ts'));
  assert.equal(scripts.compilerOptions.noEmit, true);
  const map = JSON.parse(readFileSync('.agent/domain-map.json', 'utf8'));
  assert.ok(map.surfaces.some((surface: { paths: string[] }) => surface.paths.includes('tsconfig.scripts.json')));
});

test('production runtime gate includes real daemon recovery and message surface regressions', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const path of ['tests/native-live-mac-wake-broker-fallback.test.ts', 'tests/native-live-message-surface-contract.test.ts']) {
    assert.ok(pkg.scripts['test:production-runtime-gate'].split(/\s+/).includes(path), path);
  }
});

test('script typecheck rejects unsafe new scripts and emits or executes nothing', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'leilei-script-types-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  copyFileSync('tsconfig.json', join(root, 'tsconfig.json'));
  copyFileSync('tsconfig.scripts.json', join(root, 'tsconfig.scripts.json'));
  mkdirSync(join(root, 'scripts'));
  const path = join(root, 'scripts', 'probe.ts');
  writeFileSync(path, 'const value: number = "unsafe";\nthrow new Error("STARTUP_MUST_NOT_RUN");\n');
  const runCheck = () => spawnSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '-p', join(root, 'tsconfig.scripts.json')], { encoding: 'utf8' });
  const red = runCheck();
  assert.notEqual(red.status, 0);
  assert.match(red.stdout, /TS2322/);
  writeFileSync(path, 'const value: number = 1;\nthrow new Error("STARTUP_MUST_NOT_RUN");\n');
  const green = runCheck();
  assert.equal(green.status, 0, green.stdout + green.stderr);
  assert.equal(existsSync(join(root, 'dist')), false);
  assert.equal(existsSync(join(root, 'scripts', 'probe.js')), false);
});
