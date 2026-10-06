import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { query, InMemorySessionStore, forkSession, deleteSession } from '@anthropic-ai/claude-agent-sdk';
test('live SDK resume/compact keeps identity and pre-compact historical UUID still forks exactly', { skip: process.env.RUN_SDK_BRANCH_CHECKPOINT_LIVE !== '1', timeout: 240000 }, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'leilei-provider-checkpoint-'));
    const store = new InMemorySessionStore(), owned = new Set(), keys = new Set();
    const append = store.append.bind(store);
    store.append = async (key, entries) => { keys.add(key.projectKey); return append(key, entries); };
    const run = async (prompt, options = {}) => {
        console.info("LIVE phase", prompt === '/compact' ? 'compact' : options.resume ? 'resume' : 'new');
        const events = [];
        const handle = query({ prompt, options: { cwd: dir, settingSources: [], tools: [], systemPrompt: 'You are a test assistant. Reply briefly.', model: 'sonnet', effort: 'low', thinking: { type: 'disabled' }, maxTurns: 1, maxBudgetUsd: 10, sessionStore: store, env: { ...process.env, DISABLE_AUTO_COMPACT: '1' }, ...options } });
        try {
            for await (const event of handle) {
                events.push(event);
                if (event.session_id)
                    owned.add(event.session_id);
            }
        }
        finally {
            handle.close();
        }
        const result = events.findLast(e => e.type === 'result');
        assert.ok(result);
        assert.equal(result.is_error, false, JSON.stringify(result.errors ?? result.subtype));
        const sessionId = result.session_id;
        const projectKey = [...keys].at(-1) ?? dir;
        const entries = await store.load({ projectKey, sessionId });
        if (!entries?.length)
            console.info('mirror diagnostic', events.map(e => ({ type: e.type, subtype: e.subtype })), { keys: [...keys], entryCount: entries?.length });
        const tail = entries?.findLast(e => !e.isSidechain && Object.hasOwn(e, 'parentUuid') && typeof e.uuid === 'string');
        assert.ok(tail);
        console.info("LIVE phase completed", { entryCount: entries.length, cost: result.total_cost_usd, sizes: entries.map(e => ({ type: e.type, bytes: JSON.stringify(e).length, sidechain: e.isSidechain })) });
        return { sessionId, cp: tail.uuid, events, entries };
    };
    try {
        const first = await run('Reply only FIRST_CHECKPOINT_OK.');
        const second = await run('Reply only LATER_TURN_MUST_NOT_LEAK.', { resume: first.sessionId, resumeSessionAt: first.cp });
        assert.equal(second.sessionId, first.sessionId);
        assert.notEqual(second.cp, first.cp);
        const compact = await run('/compact', { resume: first.sessionId, resumeSessionAt: second.cp });
        assert.equal(compact.sessionId, first.sessionId);
        assert.ok(compact.events.some(e => e.type === 'system' && e.subtype === 'compact_boundary'), 'Real /compact must emit a boundary');
        assert.ok(compact.entries.some(e => e.uuid === first.cp), 'Pre-compact UUID must still be persisted');
        const fork = await forkSession(first.sessionId, { dir, upToMessageId: first.cp, sessionStore: store });
        owned.add(fork.sessionId);
        const forkEntries = await store.load({ projectKey: [...keys].at(-1) ?? dir, sessionId: fork.sessionId });
        assert.notEqual(fork.sessionId, first.sessionId);
        assert.equal(JSON.stringify(forkEntries).includes('LATER_TURN_MUST_NOT_LEAK'), false);
        assert.ok(forkEntries.some(e => e.forkedFrom?.messageUuid === first.cp));
        const after = await run('Reply only AFTER_COMPACT_OK.', { resume: first.sessionId, resumeSessionAt: compact.cp });
        assert.equal(after.sessionId, first.sessionId);
        console.info('LIVE SDK PASS: same session across send/resume/compact/resume; exact pre-compact fork excludes later turn.');
    }
    finally {
        for (const id of owned) {
            try {
                await deleteSession(id, { dir });
            }
            catch (error) {
                if (!String(error.message).includes('not found in project directory'))
                    throw error;
            }
            await deleteSession(id, { dir, sessionStore: store });
        }
        await rm(dir, { recursive: true, force: true });
    }
});
