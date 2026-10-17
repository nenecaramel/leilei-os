import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [A, U, CP, D] = [1, 2, 3, 4].map(n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);

test('a LeileiOS fork with no Desktop window is selected by its local transcript and handed off by opening a new window', async () => {
  const { resolveDesktopNativeSelection } = await import('../src/native-session-inspection.mjs');
  const { handoffNativeSessionToDesktop } = await import('../src/native-session-switch-restore.mjs');
  const root = await mkdtemp(path.join(tmpdir(), 'native-local-only-'));
  try {
    const configDirectory = path.join(root, 'config');
    const projectDirectory = path.join(configDirectory, 'projects', '-fixture');
    const peerDirectory = path.join(configDirectory, 'sessions');
    const desktopSessionsDirectory = path.join(root, 'desktop');
    await mkdir(projectDirectory, { recursive: true });
    await mkdir(peerDirectory);
    await mkdir(desktopSessionsDirectory);
    const entries = [
      { type: 'user', uuid: U, parentUuid: null, cwd: '/fixture/work', sessionId: A, entrypoint: 'sdk-ts', message: { content: 'PRIVATE_PROMPT' } },
      { type: 'assistant', uuid: CP, parentUuid: U, cwd: '/fixture/work', sessionId: A, entrypoint: 'sdk-ts', message: { content: 'PRIVATE_REPLY' } },
    ];
    const transcript = path.join(projectDirectory, `${A}.jsonl`);
    await writeFile(transcript, entries.map(JSON.stringify).join('\n'));
    const before = await readFile(transcript);
    const discovery = { desktopSessionsDirectory, projectsDirectory: path.join(configDirectory, 'projects'), peerDirectory };
    const resolved = await resolveDesktopNativeSelection({ ...discovery, sessionId: A });
    assert.equal(resolved.indexFile, null);
    assert.deepEqual([resolved.inspection.providerSessionId, resolved.inspection.providerCheckpointId, resolved.inspection.workingDirectory, resolved.inspection.desktopSessionId],
      [A, CP, '/fixture/work', null]);
    await assert.rejects(resolveDesktopNativeSelection({ ...discovery, sessionId: D }), e => e.code === 'NATIVE_SELECTION_NOT_FOUND');
    const input = { indexFile: null, projectDirectory, configDirectory, peerDirectory, recoveryDirectory: path.join(root, 'recovery'),
      expectedSessionId: A, expectedCheckpointId: CP, expectedRevision: resolved.inspection.nativeRevision };
    const routes = [], launches = [];
    const result = await handoffNativeSessionToDesktop({ input, conversationId: D, relayUrl: 'https://relay.invalid', relayToken: 'PRIVATE_TOKEN',
      recoveryDirectory: input.recoveryDirectory,
      launchImpl: async selection => { launches.push(selection); },
      fetchImpl: async (url, options) => {
        const route = url.split('/native-history/')[1];
        routes.push(route);
        const ok = data => new Response(JSON.stringify({ success: true, data }));
        if (route === 'state') return ok({ expectedHeadMessageId: CP, expectedRevision: 'b'.repeat(64), continuation: true });
        if (route === 'restore') return ok({ outcome: 'restored', conversationId: D, headMessageId: CP, inserted: 0 });
        if (route === 'release') {
          assert.equal(JSON.parse(options.body).sessionId, A);
          return ok({ owner: 'desktop', conversationId: D, providerSessionId: A, providerCheckpointId: CP, headMessageId: CP });
        }
        assert.fail(route);
      } });
    assert.deepEqual(routes, ['state', 'restore', 'release']);
    assert.equal(result.desktopLaunchRequested, true);
    assert.equal(launches.length, 1);
    assert.deepEqual([launches[0].providerSessionId, launches[0].workingDirectory, launches[0].configDirectory], [A, '/fixture/work', configDirectory]);
    assert.deepEqual(await readFile(transcript), before, 'handoff never writes the native transcript');
  } finally { await rm(root, { recursive: true, force: true }); }
});
