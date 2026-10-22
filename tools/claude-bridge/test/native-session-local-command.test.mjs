import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// homedir() is captured when the production module is imported. A separate
// process isolates that import without changing HOME in the shared test runner.
function withArchiveHome(autoApply, check) {
  const home = mkdtempSync(path.join(tmpdir(), 'leileios-archive-test-'));
  try {
    if (autoApply) {
      const archive = path.join(home, '.leileios', 'archive');
      mkdirSync(archive, { recursive: true });
      writeFileSync(path.join(archive, 'AUTO_APPLY'), '');
    }
    const moduleUrl = new URL('../../../scripts/native-session-local.mjs', import.meta.url).href;
    execFileSync(process.execPath, ['--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import * as command from ${JSON.stringify(moduleUrl)};
      await (${check.toString()})(command);
    `], { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8', timeout: 10_000 });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test('local switch command pins Railway project and passes only needed relay credentials to the manual CLI', async () => {
  const { runLocalSwitch } = await import('../../../scripts/native-session-local.mjs');
  const calls = [], output = [];
  runLocalSwitch(['desktop', '00000000-0000-4000-8000-000000000001'], {
    environment: { PATH: '/fixture', HOME: '/fixture' },
    execute(command, args, options) {
      calls.push({ command, args, options });
      return command === 'railway' ? JSON.stringify({ NATIVE_LIVE_RELAY_AUTH_TOKEN: 'PRIVATE_TOKEN', MCP_SERVER_URL: 'https://fixture.example', OTHER_SECRET: 'PRIVATE_OTHER' }) : '{"owner":"desktop"}';
    }, print: value => output.push(value),
  });
  assert.deepEqual(calls[0].args, ['variable', 'list', '--project', 'fb68460c-fda4-4969-836b-577eaa29d8b1', '--environment', 'production', '--service', 'leilei-os', '--json']);
  assert.equal(calls[1].args[1], '--desktop-manual');
  assert.equal(calls[1].options.env.LEILEI_NATIVE_LIVE_RELAY_TOKEN, 'PRIVATE_TOKEN');
  assert.equal(calls[1].options.env.OTHER_SECRET, undefined);
  assert.doesNotMatch(output.join(''), /PRIVATE/);
});

test('local switch refuses invalid selection before credentials or side effects', async () => {
  const { runLocalSwitch } = await import('../../../scripts/native-session-local.mjs');
  for (const args of [[], ['desktop'], ['leileios', 'not-a-uuid'], ['unknown', '00000000-0000-4000-8000-000000000001']]) {
    assert.throws(() => runLocalSwitch(args, { execute() { assert.fail('must not execute'); } }), /Usage/);
  }
});

test('local switch lists without credentials and never prints credential acquisition errors', async () => {
  const { runLocalSwitch } = await import('../../../scripts/native-session-local.mjs');
  const calls = [];
  runLocalSwitch(['list'], { execute(command, args) { calls.push(command); assert.equal(args[1], '--list'); return '[]'; }, print() {} });
  assert.deepEqual(calls, [process.execPath]);
  assert.throws(() => runLocalSwitch(['leileios', '00000000-0000-4000-8000-000000000001'], { desktopRunning: () => false, execute() { throw new Error('PRIVATE_TOKEN'); } }), error => error.message === 'RELAY_CREDENTIALS_UNAVAILABLE');
});

test('selected conversation is forwarded explicitly and invalid identity is rejected before any side effect', async () => {
  const { runLocalSwitch } = await import('../../../scripts/native-session-local.mjs');
  const conversationId = '00000000-0000-4000-8000-000000000099';
  let childArgs;
  runLocalSwitch(['leileios', '00000000-0000-4000-8000-000000000001'], { desktopRunning: () => false,
    conversationId, archive: false, execute(command, args) {
      if (command === 'railway') return JSON.stringify({ NATIVE_LIVE_RELAY_AUTH_TOKEN: 'PRIVATE', MCP_SERVER_URL: 'https://fixture.example' });
      if (args[0].endsWith('native-session-switch.mjs')) childArgs = args;
      return '{}';
    }, print() {},
  });
  assert.deepEqual(childArgs.slice(-2), ['--conversation-id', conversationId]);
  assert.throws(() => runLocalSwitch(['desktop', conversationId], { conversationId: '../bad', execute() { assert.fail('must not execute'); } }), /INVALID_CONVERSATION_ID/);
});

test('local switch child budget covers the largest bounded request and reports its own timeout by code', async () => {
  const { runLocalSwitch, NATIVE_SWITCH_CHILD_TIMEOUT_MS } = await import('../../../scripts/native-session-local.mjs');
  const { NATIVE_HISTORY_REQUEST_TIMEOUT_MS, NATIVE_RELAY_RETRY_DELAYS_MS } = await import('../src/native-session-switch-restore.mjs');
  // The outer guard must never cut a legitimate sequence of switch requests,
  // each of which may use every retry.
  const oneRequest = (NATIVE_RELAY_RETRY_DELAYS_MS.length + 1) * NATIVE_HISTORY_REQUEST_TIMEOUT_MS
    + NATIVE_RELAY_RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0);
  assert.ok(NATIVE_SWITCH_CHILD_TIMEOUT_MS >= 4 * oneRequest);
  let childTimeout;
  assert.throws(() => runLocalSwitch(['leileios', '00000000-0000-4000-8000-000000000001'], { desktopRunning: () => false,
    execute(command, _args, options) {
      if (command === 'railway') return JSON.stringify({ NATIVE_LIVE_RELAY_AUTH_TOKEN: 'PRIVATE', MCP_SERVER_URL: 'https://fixture.example' });
      childTimeout = options.timeout;
      throw Object.assign(new Error('spawnSync node ETIMEDOUT PRIVATE'), { code: 'ETIMEDOUT', signal: 'SIGTERM', stderr: '' });
    }, print() {},
  }), error => error.message === 'NATIVE_SWITCH_TIMEOUT');
  assert.equal(childTimeout, NATIVE_SWITCH_CHILD_TIMEOUT_MS);
});

// A switch no longer archives by itself (continuation switching since #1109);
// the after-switch archive step stays available on its own.
test('the archive step plans without AUTO_APPLY, applies with it, and reports only sanitized failures', () => {
  withArchiveHome(false, ({ afterSwitchArchive }) => {
    const planned = afterSwitchArchive({ autoApply: false, env: {}, execute(_command, args) {
      assert.deepEqual(args.slice(1), [], 'plan-only: no --apply');
      return JSON.stringify({ mode: 'plan', results: [{ folder: '-fixture', keep: 22, archive: 40, keepMB: 103, archiveMB: 307, applied: null }] });
    } });
    assert.match(planned, /归档预演 -fixture：可归档 40 个（307 MB），保留 22 个（103 MB）/);
    const failed = afterSwitchArchive({ autoApply: false, env: {}, execute() { throw Object.assign(new Error('PRIVATE_DETAIL'), { stderr: 'ARCHIVE_REFERENCES_UNAVAILABLE\n' }); } });
    assert.equal(failed, '归档预演跳过：ARCHIVE_REFERENCES_UNAVAILABLE\n');
    let applied;
    const done = afterSwitchArchive({ autoApply: true, env: {}, execute(_c, args) { applied = args;
      return JSON.stringify({ mode: 'apply', results: [{ archive: 40, archiveMB: 307, keep: 22, keepMB: 103, applied: '-fixture' }] }); } });
    assert.equal(applied.at(-1), '--apply', 'the owner-created flag enables applying');
    assert.match(done, /已归档 40 个旧会话文件/);
    const skipped = afterSwitchArchive({ autoApply: true, env: {}, execute() { throw Object.assign(new Error('private fixture detail'), { stderr: 'ARCHIVE_REFERENCES_UNAVAILABLE\n' }); } });
    assert.match(skipped, /归档跳过：ARCHIVE_REFERENCES_UNAVAILABLE/);
    assert.doesNotMatch(skipped, /private fixture detail/);
  });
});

test('switching to LeileiOS refuses while Desktop runs, before credentials or any write', async () => {
  // Desktop can restart a window to run its scheduled wake, which appends to the
  // session LeileiOS continues. Only a quit Desktop cannot.
  const { runLocalSwitch, desktopAppRunning } = await import('../../../scripts/native-session-local.mjs');
  assert.throws(() => runLocalSwitch(['leileios', '00000000-0000-4000-8000-000000000001'], {
    desktopRunning: () => true, execute() { assert.fail('must not execute'); } }), error => error.message === 'NATIVE_DESKTOP_STILL_RUNNING');
  assert.equal(desktopAppRunning({ execute: (command, args) => { assert.deepEqual([command, args], ['/usr/bin/pgrep', ['-x', 'Claude']]); return '123\n'; } }), true);
  assert.equal(desktopAppRunning({ execute: () => { throw Object.assign(new Error('exit 1'), { status: 1 }); } }), false);
  assert.throws(() => desktopAppRunning({ execute: () => { throw Object.assign(new Error('boom'), { status: 2 }); } }), /DESKTOP_STATE_UNKNOWN/);
  const calls = [];
  runLocalSwitch(['desktop', '00000000-0000-4000-8000-000000000001'], { desktopRunning: () => true, print() {},
    execute(command) { calls.push(command); return command === 'railway' ? JSON.stringify({ NATIVE_LIVE_RELAY_AUTH_TOKEN: 't', MCP_SERVER_URL: 'https://fixture.example' }) : '{}'; } });
  assert.equal(calls.length, 2, 'the Desktop direction is unaffected');
});

test('daily switching selects continuation mode and does not run archive even with AUTO_APPLY', () => {
  withArchiveHome(true, ({ runLocalSwitch }) => {
    const calls = [];
    runLocalSwitch(['leileios', '00000000-0000-4000-8000-000000000001'], { desktopRunning: () => false, print() {}, execute(command, args) {
      if (command === 'railway') return JSON.stringify({ NATIVE_LIVE_RELAY_AUTH_TOKEN: 'fixture', MCP_SERVER_URL: 'https://fixture.example' });
      calls.push(args); return '{}';
    } });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(2, 4), ['--history-mode', 'continuation']);
    assert.ok(calls[0][0].endsWith('native-session-switch.mjs'));
  });
});


test('standalone archive preview explains protection reasons and unresolved execution without changing mode',async()=>{
 const {afterSwitchArchive}=await import('../../../scripts/native-session-local.mjs');
 const text=afterSwitchArchive({autoApply:false,env:{},execute(_command,args){
  assert.equal(args.includes('--apply'),false);
  return JSON.stringify({mode:'plan',results:[{folder:'-fixture',keep:4,archive:3,keepMB:8,archiveMB:12,applied:null,protectionCounts:{window:2,referenced:1,recent:1,open:0},unverified:1,archiveDetails:[{sessionId:'old',reasons:['history_only_source']}]}]});
 }});
 assert.match(text,/官端窗口 2/);assert.match(text,/checkpoint 等引用 1/);assert.match(text,/无法验证 1/);
 assert.match(text,/历史展示旧源 1/);
});
