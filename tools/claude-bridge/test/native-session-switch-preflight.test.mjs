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
    expectedSessionId: A, expectedCheckpointId: CP,
    expectedRevision: createHash('sha256').update(text).digest('hex') };
  try { await run({ input, transcriptFile }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('switch preflight pins complete source and environment without granting execution or mutating data', async () => {
  const { preflightNativeSessionSwitch } = await import(moduleUrl);
  await fixture(async ({ input, transcriptFile }) => {
    const before = await readFile(transcriptFile);
    const result = await preflightNativeSessionSwitch(input);
    assert.equal(result.providerSessionId, A);
    assert.equal(result.providerCheckpointId, CP);
    assert.equal(result.workingDirectory, '/fixture');
    assert.equal(result.release.state, 'not_open_observed');
    assert.equal(result.executionAuthorized, false);
    assert.equal(result.readOnly, true);
    assert.equal(result.messageCount, 2);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PROMPT|PRIVATE_REPLY|PRIVATE_KEY/);
    assert.deepEqual(await readFile(transcriptFile), before);
  });
});

test('switch preflight refuses open idle sessions, stale selection and another config directory', async () => {
  const { preflightNativeSessionSwitch } = await import(moduleUrl);
  await fixture(async ({ input }) => {
    const started = 'Sat Oct 10 03:13:09 2026';
    await writeFile(path.join(input.peerDirectory, '123.json'), JSON.stringify({ sessionId: A, pid: 123, pidDomain: 'darwin', peerProtocol: 1, procStart: started, status: 'idle' }));
    await assert.rejects(preflightNativeSessionSwitch({ ...input, probeProcessStart: async () => started }), e => e.code === 'NATIVE_SESSION_STILL_OPEN');
    await assert.rejects(preflightNativeSessionSwitch({ ...input, expectedRevision: '0'.repeat(64) }), e => e.code === 'STALE_NATIVE_SELECTION');
    await assert.rejects(preflightNativeSessionSwitch({ ...input, configDirectory: path.dirname(input.configDirectory) }), e => e.code === 'NATIVE_CONFIG_LOCATION_MISMATCH');
  });
});

test('source changes during release checking are refused before any execution preparation', async () => {
  const { preflightNativeSessionSwitch } = await import(moduleUrl);
  await fixture(async ({ input, transcriptFile }) => {
    // A live unrelated peer is not ownership of A, but the scan still needs
    // identified records. Rewrite the source through the process probe.
    const started = 'Sat Oct 10 03:13:09 2026';
    await writeFile(path.join(input.peerDirectory, '123.json'), JSON.stringify({ sessionId: A, pid: 123, pidDomain: 'darwin', peerProtocol: 1, procStart: started, status: 'idle' }));
    await assert.rejects(preflightNativeSessionSwitch({ ...input, probeProcessStart: async () => {
      await writeFile(transcriptFile, '{}\n');
      return started;
    } }), e => e.code === 'NATIVE_INSPECTION_CHANGED');
  });
});

test('fixed preflight command prints only sanitized evidence and refuses actual switching', async () => {
  const { promisify } = await import('node:util');
  const execute = promisify((await import('node:child_process')).execFile);
  const script = new URL('../scripts/native-session-switch.mjs', import.meta.url).pathname;
  await fixture(async ({ input, transcriptFile }) => {
    const before = await readFile(transcriptFile);
    const args = ['--check', '--desktop-index', input.indexFile, '--project-dir', input.projectDirectory, '--config-dir', input.configDirectory];
    const { stdout } = await execute(process.execPath, [script, ...args]);
    const result = JSON.parse(stdout);
    assert.equal(result.providerSessionId, A);
    assert.equal(result.executionAuthorized, false);
    assert.doesNotMatch(stdout, /PRIVATE_|nativeSnapshot|entries|object_key/);
    await assert.rejects(execute(process.execPath, [script, '--execute', ...args.slice(1)]), error => {
      assert.equal(error.code, 1);
      assert.doesNotMatch(error.stderr, /PRIVATE_|PRIVATE_PROMPT/);
      return true;
    });
    assert.deepEqual(await readFile(transcriptFile), before);
  });
});
