import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runNativeTranscriptArchive } from '../scripts/native-transcript-archive.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const old = new Date('2026-10-01T00:00:00Z');

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'native-archive-cmd-'));
  const configDirectory = path.join(root, 'config'), project = path.join(configDirectory, 'projects', '-fixture');
  const desktopSessionsDirectory = path.join(root, 'desktop'), archiveDirectory = path.join(root, 'archive');
  await mkdir(project, { recursive: true }); await mkdir(path.join(configDirectory, 'sessions'));
  await mkdir(path.join(desktopSessionsDirectory, 'acct', 'org'), { recursive: true });
  const entries = [{ type: 'user', uuid: id(101), parentUuid: null, message: { content: 'a' } }, { type: 'assistant', uuid: id(102), parentUuid: id(101), message: { content: 'b' } }];
  for (const s of [id(1), id(2), id(3)]) {
    await writeFile(path.join(project, `${s}.jsonl`), entries.map(e => JSON.stringify({ ...e, sessionId: s })).join('\n'));
    await utimes(path.join(project, `${s}.jsonl`), old, old);
  }
  await writeFile(path.join(desktopSessionsDirectory, 'acct', 'org', `local_${id(9)}.json`), JSON.stringify({ sessionId: `local_${id(9)}`, cliSessionId: id(1), lastAssistantUuid: id(102), cwd: '/fixture' }));
  return { root, configDirectory, project, desktopSessionsDirectory, archiveDirectory };
}

test('archive command needs LeileiOS references, plans by default and applies only when asked', async () => {
  const f = await fixture();
  const ok = sessionIds => async () => new Response(JSON.stringify({ success: true, data: { sessionIds } }));
  try {
    await assert.rejects(runNativeTranscriptArchive({ ...f, relayUrl: 'https://relay.invalid', relayToken: 'T', fetchImpl: async () => new Response('{}', { status: 503 }) }),
      e => e.code === 'ARCHIVE_REFERENCES_UNAVAILABLE');
    const plan = await runNativeTranscriptArchive({ ...f, relayUrl: 'https://relay.invalid', relayToken: 'T', fetchImpl: ok([id(2)]) });
    assert.deepEqual(plan.results.map(r => [r.folder, r.keep, r.archive, r.applied]), [['-fixture', 2, 1, null]]);
    assert.equal((await readdir(f.project)).length, 3, 'planning never removes anything');
    const applied = await runNativeTranscriptArchive({ ...f, apply: true, relayUrl: 'https://relay.invalid', relayToken: 'T', fetchImpl: ok([id(2)]) });
    assert.match(applied.results[0].applied, /^-fixture-.*\.tar\.(zst|xz)$/);
    assert.deepEqual((await readdir(f.project)).sort(), [`${id(1)}.jsonl`, `${id(2)}.jsonl`]);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
