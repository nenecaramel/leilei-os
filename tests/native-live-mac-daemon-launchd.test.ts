import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

// Every process-control command is stubbed: these tests must never reach the
// owner's real launchd job or daemon.
function fixture(t: test.TestContext, { canonical = true, nodeVersion = 'v22.23.3' } = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'leilei-launchd-test-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const home = join(temp, 'home');
  const root = canonical ? join(home, 'Developer/leilei-os-main') : join(temp, 'other-copy');
  const bin = join(temp, 'bin');
  const effects = join(temp, 'effects.txt');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'node_modules/tsx/dist'), { recursive: true });
  mkdirSync(bin);
  for (const name of ['native-live-mac-daemon-launchd.sh', 'native-live-mac-daemon-supervised.sh'])
    copyFileSync(resolve('scripts', name), join(root, 'scripts', name));
  // Fake tsx: records its script argument, then behaves per TEST_DAEMON_MODE.
  // It reads fixed paths: the config check deliberately runs under env -i.
  writeFileSync(join(root, 'node_modules/tsx/dist/cli.mjs'), `
import { appendFileSync, existsSync } from 'node:fs';
const script = process.argv[2];
const effects = ${JSON.stringify(effects)};
appendFileSync(effects, 'tsx ' + script.split('/').pop() + ' path=' + (process.env.PATH ?? '') + ' profile=' + (process.env.PROFILE_ONLY ?? '') + '\\n');
if (script.endsWith('check-config.ts')) process.exit(existsSync(${JSON.stringify(join(temp, 'config-incomplete'))}) ? 1 : 0);
if (process.env.TEST_DAEMON_MODE === 'wait') {
  appendFileSync(effects, 'daemon-ready\\n');
  process.on('SIGTERM', () => { appendFileSync(effects, 'daemon-sigterm\\n'); process.exit(0); });
  setInterval(() => {}, 1000);
} else process.exit(Number(process.env.TEST_DAEMON_STATUS ?? '0'));
`);
  writeFileSync(join(bin, 'uname'), '#!/bin/sh\necho Darwin\n', { mode: 0o755 });
  writeFileSync(join(bin, 'launchctl'), '#!/bin/sh\necho "launchctl $*" >> "$TEST_EFFECTS"\n[ "$1" = print ] && exit "${TEST_LAUNCHD_LOADED:-1}"\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(bin, 'pkill'), '#!/bin/sh\necho pkill >> "$TEST_EFFECTS"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'pgrep'), '#!/bin/sh\nexit "${TEST_FOREGROUND_RUNNING:-1}"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'sleep'), '#!/bin/sh\necho "sleep $1" >> "$TEST_EFFECTS"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'node'), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo ${nodeVersion}; exit 0; fi\nexec "${process.execPath}" "$@"\n`, { mode: 0o755 });
  const env = (extra: Record<string, string>) => ({ ...process.env, HOME: home, PATH: bin + ':' + process.env.PATH, TEST_EFFECTS: effects, PROFILE_ONLY: 'set', ...extra });
  const control = (args: string[], extra: Record<string, string> = {}) =>
    spawnSync('bash', [join(root, 'scripts/native-live-mac-daemon-launchd.sh'), ...args], { cwd: root, encoding: 'utf8', env: env(extra) });
  const supervise = (extra: Record<string, string> = {}) =>
    spawnSync('bash', [join(root, 'scripts/native-live-mac-daemon-supervised.sh')], { cwd: home, encoding: 'utf8', env: env(extra) });
  const read = (path: string) => existsSync(path) ? readFileSync(path, 'utf8') : '';
  const plist = join(home, 'Library/LaunchAgents/com.leileios.native-live-mac-daemon.plist');
  const failures = join(home, '.leileios/supervisor/quick-failures');
  const supervisorLog = join(home, '.leileios/logs/native-live-daemon-supervisor.log');
  const incompleteConfig = () => writeFileSync(join(temp, 'config-incomplete'), '');
  return { incompleteConfig, root, home, bin, effects, control, supervise, env, read, plist, failures, supervisorLog };
}

test('install writes a crash-restarting agent for the canonical checkout and loads it', (t) => {
  const f = fixture(t);
  const result = f.control(['install'], { TEST_FOREGROUND_RUNNING: '0' });
  assert.notEqual(result.status, 0, 'a terminal daemon that never exits blocks install');
  assert.match(result.stderr, /did not exit/);
  assert.equal(existsSync(f.plist), false);

  rmSync(f.effects, { force: true });
  const ok = f.control(['install']);
  assert.equal(ok.status, 0, ok.stderr);
  const plist = f.read(f.plist);
  assert.match(plist, /<key>Label<\/key><string>com\.leileios\.native-live-mac-daemon<\/string>/);
  assert.ok(plist.includes(`<string>${join(f.root, 'scripts/native-live-mac-daemon-supervised.sh')}</string>`));
  assert.ok(plist.includes(`<key>WorkingDirectory</key><string>${f.root}</string>`));
  assert.match(plist, /<key>KeepAlive<\/key>\s*<dict><key>SuccessfulExit<\/key><false\/><\/dict>/);
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.ok(plist.includes(`<key>PATH</key><string>${f.bin}:`), 'PATH pins the Node 22 used at install');
  const effects = f.read(f.effects);
  // Configuration was checked without the shell profile, then the job loaded.
  assert.match(effects, /tsx native-live-mac-daemon-check-config\.ts path=\S+ profile=\n/);
  assert.match(effects, /launchctl bootstrap gui\/\d+ \S+com\.leileios\.native-live-mac-daemon\.plist/);
});

test('install refuses before writing anything when launchd could not run the daemon', (t) => {
  const incomplete = fixture(t);
  incomplete.incompleteConfig();
  const cases: Array<[ReturnType<typeof fixture>, RegExp]> = [
    [fixture(t, { canonical: false }), /canonical/],
    [fixture(t, { nodeVersion: 'v24.1.0' }), /Node 22/],
    [incomplete, /\.env/],
  ];
  for (const [f, message] of cases) {
    const result = f.control(['install']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
    assert.equal(existsSync(f.plist), false);
    assert.doesNotMatch(f.read(f.effects), /bootstrap|pkill/);
  }
  const linux = fixture(t);
  writeFileSync(join(linux.bin, 'uname'), '#!/bin/sh\necho Linux\n', { mode: 0o755 });
  assert.match(linux.control(['install']).stderr, /only available on macOS/);
  assert.notEqual(linux.control(['bogus']).status, 0);
});

test('uninstall unloads the job and removes the agent; restart clears crash backoff', (t) => {
  const f = fixture(t);
  assert.equal(f.control(['install']).status, 0);
  mkdirSync(join(f.home, '.leileios/supervisor'), { recursive: true });
  writeFileSync(f.failures, '3\n');
  const restart = f.control(['restart'], { TEST_LAUNCHD_LOADED: '0' });
  assert.equal(restart.status, 0, restart.stderr);
  assert.match(f.read(f.effects), /launchctl kickstart -k gui\/\d+\/com\.leileios\.native-live-mac-daemon/);
  assert.equal(existsSync(f.failures), false);
  const removed = f.control(['uninstall'], { TEST_LAUNCHD_LOADED: '0' });
  assert.equal(removed.status, 0, removed.stderr);
  assert.match(f.read(f.effects), /launchctl bootout gui\/\d+\/com\.leileios\.native-live-mac-daemon/);
  assert.equal(existsSync(f.plist), false);
});

test('supervisor backs off after quick crashes and resets after a stable run', (t) => {
  const f = fixture(t);
  assert.equal(f.supervise({ TEST_DAEMON_STATUS: '1' }).status, 1);
  assert.equal(f.read(f.failures).trim(), '1');
  assert.doesNotMatch(f.read(f.effects), /sleep/);
  assert.equal(f.supervise({ TEST_DAEMON_STATUS: '1' }).status, 1);
  assert.equal(f.read(f.failures).trim(), '2');
  assert.match(f.read(f.effects), /sleep 10\n/);
  writeFileSync(f.failures, '40\n');
  f.supervise({ TEST_DAEMON_STATUS: '1' });
  assert.match(f.read(f.effects), /sleep 300\n/, 'backoff is capped at five minutes');
  // A crash after a stable run is not a crash loop.
  assert.equal(f.supervise({ TEST_DAEMON_STATUS: '1', LEILEIOS_SUPERVISOR_STABLE_SECONDS: '0' }).status, 1);
  assert.equal(existsSync(f.failures), false);
  assert.match(f.read(f.supervisorLog), /"outcome":"exited","status":1/);
});

test('supervisor refuses a wrong Node without starting the daemon', (t) => {
  const f = fixture(t, { nodeVersion: 'v24.1.0' });
  assert.equal(f.supervise().status, 78);
  assert.doesNotMatch(f.read(f.effects), /tsx/);
  assert.match(f.read(f.supervisorLog), /"outcome":"node_unavailable","found":"v24\.1\.0"/);
  assert.equal(f.read(f.failures).trim(), '1');
});

test('supervisor rotates an oversized daemon log', (t) => {
  const f = fixture(t);
  const log = join(f.home, '.leileios/logs/native-live-daemon.log');
  mkdirSync(join(f.home, '.leileios/logs'), { recursive: true });
  writeFileSync(log, '');
  truncateSync(log, 10 * 1024 * 1024 + 1);
  assert.equal(f.supervise().status, 0);
  assert.ok(existsSync(log + '.1'));
  assert.ok(readFileSync(log).length < 1024);
});

test('supervisor forwards a launchd stop to the daemon and exits cleanly', async (t) => {
  const f = fixture(t);
  const child = spawn('bash', [join(f.root, 'scripts/native-live-mac-daemon-supervised.sh')], { cwd: f.home, env: f.env({ TEST_DAEMON_MODE: 'wait' }) });
  t.after(() => { child.kill('SIGKILL'); });
  for (let i = 0; i < 200 && !f.read(f.effects).includes('daemon-ready'); i++) await new Promise(r => setTimeout(r, 25));
  assert.match(f.read(f.effects), /daemon-ready/);
  const exited = new Promise<number | null>(accept => child.once('exit', code => accept(code)));
  child.kill('SIGTERM');
  assert.equal(await exited, 0);
  assert.match(f.read(f.effects), /daemon-sigterm/);
  assert.match(f.read(f.supervisorLog), /"outcome":"stopped"/);
  assert.equal(existsSync(f.failures), false);
});
