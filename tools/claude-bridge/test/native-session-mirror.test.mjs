import assert from 'node:assert/strict';
import test from 'node:test';
const moduleUrl = new URL('../src/native-session-mirror.mjs', import.meta.url);
const sessionId = '00000000-0000-4000-8000-000000000001';
const projectKey = '/synthetic/workspace';

test('native mirror never materializes a remote copy, but preserves append and subagent writes', async () => {
  const { createNativeSessionMirror, isNativeSessionMirror } = await import(moduleUrl);
  const appended = [];
  const store = {
    load() { assert.fail('native query must not load a remote replica'); },
    listSubkeys() { assert.fail('native query must not load subagent replicas'); },
    async append(key, entries) { appended.push({ key, entries }); },
  };
  const mirror = createNativeSessionMirror(store, { projectKey, sessionId });
  assert.equal(isNativeSessionMirror(mirror), true);
  assert.equal(isNativeSessionMirror({ ...mirror }), false);
  assert.equal(await mirror.load({ projectKey, sessionId }), null);
  assert.deepEqual(await mirror.listSubkeys({ projectKey, sessionId }), []);
  const entries = [{ type: 'assistant', uuid: 'synthetic' }];
  await mirror.append({ projectKey, sessionId }, entries);
  await mirror.append({ projectKey, sessionId, subpath: 'subagents/agent-demo' }, entries);
  assert.equal(appended.length, 2);
  assert.strictEqual(appended[0].entries, entries);
  assert.equal(appended[1].key.subpath, 'subagents/agent-demo');
});

test('native mirror refuses writes for another session or workspace and propagates durability failure', async () => {
  const { createNativeSessionMirror } = await import(moduleUrl);
  let calls = 0;
  const failure = new Error('durable append failed');
  const mirror = createNativeSessionMirror({ async append() { calls++; throw failure; } }, { projectKey, sessionId });
  for (const key of [{ projectKey: '/other', sessionId }, { projectKey, sessionId: 'other' }]) {
    await assert.rejects(mirror.append(key, []), /NATIVE_MIRROR_IDENTITY_MISMATCH/);
    await assert.rejects(mirror.load(key), /NATIVE_MIRROR_IDENTITY_MISMATCH/);
  }
  assert.equal(calls, 0);
  await assert.rejects(mirror.append({ projectKey, sessionId }, []), error => error === failure);
  assert.equal(calls, 1);
});
