import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { query, InMemorySessionStore, deleteSession, getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { AgentSdkClaudeTransport } from '../src/agent-sdk-claude-transport.mjs';

const live = { skip: process.env.RUN_SDK_BRANCH_CORRECTNESS_LIVE !== '1', timeout: 360000 };
async function fixture({ maxQueries = Infinity } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'leilei-branch-correctness-'));
  const memory = new InMemorySessionStore(), states = new Map(), owned = new Set(), calls = [];
  const key = k => ({ ...k, projectKey: dir });
  let onAppend = null;
  // Production's workspace adapter also scopes independently of SDK project-key spelling.
  const store = {
    async append(k, entries) {
      owned.add(k.sessionId);
      await memory.append(key(k), entries);
      onAppend?.(k, entries);
    },
    load: k => memory.load(key(k)),
    delete: k => memory.delete(key(k)),
    listSessions: () => memory.listSessions(dir),
    getStatus: async id => states.get(id) ?? null,
    markIncomplete: async id => { states.set(id, 'incomplete'); },
    markComplete: async id => { states.set(id, 'complete'); },
  };
  const transport = new AgentSdkClaudeTransport({ cwd: dir, environment: process.env, sessionStore: store,
    queryImpl(input) {
      assert.ok(calls.length < maxQueries, 'Authorized live query budget exceeded');
      calls.push({ resume: input.options.resume, resumeSessionAt: input.options.resumeSessionAt, forkSession: input.options.forkSession });
      return query({ ...input, options: { ...input.options, cwd: dir, settingSources: [], tools: [],
        systemPrompt: 'You are a test assistant. Follow the prompt and reply briefly.', model: 'sonnet',
        effort: 'low', thinking: { type: 'disabled' }, maxTurns: 1, maxBudgetUsd: 10,
        sessionStoreFlush: 'eager', env: { ...process.env, DISABLE_AUTO_COMPACT: '1', CLAUDE_CODE_MAX_RETRIES: '0' } } });
    } });
  const run = async (prompt, parent = null, mode = 'resume', uuid = randomUUID()) => {
    const timer = setTimeout(() => transport.abort(), 90000);
    console.info('LIVE production query', { mode: parent ? mode : 'new' });
    try { return await transport.executeTurn(prompt, { mode: parent ? mode : 'new',
      parentProviderSessionId: parent?.providerSessionId ?? null,
      parentProviderCheckpointId: parent?.providerCheckpointId ?? null,
      requireProviderCheckpoint: true, userMessageUuid: uuid }); }
    finally { clearTimeout(timer); }
  };
  const entries = id => store.load({ projectKey: dir, sessionId: id });
  return { dir, store, transport, calls, run, entries, observe: callback => { onAppend = callback; },
    async cleanup() {
      transport.abort();
      for (const id of owned) {
        try { await deleteSession(id, { dir }); }
        catch (e) { if (!String(e.message).includes('not found in project directory')) throw e; }
        await deleteSession(id, { dir, sessionStore: store });
      }
      await rm(dir, { recursive: true, force: true });
    } };
}

test('live same canonical user UUID survives interrupted exact resume and redelivery', live, async () => {
  const f = await fixture();
  try {
    const parent = await f.run('Reply only PARENT_OK.');
    const u = randomUUID();
    let persisted = false;
    f.observe((_key, batch) => {
      if (!persisted && batch.some(e => e.type === 'user' && e.uuid === u)) {
        persisted = true;
        // Abort only AFTER the real SDK durably mirrors U. No canonical finalize occurs.
        setImmediate(() => f.transport.abort());
      }
    });
    await assert.rejects(f.run('Reply only REDELIVERY_OK.', parent, 'resume', u));
    assert.equal(persisted, true, 'U must actually enter the provider transcript before interruption');
    assert.equal(await f.store.getStatus(parent.providerSessionId), 'incomplete');
    f.observe(null);
    const result = await f.run('Reply only REDELIVERY_OK.', parent, 'resume', u);
    assert.equal(result.providerSessionId, parent.providerSessionId);
    assert.notEqual(result.providerCheckpointId, parent.providerCheckpointId);
    const terminal = result.events.findLast(e => e.type === 'result');
    assert.ok(terminal && !terminal.is_error);
    assert.equal(terminal.num_turns, 1, 'Redelivery must execute one user turn');
    assert.equal(terminal.user_message_uuid, u);
    assert.equal(terminal.result.trim(), 'REDELIVERY_OK');
    const rows = await f.entries(result.providerSessionId);
    const byId = new Map(rows.filter(e => e.uuid).map(e => [e.uuid, e]));
    const chain = [], seen = new Set();
    let cursor = result.providerCheckpointId;
    while (cursor) {
      assert.equal(seen.has(cursor), false, 'No replay cycle'); seen.add(cursor);
      const row = byId.get(cursor); assert.ok(row, 'Checkpoint chain must persist');
      chain.push(row); cursor = row.parentUuid;
    }
    assert.equal(chain.filter(e => e.type === 'user' && e.uuid === u).length, 1);
    assert.ok(JSON.stringify(chain).includes('REDELIVERY_OK'));
    assert.equal(await f.store.getStatus(result.providerSessionId), 'complete');
    assert.deepEqual(f.calls.slice(-2).map(c => [c.resume, c.resumeSessionAt]),
      Array(2).fill([parent.providerSessionId, parent.providerCheckpointId]));
    console.info('LIVE same-UUID redelivery PASS');
  } finally { await f.cleanup(); }
});

test('live same canonical user UUID delivery-unknown recovery returns one correctly parented turn', live, async () => {
  const f = await fixture();
  try {
    const parent = await f.run('Reply only DELIVERY_PARENT_OK.');
    const u = randomUUID();
    const prompt = 'Reply only DELIVERY_RETRY_OK.';
    const undelivered = await f.run(prompt, parent, 'resume', u);
    // Simulate result delivery unknown: provider succeeded, but no canonical finalize
    // happened. Canonical parent remains frozen at parent, not undelivered.
    const oldRows = await f.entries(parent.providerSessionId);
    assert.ok(oldRows.some(e => e.type === 'assistant' && JSON.stringify(e.message).includes('DELIVERY_RETRY_OK')),
      'A real completed but undelivered provider answer must exist');
    const result = await f.run(prompt, parent, 'resume', u);
    assert.equal(result.providerSessionId, parent.providerSessionId);
    // Reusing the correctly correlated completed result is valid idempotent recovery.
    // A new assistant UUID is not required: canonical lineage and one U are required.
    assert.notEqual(result.providerCheckpointId, parent.providerCheckpointId);
    assert.equal(undelivered.providerSessionId, parent.providerSessionId);
    const terminal = result.events.findLast(e => e.type === 'result');
    assert.ok(terminal && !terminal.is_error);
    assert.equal(terminal.num_turns, 1);
    assert.equal(terminal.user_message_uuid, u);
    assert.equal(terminal.result.trim(), 'DELIVERY_RETRY_OK');
    const rows = await f.entries(result.providerSessionId);
    const byId = new Map(rows.filter(e => e.uuid).map(e => [e.uuid, e]));
    let cursor = result.providerCheckpointId, userCount = 0, answerCount = 0;
    const seen = new Set();
    while (cursor) {
      assert.equal(seen.has(cursor), false); seen.add(cursor);
      const row = byId.get(cursor); assert.ok(row);
      if (row.type === 'user' && row.uuid === u) {
        userCount++;
        assert.equal(row.parentUuid, parent.providerCheckpointId, 'U must descend from the exact canonical parent');
      }
      if (row.type === 'assistant' && JSON.stringify(row.message).includes('DELIVERY_RETRY_OK')) answerCount++;
      cursor = row.parentUuid;
    }
    assert.equal(userCount, 1);
    assert.equal(answerCount, 1, 'Recovery must not duplicate the delivered assistant answer');
    assert.equal(await f.store.getStatus(result.providerSessionId), 'complete');
    assert.deepEqual(f.calls.slice(-2).map(c => [c.resume, c.resumeSessionAt]),
      Array(2).fill([parent.providerSessionId, parent.providerCheckpointId]));
    console.info('LIVE same-UUID delivery-unknown redelivery PASS');
  } finally { await f.cleanup(); }
});

test('live production query historical fork after compact is isolated and resumes B', live, async () => {
  const f = await fixture({ maxQueries: 5 });
  let step = 'turn1', a = null, b = null;
  const deadline = setTimeout(() => f.transport.abort(), 300000);
  try {
    const first = await f.run('Reply only FIRST_KEEP_MARKER.');
    a = first.providerSessionId;
    const firstRows = await f.entries(a);
    const cp1Index = firstRows.findIndex(e => e.uuid === first.providerCheckpointId);
    assert.ok(cp1Index >= 0);
    const historicalIds = firstRows.slice(0, cp1Index + 1)
      .filter(e => e.type === 'user' || e.type === 'assistant').map(e => e.uuid);
    step = 'turn2';
    const second = await f.run('Reply only PRE_COMPACT_FUTURE_MARKER.', first);
    assert.equal(second.providerSessionId, a);
    assert.notEqual(second.providerCheckpointId, first.providerCheckpointId);
    step = 'compact';
    const compact = await f.transport.compact(a, null, second.providerCheckpointId);
    assert.equal(compact.providerSessionId, a);
    assert.ok(compact.providerCheckpointId);
    assert.notEqual(compact.providerCheckpointId, second.providerCheckpointId);
    const compactRows = await f.entries(a);
    assert.ok(compactRows.some(e => e.type === 'system' && e.subtype === 'compact_boundary'));
    assert.ok(compactRows.some(e => e.uuid === compact.providerCheckpointId));
    assert.ok(compactRows.some(e => e.uuid === first.providerCheckpointId));
    const source = JSON.stringify(compactRows);
    const localSource = await getSessionMessages(a, { dir: f.dir, limit: 500 });
    const excludedIds = new Set(compactRows.filter(e =>
      !firstRows.some(old => old.uuid && old.uuid === e.uuid)).map(e => e.uuid).filter(Boolean));
    step = 'historical-fork';
    const fork = await f.run('Reply only FORK_OK.', first, 'fork');
    b = fork.providerSessionId;
    assert.notEqual(b, a);
    assert.deepEqual(f.calls.at(-1), { resume: a, resumeSessionAt: first.providerCheckpointId, forkSession: true });
    const forkRows = await f.entries(b);
    const forkCp1Index = forkRows.findIndex(e => e.uuid === first.providerCheckpointId);
    assert.ok(forkCp1Index >= 0);
    assert.deepEqual(forkRows.slice(0, forkCp1Index + 1)
      .filter(e => e.type === 'user' || e.type === 'assistant').map(e => e.uuid), historicalIds);
    assert.equal(forkRows.some(e => excludedIds.has(e.uuid)), false);
    assert.equal(JSON.stringify(forkRows).includes('PRE_COMPACT_FUTURE_MARKER'), false);
    assert.equal(forkRows.some(e => e.type === 'system' && e.subtype === 'compact_boundary'), false);
    assert.equal(JSON.stringify(await f.entries(a)), source);
    assert.deepEqual(await getSessionMessages(a, { dir: f.dir, limit: 500 }), localSource);
    step = 'resume-B';
    const resumed = await f.run('Reply only BRANCH_RESUME_OK.', fork);
    assert.equal(resumed.providerSessionId, b);
    assert.equal(await f.store.getStatus(b), 'complete');
    assert.equal(JSON.stringify(await f.entries(a)), source);
    assert.deepEqual(await getSessionMessages(a, { dir: f.dir, limit: 500 }), localSource);
    assert.equal(f.calls.length, 5);
    console.info('LIVE_GATE_RESULT', JSON.stringify({ outcome: 'PASS', queries: f.calls.length,
      sdk: '0.3.286', sessionA: a, sessionB: b, compactIdentity: true,
      historicalIsolation: true, sourceUnchanged: true, resumeBIdentity: true }));
  } catch (error) {
    console.error('LIVE_GATE_RESULT', JSON.stringify({ outcome: 'FAIL', step, queries: f.calls.length,
      sdk: '0.3.286', sessionA: a, sessionB: b, errorName: error.name,
      errorMessage: error.message, runtimeCode: error.runtimeCode ?? null }));
    throw error;
  } finally { clearTimeout(deadline); await f.cleanup(); }
});
