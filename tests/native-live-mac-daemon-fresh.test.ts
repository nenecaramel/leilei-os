import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
const script = resolve('scripts/native-live-mac-daemon-fresh.sh');
function git(root: string, ...args: string[]) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function fixture(t: test.TestContext, canonical = true) {
  const temp = mkdtempSync(join(tmpdir(), 'leilei-fresh-test-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const home = join(temp, 'home');
  const root = canonical ? join(home, 'Developer/leilei-os-main') : join(temp, 'other-copy');
  const bin = join(temp, 'bin');
  mkdirSync(root, { recursive: true });
  mkdirSync(bin);
  const remote = join(temp, 'origin.git');
  git(temp, 'init', '--bare', remote);
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Agent test');
  git(root, 'config', 'user.email', 'agent-test@example.invalid');
  writeFileSync(join(root, 'tracked.txt'), 'base\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'baseline');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', 'origin', 'main');
  const marker = join(temp, 'effects.txt');
  for (const name of ['pkill', 'pnpm', 'sleep'])
    writeFileSync(join(bin, name), `#!/bin/sh\necho ${name} >> "$TEST_EFFECTS"\nexit 0\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'pgrep'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  // Never reach the owner's real launchd job; default to "not installed".
  writeFileSync(join(bin, 'launchctl'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  // Model the supported daemon runtime even when the test runner uses Node 24.
  writeFileSync(join(bin, 'node'), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo v24.11.1; exit 0; fi\nexec "${process.execPath}" "$@"\n`, { mode: 0o755 });
  const run = (...args: string[]) => spawnSync('bash', [script, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, HOME: home, PATH: bin + ':' + process.env.PATH, TEST_EFFECTS: marker, TEST_PROCESSES: join(temp, "processes.txt") } });
  return { root, home, marker, run, temp, remote, bin };
}
test('normal fresh refuses a feature branch before sync or restart and preserves edits', (t) => {
  const f = fixture(t);
  git(f.root, 'switch', '-c', 'feature');
  writeFileSync(join(f.root, 'tracked.txt'), 'owner edit\n');
  const before = git(f.root, 'rev-parse', 'HEAD');
  const r = f.run();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /main|fresh-current/);
  assert.equal(existsSync(f.marker), false);
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), before);
  assert.equal(readFileSync(join(f.root, 'tracked.txt'), 'utf8'), 'owner edit\n');
});
test('normal fresh refuses a noncanonical main checkout', (t) => { const f = fixture(t, false); const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /canonical/); assert.equal(existsSync(f.marker), false); });
test('dirty main fails closed without autostashing or restarting', (t) => { const f = fixture(t); writeFileSync(join(f.root, 'tracked.txt'), 'owner edit\n'); const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /dirty|local changes/); assert.equal(existsSync(f.marker), false); assert.equal(git(f.root, 'stash', 'list'), ''); assert.equal(readFileSync(join(f.root, 'tracked.txt'), 'utf8'), 'owner edit\n'); });
test('explicit current feature starts without fetching or rebasing', (t) => { const f = fixture(t, false); git(f.root, 'switch', '-c', 'feature'); writeFileSync(join(f.root, 'tracked.txt'), 'feature\n'); git(f.root, 'commit', '-am', 'feature'); git(f.root, 'remote', 'set-url', 'origin', join(f.home, 'unreachable.git')); const before = git(f.root, 'rev-parse', 'HEAD'); const r = f.run('--current'); assert.equal(r.status, 0, r.stderr); assert.equal(git(f.root, 'rev-parse', 'HEAD'), before); assert.match(readFileSync(f.marker, 'utf8'), /pnpm/); });
test('clean canonical main supports fast-forward refresh', (t) => { const f = fixture(t); const r = f.run(); assert.equal(r.status, 0, r.stderr); assert.match(readFileSync(f.marker, 'utf8'), /pnpm/); });
test('detached HEAD and unknown flags refuse restart', (t) => { const f = fixture(t); git(f.root, 'checkout', '--detach'); assert.notEqual(f.run('--current').status, 0); assert.equal(existsSync(f.marker), false); git(f.root, 'switch', 'main'); assert.notEqual(f.run('--typo').status, 0); assert.equal(existsSync(f.marker), false); });
test('normal fresh refuses unpublished main commits instead of starting them', (t) => { const f = fixture(t); writeFileSync(join(f.root, 'tracked.txt'), 'unpublished\n'); git(f.root, 'commit', '-am', 'unpublished'); const before = git(f.root, 'rev-parse', 'HEAD'); const r = f.run(); assert.notEqual(r.status, 0); assert.equal(existsSync(f.marker), false); assert.equal(git(f.root, 'rev-parse', 'HEAD'), before); });

function signingFixture(t: test.TestContext) {
  const f = fixture(t);
  const relativePath = 'ios/LeileiOS/LeileiOS.xcodeproj/project.pbxproj';
  const signingPath = join(f.root, relativePath);
  mkdirSync(join(f.root, 'ios/LeileiOS/LeileiOS.xcodeproj'), { recursive: true });
  writeFileSync(signingPath, 'DEVELOPMENT_TEAM = BASE;\n');
  git(f.root, 'add', 'ios');
  git(f.root, 'commit', '-m', 'tracked iOS signing');
  git(f.root, 'push', 'origin', 'main');
  const peer = join(f.temp, 'peer');
  git(f.temp, 'clone', '--branch', 'main', f.remote, peer);
  git(peer, 'config', 'user.name', 'Agent test');
  git(peer, 'config', 'user.email', 'agent-test@example.invalid');
  return { ...f, relativePath, signingPath, peer };
}

test('iOS dirty signing survives a successful fresh and unrelated main fast-forward', (t) => {
  const f = signingFixture(t);
  writeFileSync(f.signingPath, 'DEVELOPMENT_TEAM = OWNER_LOCAL;\n');
  const beforeDiff = git(f.root, 'diff', '--', f.relativePath);
  writeFileSync(join(f.peer, 'tracked.txt'), 'upstream server change\n');
  git(f.peer, 'commit', '-am', 'upstream server change');
  git(f.peer, 'push', 'origin', 'main');
  const expectedHead = git(f.peer, 'rev-parse', 'HEAD');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), expectedHead);
  assert.equal(readFileSync(f.signingPath, 'utf8'), 'DEVELOPMENT_TEAM = OWNER_LOCAL;\n');
  assert.equal(git(f.root, 'diff', '--', f.relativePath), beforeDiff);
  assert.equal(git(f.root, 'stash', 'list'), '');
  assert.match(readFileSync(f.marker, 'utf8'), /pnpm/);
});

test('upstream changes to the same dirty iOS file safely fail before daemon restart', (t) => {
  const f = signingFixture(t);
  writeFileSync(f.signingPath, 'DEVELOPMENT_TEAM = OWNER_LOCAL;\n');
  const head = git(f.root, 'rev-parse', 'HEAD');
  writeFileSync(join(f.peer, f.relativePath), 'DEVELOPMENT_TEAM = UPSTREAM;\n');
  git(f.peer, 'commit', '-am', 'upstream signing change');
  git(f.peer, 'push', 'origin', 'main');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /would be overwritten by merge/);
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), head);
  assert.equal(readFileSync(f.signingPath, 'utf8'), 'DEVELOPMENT_TEAM = OWNER_LOCAL;\n');
  assert.equal(git(f.root, 'stash', 'list'), '');
  assert.equal(existsSync(f.marker), false);
});

test('configured autostash cannot advance HEAD or alter dirty iOS signing', (t) => {
  const f = signingFixture(t);
  git(f.root, 'config', 'merge.autostash', 'true');
  writeFileSync(f.signingPath, 'DEVELOPMENT_TEAM = OWNER_LOCAL;\n');
  const head = git(f.root, 'rev-parse', 'HEAD');
  writeFileSync(join(f.peer, f.relativePath), 'DEVELOPMENT_TEAM = UPSTREAM;\n');
  git(f.peer, 'commit', '-am', 'upstream signing change');
  git(f.peer, 'push', 'origin', 'main');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /would be overwritten by merge/);
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), head);
  assert.equal(readFileSync(f.signingPath, 'utf8'), 'DEVELOPMENT_TEAM = OWNER_LOCAL;\n');
  assert.equal(git(f.root, 'stash', 'list'), '');
  assert.equal(existsSync(f.marker), false);
});

test('a runtime-to-iOS rename does not bypass dirty-path protection', (t) => {
  const f = fixture(t);
  const source = 'src/domains/bridge/native-live-runtime with spaces.ts';
  mkdirSync(join(f.root, 'src/domains/bridge'), { recursive: true });
  mkdirSync(join(f.root, 'ios'), { recursive: true });
  writeFileSync(join(f.root, source), 'runtime bytes\n');
  git(f.root, 'add', 'src');
  git(f.root, 'commit', '-m', 'runtime file');
  git(f.root, 'push', 'origin', 'main');
  git(f.root, 'mv', source, 'ios/renamed.swift');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(f.marker), false);
});


test('fresh stops the actual Node daemon as well as its launcher without matching lookalikes', (t) => {
  const f = fixture(t);
  const table = join(f.temp, 'processes.txt');
  const unrelated = ['bash -c echo tsx scripts/native-live-mac-daemon.ts', 'node scripts/native-live-mac-daemon.ts.backup'];
  writeFileSync(table, ['tsx scripts/native-live-mac-daemon.ts', '/opt/homebrew/bin/node --require loader scripts/native-live-mac-daemon.ts', ...unrelated].join('\n') + '\n');
  writeFileSync(join(f.bin, 'pkill'), '#!/bin/sh\npattern="$2"\n[ "$1" = "-9" ] && pattern="$3"\ngrep -Ev "$pattern" "$TEST_PROCESSES" > "$TEST_PROCESSES.tmp" || true\nmv "$TEST_PROCESSES.tmp" "$TEST_PROCESSES"\necho pkill >> "$TEST_EFFECTS"\n', { mode: 0o755 });
  writeFileSync(join(f.bin, 'pgrep'), '#!/bin/sh\ngrep -Eq "$2" "$TEST_PROCESSES"\n', { mode: 0o755 });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(table, 'utf8').trim().split('\n'), unrelated);
  assert.match(readFileSync(f.marker, 'utf8'), /pkill[\s\S]*pnpm/);
});

test('wrong Node major is rejected before stopping the owner daemon', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.bin, 'node'), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo v26.5.0; exit 0; fi\nexec "${process.execPath}" "$@"\n`, { mode: 0o755 });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Node 24/);
  assert.equal(existsSync(f.marker), false);
});

test('fresh reinstalls the launchd agent instead of starting a second copy', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.bin, 'launchctl'), '#!/bin/sh\necho "launchctl $*" >> "$TEST_EFFECTS"\nexit 0\n', { mode: 0o755 });
  // Reinstalling re-pins the verified Node/PATH; the installer has its own tests.
  mkdirSync(join(f.root, 'scripts'));
  writeFileSync(join(f.root, 'scripts/native-live-mac-daemon-launchd.sh'), 'echo "launchd-script $*" >> "$TEST_EFFECTS"\n');
  git(f.root, 'add', 'scripts');
  git(f.root, 'commit', '-m', 'launchd control');
  git(f.root, 'push', 'origin', 'main');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const effects = readFileSync(f.marker, 'utf8');
  assert.match(effects, /launchd-script install\n/);
  assert.doesNotMatch(effects, /pkill|pnpm|kickstart/);
});

test('fresh-current from another checkout refuses while launchd owns the daemon', (t) => {
  const f = fixture(t, false);
  writeFileSync(join(f.bin, 'launchctl'), '#!/bin/sh\n[ "$1" = print ] && exit 0\necho "launchctl $*" >> "$TEST_EFFECTS"\nexit 0\n', { mode: 0o755 });
  const result = f.run('--current');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /launchd stop/);
  assert.equal(existsSync(f.marker), false);
});
