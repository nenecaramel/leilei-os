import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
const A = '00000000-0000-4000-8000-000000000001';
const U = '00000000-0000-4000-8000-000000000002';
const CP = '00000000-0000-4000-8000-000000000003';
const D = '00000000-0000-4000-8000-000000000004';
const moduleUrl = new URL('../src/native-session-switch-preflight.mjs', import.meta.url);
async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'native-switch-test-'));
  const configDirectory = path.join(root, 'config');
  const projectDirectory = path.join(configDirectory, 'projects', '-fixture');
  const peerDirectory = path.join(configDirectory, 'sessions');
  await mkdir(projectDirectory, { recursive: true });
  await mkdir(peerDirectory);
  const transcriptFile = path.join(projectDirectory, `${A}.jsonl`);
  const text = [
    { type: 'user', uuid: U, parentUuid: null, message: { content: 'PRIVATE_PROMPT' } },
    { type: 'assistant', uuid: CP, parentUuid: U, message: { content: 'PRIVATE_REPLY' } },
  ].map(JSON.stringify).join('\n');
  await writeFile(transcriptFile, text);
  const indexFile = path.join(root, 'index.json');
  await writeFile(indexFile, JSON.stringify({ sessionId: `local_${D}`, cliSessionId: A, lastAssistantUuid: CP, cwd: '/fixture', key: 'PRIVATE_KEY' }));
  const input = { configDirectory, projectDirectory, peerDirectory, indexFile,
    recoveryDirectory: path.join(root, 'recovery'),
    expectedSessionId: A, expectedCheckpointId: CP,
    expectedRevision: createHash('sha256').update(text).digest('hex') };
  try { await run({ input, transcriptFile }); }
  finally { await rm(root, { recursive: true, force: true }); }
}


test('handoff recovery ignores empty background quarantine but preserves all evidence fences', async () => {
  const { assertNativeHandoffRecoveryClear } = await import('../src/native-session-switch-restore.mjs');
  await fixture(async ({ input }) => {
    const blocked = path.join(input.recoveryDirectory, 'background-results', 'a'.repeat(64), 'blocked');
    await mkdir(blocked, { recursive: true });
    await assertNativeHandoffRecoveryClear(input.recoveryDirectory);
    await writeFile(path.join(blocked, 'pending.json'), '{}');
    await assert.rejects(assertNativeHandoffRecoveryClear(input.recoveryDirectory), e => e.code === 'NATIVE_SESSION_RECOVERY_REQUIRED');
    await rm(path.join(blocked, 'pending.json'));
    await writeFile(path.join(blocked, '.incomplete'), '{}');
    await assert.rejects(assertNativeHandoffRecoveryClear(input.recoveryDirectory), e => e.code === 'NATIVE_SESSION_RECOVERY_REQUIRED');
    await rm(blocked, { recursive: true });
    await writeFile(blocked, '{}');
    await assert.rejects(assertNativeHandoffRecoveryClear(input.recoveryDirectory), e => e.code === 'NATIVE_SESSION_RECOVERY_REQUIRED');
  });
});

test('complete restore resumes the daemon only after verified restore and refuses resume on rejection', async () => {
  const { restoreDesktopNativeSession } = await import('../src/native-session-switch-restore.mjs');
  const { createNativeSessionDrainServer } = await import('../src/native-session-daemon-drain.mjs');
  await fixture(async ({ input }) => {
    const events = [];
    const close = await createNativeSessionDrainServer({ recoveryDirectory: input.recoveryDirectory,
      drain: async () => ({ ready: true, writer: 'closed', tasks: [] }),
      resume: async (c, s) => { events.push(['resume', c, s]); } });
    try {
      let reject = false;
      const options = { input, conversationId: D, relayUrl: 'https://fixture.invalid', relayToken: 'fixture', retryDelaysMs: [],
        fetchImpl: async url => {
          const route = url.split('/').at(-1); events.push([route]);
          if (reject && route === 'restore') return Response.json({ success: false, error: { code: 'CANONICAL_HEAD_CHANGED' } }, { status: 409 });
          return Response.json({ success: true, data: route === 'state' ? { expectedHeadMessageId: null, expectedRevision: null }
            : { outcome: 'restored', conversationId: D, headMessageId: CP, inserted: 2 } });
        } };
      const result = await restoreDesktopNativeSession(options);
      assert.equal(result.daemonResumed, true);
      assert.deepEqual(events, [['state'], ['restore'], ['resume', D, A]]);
      events.length = 0; reject = true;
      await assert.rejects(restoreDesktopNativeSession(options), e => e.code === 'CANONICAL_HEAD_CHANGED');
      assert.deepEqual(events, [['state'], ['restore']]);
    } finally { await close(); }
  });
});

test('complete Desktop handoff repins only post-drain exit metadata and preserves the original bytes', async () => {
  const { handoffNativeSessionToDesktop } = await import('../src/native-session-switch-restore.mjs');
  const { createNativeSessionDrainServer } = await import('../src/native-session-daemon-drain.mjs');
  for (const mode of ['metadata', 'metadata-after-receipt', 'turn', 'rewrite', 'reformat', 'unknown', 'other-session', 'carrier']) {
    await fixture(async ({ input, transcriptFile }) => {
      const before = await readFile(transcriptFile, 'utf8');
      if (mode === 'metadata-after-receipt') {
        await writeFile(path.join(input.peerDirectory, '123.json'), JSON.stringify({ sessionId: A, pid: 123, pidDomain: 'darwin', peerProtocol: 1, procStart: 'fixture', status: 'idle' }));
        let flushed = false;
        input.probeProcessStart = async () => {
          if (flushed) return null;
          flushed = true;
          await writeFile(transcriptFile, before + '\n' + JSON.stringify({ type: 'last-prompt', sessionId: A, lastPrompt: 'PRIVATE_PROMPT' }));
          await rm(path.join(input.peerDirectory, '123.json'));
          releaseFlush();
          return null;
        };
      }
      let releaseFlush;
      const flush = new Promise(resolve => { releaseFlush = resolve; });
      const close = await createNativeSessionDrainServer({ recoveryDirectory: input.recoveryDirectory,
        drain: async () => {
          if (mode === 'metadata-after-receipt') return { ready: true, writer: 'closed', tasks: [] };
          const suffix = mode === 'turn' ? { type: 'user', uuid: D, parentUuid: CP, message: { content: 'new turn' } }
            : { type: mode === 'unknown' ? 'arbitrary-metadata' : 'cost-state', sessionId: mode === 'other-session' ? D : A, ...(mode === 'carrier' ? { uuid: D } : {}), totalCostUSD: 1 };
          await writeFile(transcriptFile, (mode === 'rewrite' ? before.replace('PRIVATE_REPLY', 'OTHER_REPLY') : mode === 'reformat' ? before.replaceAll(':', ': ') : before) + '\n' + JSON.stringify(suffix));
          releaseFlush();
          return { ready: true, writer: 'closed', tasks: [] };
        }, resume: async () => assert.fail('Desktop handoff must remain drained') });
      try {
        const routes = []; let launched = false;
        const run = handoffNativeSessionToDesktop({ input, recoveryDirectory: input.recoveryDirectory, conversationId: D, relayUrl: 'https://fixture.invalid', relayToken: 'fixture', retryDelaysMs: [],
          drainSettle: { pollMs: 5, quietMs: 10, timeoutMs: 1000 },
          launchImpl: async () => { launched = true; },
          fetchImpl: async (url, options) => {
            const route = url.split('/').at(-1); routes.push(route);
            const revision = createHash('sha256').update(await readFile(transcriptFile)).digest('hex');
            if (route === 'release') assert.equal(JSON.parse(options.body).expectedRevision, revision);
            return Response.json({ success: true, data: route === 'state' ? { expectedHeadMessageId: null, expectedRevision: null }
              : route === 'restore' ? { outcome: 'restored', conversationId: D, headMessageId: CP, inserted: 2 }
              : { owner: 'desktop', conversationId: D, providerSessionId: A, providerCheckpointId: CP, headMessageId: CP } });
          } });
        await flush;
        if (mode.startsWith('metadata')) {
          await run;
          assert.deepEqual(routes, ['state', 'restore', 'release']);
          assert.equal(launched, true);
          assert.equal((await readFile(transcriptFile, 'utf8')).startsWith(before), true);
        } else {
          await assert.rejects(run, e => e.code === 'NATIVE_INSPECTION_CHANGED');
          assert.deepEqual(routes, []);
          assert.equal(launched, false);
        }
      } finally { await close(); }
    });
  }
});
