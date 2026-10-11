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
  assert.throws(() => runLocalSwitch(['leileios', '00000000-0000-4000-8000-000000000001'], { execute() { throw new Error('PRIVATE_TOKEN'); } }), error => error.message === 'RELAY_CREDENTIALS_UNAVAILABLE');
});
