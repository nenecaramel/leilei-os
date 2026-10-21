import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Desktop /compact in the same session: the physical parent chain stops at the
// compact boundary, but the checkpoint LeileiOS released is its logical ancestor.
const S = '00000000-0000-4000-8000-000000000001', D = '00000000-0000-4000-8000-000000000002';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U1 = id(11), RELEASED = id(12), U2 = id(13), PRE = id(14), BOUNDARY = id(20), SUMMARY = id(21), U3 = id(22), TAIL = id(23), CONVERSATION = id(30);

async function fixture(run, { logicalParent = PRE } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'native-compact-continuation-'));
  const configDirectory = path.join(root, 'config');
  const projectDirectory = path.join(configDirectory, 'projects', '-fixture');
  const peerDirectory = path.join(configDirectory, 'sessions');
  await mkdir(projectDirectory, { recursive: true }); await mkdir(peerDirectory);
  const entries = [
    { type: 'user', uuid: U1, parentUuid: null, message: { content: 'first' } },
    { type: 'assistant', uuid: RELEASED, parentUuid: U1, message: { content: 'released by LeileiOS' } },
    { type: 'user', uuid: U2, parentUuid: RELEASED, message: { content: 'Desktop turn' } },
    { type: 'assistant', uuid: PRE, parentUuid: U2, message: { content: 'Desktop reply' } },
    { type: 'system', subtype: 'compact_boundary', uuid: BOUNDARY, parentUuid: null, logicalParentUuid: logicalParent, compactMetadata: { trigger: 'manual', preTokens: 100 } },
    { type: 'user', uuid: SUMMARY, parentUuid: BOUNDARY, isCompactSummary: true, message: { content: 'summary' } },
    { type: 'user', uuid: U3, parentUuid: SUMMARY, message: { content: 'after compact' } },
    { type: 'assistant', uuid: TAIL, parentUuid: U3, message: { content: 'after compact reply' } },
  ];
  const text = entries.map(e => JSON.stringify(e)).join('\n');
  await writeFile(path.join(projectDirectory, `${S}.jsonl`), text);
  const indexFile = path.join(root, 'index.json');
  await writeFile(indexFile, JSON.stringify({ sessionId: `local_${D}`, cliSessionId: S, lastAssistantUuid: TAIL, cwd: '/fixture' }));
  const input = { configDirectory, projectDirectory, peerDirectory, indexFile, recoveryDirectory: path.join(root, 'recovery'),
    expectedSessionId: S, expectedCheckpointId: TAIL, expectedRevision: createHash('sha256').update(text).digest('hex'), historyMode: 'continuation' };
  try { await run(input); } finally { await rm(root, { recursive: true, force: true }); }
}

test('continuation evidence carries the logical pre-compact ancestry of the same file', async () => {
  const { readNativeContinuationEvidence } = await import('../src/native-session-inspection.mjs');
  await fixture(async input => {
    const evidence = await readNativeContinuationEvidence(input);
    assert.equal(evidence.checkpointId, TAIL);
    assert.equal(evidence.completedTurnCheckpointIds[0], TAIL, 'execution still resumes the post-compact tail');
    for (const ancestor of [RELEASED, PRE, U1, BOUNDARY, U3]) assert.ok(evidence.checkpointIds.includes(ancestor), ancestor);
  });
});

test('a logical parent that is not in this file adds nothing (archive files are never read)', async () => {
  const { readNativeContinuationEvidence } = await import('../src/native-session-inspection.mjs');
  await fixture(async input => {
    const evidence = await readNativeContinuationEvidence(input);
    assert.ok(!evidence.checkpointIds.includes(RELEASED));
    assert.ok(evidence.checkpointIds.includes(BOUNDARY));
  }, { logicalParent: id(99) });
});

test('switching back to LeileiOS after a Desktop compact attaches the post-compact tail', async () => {
  const { attachDesktopNativeContinuation } = await import('../src/native-session-continuation.mjs');
  await fixture(async input => {
    const calls = [];
    const result = await attachDesktopNativeContinuation({ input, conversationId: CONVERSATION, relayUrl: 'https://fixture.example', relayToken: 'PRIVATE', retryDelaysMs: [],
      fetchImpl: async (url, request) => {
        const route = new URL(url).pathname.split('/').at(-1), body = JSON.parse(request.body); calls.push({ route, body });
        const data = route === 'continuation-state' ? { expectedHeadMessageId: null, expectedRevision: 'a'.repeat(64),
          providerSessionId: S, providerCheckpointId: RELEASED, effectiveWorkingDirectory: '/fixture', owner: 'desktop' }
          : { outcome: 'attached', owner: 'leileios', conversationId: CONVERSATION, headMessageId: null, providerSessionId: S, providerCheckpointId: TAIL, inserted: 0 };
        return new Response(JSON.stringify({ success: true, data }));
      } });
    assert.equal(result.owner, 'leileios');
    const attach = calls.find(c => c.route === 'continuation-attach').body;
    assert.equal(attach.checkpointId, TAIL);
    assert.ok(attach.checkpointIds.includes(RELEASED), 'server can verify the released checkpoint is an ancestor');
  });
});
