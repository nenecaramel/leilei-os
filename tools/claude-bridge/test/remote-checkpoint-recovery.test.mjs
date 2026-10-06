import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { AgentSdkClaudeTransport } from '../src/agent-sdk-claude-transport.mjs';

function fixture({ state = 'incomplete', firstFailure = false, brokenPrefix = false, mirrorFailure = false, losePrefix = false, noAppend = false, mode = 'resume' } = {}) {
  const a = randomUUID(), b = randomUUID(), user = randomUUID(), cp = randomUUID(), failed = randomUUID(), next = randomUUID();
  const prefix = [{ type: 'user', uuid: user, parentUuid: null, sessionId: a }, { type: 'assistant', uuid: cp, parentUuid: brokenPrefix ? randomUUID() : user, sessionId: a }];
  const map = new Map([[a, [...prefix, { type: 'user', uuid: failed, parentUuid: cp, sessionId: a, message: { role: 'user', content: 'FAILED_TAIL' } }]]]);
  let calls = 0, marks = 0, imports = 0;
  const statuses = new Map([[a, state]]);
  const store = { load: async key => structuredClone(map.get(key.sessionId) ?? null), getStatus: async id => statuses.get(id) ?? null,
    markIncomplete: async id => { statuses.set(id, 'incomplete'); }, markComplete: async id => { marks++; statuses.set(id, 'complete'); }, append: async (key, rows) => map.set(key.sessionId, [...(map.get(key.sessionId) ?? []), ...rows]) };
  const transport = new AgentSdkClaudeTransport({ environment: {}, cwd: '/private/tmp/leilei-930-fixture', sessionStore: store,
    sessionMessagesImpl: async () => [], importSessionToStoreImpl: async () => { imports++; throw new Error('local transcript absent'); },
    queryImpl: ({ options }) => {
      calls++;
      assert.equal(options.resume, a);
      assert.equal(options.resumeSessionAt, cp);
      assert.equal(Boolean(options.forkSession), mode === 'fork');
      const id = mode === 'fork' ? b : a;
      return { close() {}, async *[Symbol.asyncIterator]() {
        assert.equal(statuses.get(a), 'incomplete');
        yield { type: 'system', subtype: 'init', session_id: id };
        if (firstFailure && calls === 1) throw new Error('provider/auth process failure');
        assert.deepEqual(await options.sessionStore.load({ projectKey: '/fixture', sessionId: a }), prefix, 'only the proven canonical prefix is materialized');
        if (mode === 'fork') map.set(b, prefix.map(row => ({ ...row, sessionId: b })));
        if (losePrefix) map.set(id, []);
        if (!noAppend) await options.sessionStore.append({ projectKey: '/fixture', sessionId: id }, [{ type: 'assistant', uuid: next, parentUuid: cp, sessionId: id }]);
        if (mirrorFailure) yield { type: 'system', subtype: 'mirror_error', session_id: id, error: 'mirror lost' };
        yield { type: 'result', subtype: 'success', session_id: id, result: 'ok' };
      } };
    } });
  return { a, b, cp, next, store, map, transport, get state() { return statuses.get(a); }, get calls() { return calls; }, get marks() { return marks; }, get imports() { return imports; },
    run: checkpoint => transport.executeTurn('minimal', { mode, parentProviderSessionId: a, parentProviderCheckpointId: checkpoint ?? cp, requireProviderCheckpoint: true }) };
}

test('remote-only failed resume preserves canonical checkpoint usability on the next exact send', async () => {
  const f = fixture({ state: 'complete', firstFailure: true });
  await assert.rejects(f.run(), /provider\/auth/u);
  assert.equal(f.state, 'incomplete');
  const source = structuredClone(f.map.get(f.a));
  const result = await f.run();
  assert.equal(result.providerSessionId, f.a);
  assert.equal(result.providerCheckpointId, f.next);
  assert.equal(f.calls, 2, 'exactly one provider invocation per requested attempt');
  assert.equal(f.marks, 0, 'unproven whole tail is never relabeled complete');
  assert.equal(f.state, 'incomplete');
  assert.deepEqual(f.map.get(f.a).slice(0, source.length), source, 'failed tail evidence survives');
  assert.equal(f.imports, 0);
});

test('already-poisoned remote-only exact send recovers without local import or whole-session completion', async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.providerSessionId, f.a);
  assert.equal(result.providerCheckpointId, f.next);
  assert.equal(f.calls, 1);
  assert.equal(f.marks, 0);
  assert.equal(f.state, 'incomplete');
});

test('poisoned parent Retry/Edit exact fork isolates its prefix and preserves source evidence', async () => {
  const f = fixture({ mode: 'fork' });
  const before = structuredClone(f.map.get(f.a));
  const result = await f.run();
  assert.equal(result.providerSessionId, f.b);
  assert.equal(result.providerCheckpointId, f.next);
  assert.deepEqual(f.map.get(f.a), before);
  assert.equal(f.calls, 1);
  assert.equal(f.state, 'incomplete', 'source remains incomplete after clean-prefix fork');
});

for (const [name, options] of [['missing prefix ancestor', { brokenPrefix: true }], ['mirror failure', { mirrorFailure: true }], ['prefix loss during query', { losePrefix: true }], ['no newly mirrored checkpoint', { noAppend: true }]]) {
  test(`checkpoint-scoped recovery rejects ${name} without completing the session`, async () => {
    const f = fixture(options);
    await assert.rejects(f.run(), error => ['NO_PROVIDER_SESSION', 'RUNTIME_UNAVAILABLE'].includes(error.runtimeCode));
    assert.equal(f.marks, 0);
    assert.equal(f.state, 'incomplete');
    assert.equal(f.calls, options.brokenPrefix ? 0 : 1);
  });
}

test('missing canonical checkpoint stays fail-closed before query', async () => {
  const f = fixture();
  await assert.rejects(f.run(randomUUID()), error => error.runtimeCode === 'NO_PROVIDER_SESSION');
  assert.equal(f.calls, 0);
  assert.equal(f.marks, 0);
});

test('a later send from the recovered checkpoint does not materialize older off-path failed messages', async () => {
  const f = fixture();
  await f.run();
  const second = randomUUID();
  const durable = structuredClone(f.map.get(f.a));
  let calls = 0;
  f.transport.queryImpl = ({ options }) => {
    calls++;
    assert.equal(options.resume, f.a);
    assert.equal(options.resumeSessionAt, f.next);
    return { close() {}, async *[Symbol.asyncIterator]() {
      assert.deepEqual(await options.sessionStore.load({ projectKey: '/fixture', sessionId: f.a }), durable.filter(row => row.message?.content !== 'FAILED_TAIL'));
      await options.sessionStore.append({ projectKey: '/fixture', sessionId: f.a }, [{ type: 'assistant', uuid: second, parentUuid: f.next, sessionId: f.a }]);
      yield { type: 'result', subtype: 'success', session_id: f.a, result: 'ok' };
    } };
  };
  const result = await f.run(f.next);
  assert.equal(result.providerCheckpointId, second);
  assert.equal(result.providerSessionId, f.a);
  assert.equal(calls, 1);
  assert.equal(f.state, 'incomplete');
  assert.equal(f.marks, 0);
  assert.deepEqual(f.map.get(f.a).slice(0, durable.length), durable);
});
