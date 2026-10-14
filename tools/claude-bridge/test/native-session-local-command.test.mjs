import test from 'node:test';
import assert from 'node:assert/strict';

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
    conversationId, execute(command, args) {
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
  const { NATIVE_HISTORY_REQUEST_TIMEOUT_MS, NATIVE_RESTORE_UPLOAD_TIMEOUT_MS, NATIVE_SERVER_REQUEST_TIMEOUT_MS } =
    await import('../src/native-session-switch-restore.mjs');
  // Client gives up on a large upload before the server's own request bound.
  assert.ok(NATIVE_RESTORE_UPLOAD_TIMEOUT_MS < NATIVE_SERVER_REQUEST_TIMEOUT_MS);
  // The outer guard must never cut a legitimate state + restore + release sequence,
  // leaving room for resumable attachment uploads after the restore commits.
  assert.ok(NATIVE_SWITCH_CHILD_TIMEOUT_MS >= 2 * (NATIVE_RESTORE_UPLOAD_TIMEOUT_MS + 2 * NATIVE_HISTORY_REQUEST_TIMEOUT_MS));
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

test('after a switch back to LeileiOS the archive is planned (not applied) and can never fail the switch', async () => {
  const { runLocalSwitch, afterSwitchArchive } = await import('../../../scripts/native-session-local.mjs');
  const calls = [], output = [];
  const relay = JSON.stringify({ NATIVE_LIVE_RELAY_AUTH_TOKEN: 'PRIVATE', MCP_SERVER_URL: 'https://fixture.example' });
  runLocalSwitch(['leileios', '00000000-0000-4000-8000-000000000001'], { desktopRunning: () => false, print: v => output.push(v), execute(command, args, options) {
    if (command === 'railway') return relay;
    calls.push(args);
    if (args[0].endsWith('native-transcript-archive.mjs')) {
      assert.equal(options.env.LEILEI_NATIVE_LIVE_RELAY_TOKEN, 'PRIVATE');
      return JSON.stringify({ mode: 'plan', results: [{ folder: '-fixture', keep: 22, archive: 40, keepMB: 103, archiveMB: 307, applied: null }] });
    }
    return '{"outcome":"restored"}';
  } });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].slice(1), [], 'plan-only: no --apply');
  assert.match(output.join(''), /归档预演 -fixture：可归档 40 个（307 MB），保留 22 个（103 MB）/);
  // Desktop direction never archives (Desktop is about to open).
  const desktopCalls = [];
  runLocalSwitch(['desktop', '00000000-0000-4000-8000-000000000001'], { print() {}, execute(command, args) { if (command !== 'railway') desktopCalls.push(args); return command === 'railway' ? relay : '{}'; } });
  assert.equal(desktopCalls.length, 1);
  // A failing archive only reports its sanitized reason.
  const failed = afterSwitchArchive({ autoApply: false, env: {}, execute() { throw Object.assign(new Error('PRIVATE_DETAIL'), { stderr: 'ARCHIVE_REFERENCES_UNAVAILABLE\n' }); } });
  assert.equal(failed, '归档预演跳过：ARCHIVE_REFERENCES_UNAVAILABLE\n');
  let applied;
  afterSwitchArchive({ autoApply: true, env: {}, execute(_c, args) { applied = args; return JSON.stringify({ mode: 'apply', results: [] }); } });
  assert.equal(applied.at(-1), '--apply', 'the owner-created flag enables applying');
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
