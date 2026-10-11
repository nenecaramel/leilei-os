import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile, chmod, realpath } from 'node:fs/promises';
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

test('fixed command lists and selects a native ID without manual index or JSONL paths', async () => {
  const { promisify } = await import('node:util');
  const execute = promisify((await import('node:child_process')).execFile);
  const script = new URL('../scripts/native-session-switch.mjs', import.meta.url).pathname;
  await fixture(async ({ input, transcriptFile }) => {
    const desktopDirectory = path.join(path.dirname(input.configDirectory), 'desktop');
    const org = path.join(desktopDirectory, 'account', 'org');
    await mkdir(org, { recursive: true });
    await copyFile(input.indexFile, path.join(org, `local_${D}.json`));
    const locations = ['--desktop-dir', desktopDirectory, '--config-dir', input.configDirectory];
    const before = await readFile(transcriptFile);
    const { stdout: catalog } = await execute(process.execPath, [script, '--list', ...locations]);
    assert.equal(JSON.parse(catalog).sessions[0].providerSessionId, A);
    assert.doesNotMatch(catalog, /PRIVATE_|indexFile|projectDirectory|nativeSnapshot/);
    const { stdout } = await execute(process.execPath, [script, '--check', '--session-id', A, ...locations]);
    assert.equal(JSON.parse(stdout).providerCheckpointId, CP);
    assert.equal(JSON.parse(stdout).release.state, 'not_open_observed');
    await assert.rejects(execute(process.execPath, [script, '--check', '--session-id', A,
      '--desktop-index', input.indexFile, '--project-dir', input.projectDirectory, ...locations]));
    await assert.rejects(execute(process.execPath, [script, '--check', '--session-id', U, ...locations]),
      error => error.stderr.trim() === 'NATIVE_SELECTION_NOT_FOUND');
    assert.deepEqual(await readFile(transcriptFile), before);
  });
});

test('restore entry submits complete original records through state CAS without invoking Claude or changing source', async () => {
  const { restoreDesktopNativeSession } = await import('../src/native-session-switch-restore.mjs');
  await fixture(async ({ input, transcriptFile }) => {
    const before = await readFile(transcriptFile);
    const calls = [];
    const result = await restoreDesktopNativeSession({ input, conversationId: D, relayUrl: 'https://relay.invalid', relayToken: 'PRIVATE_TOKEN',
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers.Authorization, 'Bearer PRIVATE_TOKEN');
        const body = JSON.parse(options.body);
        if (url.endsWith('/state')) {
          assert.deepEqual(body, { conversationId: D, sessionId: A });
          return new Response(JSON.stringify({ success: true, data: { expectedHeadMessageId: null, expectedRevision: null } }));
        }
        assert.equal(body.nativeSnapshot.entries.length, 2);
        assert.equal(body.nativeSnapshot.entries[0].message.content, 'PRIVATE_PROMPT');
        assert.equal(body.projection.sessionId, A);
        assert.equal(body.effectiveWorkingDirectory, '/fixture');
        assert.equal(body.expectedHeadMessageId, null);
        assert.equal('userId' in body, false);
        return new Response(JSON.stringify({ success: true, data: { outcome: 'restored', conversationId: D, headMessageId: CP, inserted: 2 } }));
      } });
    assert.equal(calls.length, 2);
    assert.equal(result.executionAuthorized, false);
    assert.equal(result.providerSessionId, A);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|entries|nativeSnapshot/);
    assert.deepEqual(await readFile(transcriptFile), before);
  });
});
test('restore entry refuses insecure endpoint, open owner and backend conflicts with no automatic retries', async () => {
  const { restoreDesktopNativeSession } = await import('../src/native-session-switch-restore.mjs');
  await fixture(async ({ input }) => {
    let calls = 0;
    const options = { input, conversationId: D, relayUrl: 'http://relay.invalid', relayToken: 'PRIVATE_TOKEN', fetchImpl: async () => { calls++; throw new Error('PRIVATE_DETAIL'); } };
    await assert.rejects(restoreDesktopNativeSession(options), e => e.code === 'INVALID_NATIVE_RESTORE_ENDPOINT');
    assert.equal(calls, 0);
    await assert.rejects(restoreDesktopNativeSession({ ...options, relayUrl: 'https://relay.invalid', fetchImpl: async () => {
      calls++; return new Response(JSON.stringify({ success: false, error: { code: 'NATIVE_CONVERSATION_BUSY', message: 'PRIVATE_DETAIL' } }), { status: 409 });
    } }), e => e.code === 'NATIVE_CONVERSATION_BUSY' && !e.message.includes('PRIVATE'));
    assert.equal(calls, 1);
    const started = 'Sat Oct 10 03:13:09 2026';
    await writeFile(path.join(input.peerDirectory, '123.json'), JSON.stringify({ sessionId: A, pid: 123, pidDomain: 'darwin', peerProtocol: 1, procStart: started, status: 'idle' }));
    await assert.rejects(restoreDesktopNativeSession({ ...options, relayUrl: 'https://relay.invalid', input: { ...input, probeProcessStart: async () => started } }), e => e.code === 'NATIVE_SESSION_STILL_OPEN');
    assert.equal(calls, 1);
  });
});

test('Desktop handoff syncs then releases before launch; pending recovery or release conflict never launches', async () => {
  const { handoffNativeSessionToDesktop } = await import('../src/native-session-switch-restore.mjs');
  assert.equal(typeof handoffNativeSessionToDesktop, 'function');
  await fixture(async ({ input, transcriptFile }) => {
    const recoveryDirectory = path.join(path.dirname(input.configDirectory), 'recovery');
    const before = await readFile(transcriptFile);
    const calls = [];
    const options = { input, conversationId: D, recoveryDirectory, relayUrl: 'https://relay.invalid', relayToken: 'PRIVATE_TOKEN',
      fetchImpl: async (url, request) => {
        const route = url.split('/').at(-1); calls.push(route);
        const body = JSON.parse(request.body);
        if (route === 'state') return new Response(JSON.stringify({ success: true, data: { expectedHeadMessageId: null, expectedRevision: null } }));
        if (route === 'restore') return new Response(JSON.stringify({ success: true, data: { outcome: 'restored', conversationId: D, headMessageId: CP, inserted: 2 } }));
        assert.deepEqual(body, { conversationId: D, sessionId: A, expectedHeadMessageId: CP, expectedRevision: input.expectedRevision, expectedCheckpointId: CP });
        return new Response(JSON.stringify({ success: true, data: { owner: 'desktop', conversationId: D,
          providerSessionId: A, providerCheckpointId: CP, headMessageId: CP } }));
      },
      launchImpl: async selection => { calls.push('launch'); assert.equal(selection.providerSessionId, A); assert.equal(selection.workingDirectory, '/fixture'); },
    };
    const result = await handoffNativeSessionToDesktop(options);
    assert.deepEqual(calls, ['state', 'restore', 'release', 'launch']);
    assert.equal(result.desktopLaunchRequested, true);
    assert.equal(result.desktopSessionVerified, false, 'launcher success is not proof of Desktop identity');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
    const scope = path.join(recoveryDirectory, 'terminal-results', 'a'.repeat(64));
    await mkdir(scope, { recursive: true });
    await writeFile(path.join(scope, 'b'.repeat(64) + '.json'), 'PRIVATE_RESULT');
    calls.length = 0;
    await assert.rejects(handoffNativeSessionToDesktop(options), e => e.code === 'NATIVE_SESSION_RECOVERY_REQUIRED');
    assert.deepEqual(calls, []);
    await rm(scope, { recursive: true });
    const appendScope = path.join(recoveryDirectory, 'session-store-append-receipts', 'c'.repeat(64));
    await mkdir(appendScope, { recursive: true });
    await writeFile(path.join(appendScope, 'intent.json'), 'PRIVATE_APPEND');
    await assert.rejects(handoffNativeSessionToDesktop(options), e => e.code === 'NATIVE_SESSION_RECOVERY_REQUIRED');
    assert.deepEqual(calls, []);
    await rm(appendScope, { recursive: true });
    await assert.rejects(handoffNativeSessionToDesktop({ ...options, fetchImpl: async (url, request) => url.endsWith('/release')
      ? new Response(JSON.stringify({ success: false, error: { code: 'NATIVE_CONVERSATION_BUSY' } }), { status: 409 }) : options.fetchImpl(url, request) }),
      e => e.code === 'NATIVE_CONVERSATION_BUSY');
    assert.equal(calls.includes('launch'), false);
    assert.deepEqual(await readFile(transcriptFile), before);
  });
});

test('source mutation while release response is in flight prevents Desktop launch', async () => {
  const { handoffNativeSessionToDesktop } = await import('../src/native-session-switch-restore.mjs');
  await fixture(async ({ input, transcriptFile }) => {
    let launches = 0;
    await assert.rejects(handoffNativeSessionToDesktop({ input, conversationId: D, recoveryDirectory: input.recoveryDirectory,
      relayUrl: 'https://relay.invalid', relayToken: 'PRIVATE_TOKEN',
      fetchImpl: async url => {
        const route = url.split('/').at(-1);
        if (route === 'state') return Response.json({ success: true, data: { expectedHeadMessageId: null, expectedRevision: null } });
        if (route === 'restore') return Response.json({ success: true, data: { outcome: 'restored', conversationId: D, headMessageId: CP, inserted: 2 } });
        await writeFile(transcriptFile, (await readFile(transcriptFile, 'utf8')) + '\n' + JSON.stringify({ type: 'user', uuid: D, parentUuid: CP, message: { content: 'LATER_PRIVATE_PROMPT' } }));
        return Response.json({ success: true, data: { owner: 'desktop', conversationId: D, providerSessionId: A, providerCheckpointId: CP, headMessageId: CP } });
      }, launchImpl: async () => { launches++; },
    }), e => e.code === 'STALE_NATIVE_SELECTION');
    assert.equal(launches, 0);
  });
});

test('Desktop launcher uses exact original identity/cwd and does not pass relay credentials or expose launcher output', async () => {
  const { launchDesktopNativeSession } = await import('../src/native-session-switch-restore.mjs');
  let calls = 0;
  await launchDesktopNativeSession({ providerSessionId: A, workingDirectory: '/fixture', configDirectory: '/fixture/config' },
    async (file, args, options) => {
      calls++; assert.equal(file, 'claude'); assert.deepEqual(args, ['--desktop', '--resume', A]);
      assert.equal(options.cwd, '/fixture'); assert.equal(options.env.CLAUDE_CONFIG_DIR, '/fixture/config');
      assert.equal(options.env.LEILEI_NATIVE_LIVE_RELAY_TOKEN, undefined);
      assert.equal(options.env.LEILEI_NATIVE_LIVE_RELAY_URL, undefined);
      assert.equal(options.env.PATH, '/synthetic/bin');
      return { stdout: 'PRIVATE_CONTENT' };
    }, { PATH: '/synthetic/bin', LEILEI_NATIVE_LIVE_RELAY_TOKEN: 'PRIVATE_TOKEN', LEILEI_NATIVE_LIVE_RELAY_URL: 'https://relay.invalid' }, '/fixture/home');
  assert.equal(calls, 1);
  // The default config location is not named: the CLI would look up another sign-in.
  await launchDesktopNativeSession({ providerSessionId: A, workingDirectory: '/fixture', configDirectory: '/fixture/home/.claude' },
    async (_file, _args, options) => { calls++; assert.equal('CLAUDE_CONFIG_DIR' in options.env, false); },
    { PATH: '/synthetic/bin', CLAUDE_CONFIG_DIR: '/fixture/home/.claude' }, '/fixture/home');
  assert.equal(calls, 2);
  await assert.rejects(launchDesktopNativeSession({ providerSessionId: A, workingDirectory: '/fixture' },
    async () => { throw new Error('PRIVATE_CONTENT'); }), e => e.code === 'NATIVE_DESKTOP_LAUNCH_FAILED' && !e.message.includes('PRIVATE'));
});

test('fixed restore command writes only to explicitly configured mock relay and prints sanitized completion', async () => {
  const { createServer } = await import('node:http');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  await fixture(async ({ input, transcriptFile }) => {
    let requests = 0;
    const server = createServer(async (request, response) => {
      assert.equal(request.headers.authorization, 'Bearer PRIVATE_TOKEN');
      requests++;
      let text = ''; for await (const chunk of request) text += chunk;
      const body = JSON.parse(text);
      response.setHeader('Content-Type', 'application/json');
      if (request.url.endsWith('/state')) response.end(JSON.stringify({ success: true, data: { expectedHeadMessageId: null, expectedRevision: null } }));
      else {
        assert.equal(body.nativeSnapshot.entries[0].message.content, 'PRIVATE_PROMPT');
        response.end(JSON.stringify({ success: true, data: { outcome: 'restored', conversationId: D, headMessageId: CP, inserted: 2 } }));
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const before = await readFile(transcriptFile);
      const script = new URL('../scripts/native-session-switch.mjs', import.meta.url).pathname;
      const { stdout, stderr } = await promisify(execFile)(process.execPath, [script, '--restore', '--desktop-index', input.indexFile,
        '--project-dir', input.projectDirectory, '--config-dir', input.configDirectory, '--conversation-id', D], {
        env: { ...process.env, LEILEI_NATIVE_LIVE_RELAY_URL: `http://127.0.0.1:${server.address().port}`, LEILEI_NATIVE_LIVE_RELAY_TOKEN: 'PRIVATE_TOKEN' },
      });
      assert.equal(stderr, ''); assert.equal(requests, 2);
      assert.equal(JSON.parse(stdout).outcome, 'restored');
      assert.equal(JSON.parse(stdout).executionAuthorized, false);
      assert.doesNotMatch(stdout, /PRIVATE_|entries|nativeSnapshot/);
      assert.deepEqual(await readFile(transcriptFile), before);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
});

for (const manual of [false, true]) test(`fixed ID ${manual ? 'manual' : 'automatic'} handoff then sync preserves the same conversation`, async () => {
  const { createServer } = await import('node:http');
  const { promisify } = await import('node:util');
  const execute = promisify((await import('node:child_process')).execFile);
  await fixture(async ({ input, transcriptFile }) => {
    const root = path.dirname(input.configDirectory);
    const desktopDirectory = path.join(root, 'desktop');
    const org = path.join(desktopDirectory, 'account', 'org');
    const bin = path.join(root, 'bin');
    const marker = path.join(root, 'launch.json');
    await mkdir(org, { recursive: true }); await mkdir(bin);
    await copyFile(input.indexFile, path.join(org, `local_${D}.json`));
    const launcher = path.join(bin, 'claude');
    await writeFile(launcher, `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.SYNTHETIC_LAUNCH_RESULT, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),relayTokenPresent:!!process.env.LEILEI_NATIVE_LIVE_RELAY_TOKEN}));\n`);
    await chmod(launcher, 0o700);
    // Use a real existing synthetic cwd; do not change any owner directory.
    const index = path.join(org, `local_${D}.json`);
    const metadata = JSON.parse(await readFile(index, 'utf8')); metadata.cwd = root;
    await writeFile(index, JSON.stringify(metadata));
    const sequence = [];
    const nextUser = '00000000-0000-4000-8000-000000000005';
    const nextCp = '00000000-0000-4000-8000-000000000006';
    const server = createServer(async (request, response) => {
      let text = ''; for await (const chunk of request) text += chunk;
      const body = JSON.parse(text), route = request.url.split('/').at(-1);
      sequence.push(route); assert.equal(body.conversationId, A);
      let data;
      if (route === 'state') data = { expectedHeadMessageId: null, expectedRevision: null };
      else if (route === 'restore') {
        assert.equal(body.projection.sessionId, A);
        data = { outcome: 'restored', conversationId: A, headMessageId: body.projection.checkpointId, inserted: body.projection.messages.length };
      } else data = { owner: 'desktop', conversationId: A, providerSessionId: A, providerCheckpointId: CP, headMessageId: CP };
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ success: true, data }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const script = new URL('../scripts/native-session-switch.mjs', import.meta.url).pathname;
      const flags = ['--session-id', A, '--desktop-dir', desktopDirectory, '--config-dir', input.configDirectory];
      const env = { ...process.env, HOME: root, PATH: bin + path.delimiter + process.env.PATH,
        SYNTHETIC_LAUNCH_RESULT: marker, LEILEI_NATIVE_LIVE_RELAY_URL: `http://127.0.0.1:${server.address().port}`, LEILEI_NATIVE_LIVE_RELAY_TOKEN: 'PRIVATE_TOKEN' };
      const before = await readFile(transcriptFile);
      const desktop = await execute(process.execPath, [script, manual ? '--desktop-manual' : '--desktop', ...flags], { env });
      assert.equal(JSON.parse(desktop.stdout).owner, 'desktop');
      assert.equal(JSON.parse(desktop.stdout).desktopSessionVerified, false);
      if (manual) {
        await assert.rejects(readFile(marker), error => error.code === 'ENOENT');
        assert.equal(JSON.parse(desktop.stdout).desktopLaunchRequested, false);
      } else assert.deepEqual(JSON.parse(await readFile(marker, 'utf8')), { args: ['--desktop', '--resume', A], cwd: await realpath(root), relayTokenPresent: false });
      assert.deepEqual(await readFile(transcriptFile), before);
      const entries = before.toString().split('\n').map(JSON.parse);
      entries.push({ type: 'user', uuid: nextUser, parentUuid: CP, message: { content: 'PRIVATE_DESKTOP_INPUT' } },
        { type: 'assistant', uuid: nextCp, parentUuid: nextUser, message: { content: 'PRIVATE_DESKTOP_REPLY' } });
      await writeFile(transcriptFile, entries.map(JSON.stringify).join('\n'));
      const restore = await execute(process.execPath, [script, '--restore', ...flags], { env });
      assert.equal(JSON.parse(restore.stdout).providerSessionId, A);
      assert.equal(JSON.parse(restore.stdout).providerCheckpointId, nextCp);
      assert.equal(JSON.parse(restore.stdout).conversationId, A);
      assert.deepEqual(sequence, ['state', 'restore', 'release', 'state', 'restore']);
      assert.doesNotMatch(desktop.stdout + restore.stdout, /PRIVATE_|nativeSnapshot/);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
});

test('switch CLI reports canonical rejection reason without exposing server details or credentials', async () => {
  const { createServer } = await import('node:http');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  await fixture(async ({ input, transcriptFile }) => {
    const before = await readFile(transcriptFile);
    let code = 'CANONICAL_CHECKPOINT_CHANGED';
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      response.writeHead(409);
      response.end(JSON.stringify({ success: false, error: { code, message: 'PRIVATE_SERVER_DETAIL' } }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      for (code of ['CANONICAL_CHECKPOINT_CHANGED', 'CANONICAL_HEAD_CHANGED', 'CANONICAL_HISTORY_CHANGED', 'NATIVE_HISTORY_REWRITTEN']) {
        await assert.rejects(promisify(execFile)(process.execPath,
          [new URL('../scripts/native-session-switch.mjs', import.meta.url).pathname, '--restore', '--desktop-index', input.indexFile,
            '--project-dir', input.projectDirectory, '--config-dir', input.configDirectory],
          { env: { ...process.env, LEILEI_NATIVE_LIVE_RELAY_URL: `http://127.0.0.1:${server.address().port}`, LEILEI_NATIVE_LIVE_RELAY_TOKEN: 'PRIVATE_TOKEN' } }),
          error => error.stderr.trim() === code && !/PRIVATE_TOKEN|PRIVATE_SERVER_DETAIL/.test(error.stderr));
      }
      assert.deepEqual(await readFile(transcriptFile), before);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
});

test('native history requests give restore the long bound, retaining normal 30-second requests and the 30-MiB budget', async () => {
  const { nativeHistoryRequest } = await import('../src/native-session-switch-restore.mjs');
  const original = AbortSignal.timeout;
  const durations = [];
  let calls = 0;
  AbortSignal.timeout = milliseconds => {
    durations.push(milliseconds);
    return new AbortController().signal;
  };
  try {
    const request = nativeHistoryRequest({
      relayUrl: 'https://relay.invalid', relayToken: 'PRIVATE_TOKEN',
      fetchImpl: async (_url, options) => {
        calls++;
        assert.equal(options.headers.Authorization, 'Bearer PRIVATE_TOKEN');
        assert.equal(options.redirect, 'error');
        return Response.json({ success: true, data: { accepted: true } });
      },
    });
    await request('state', { small: true });
    await request('restore', { small: true });
    await request('restore', { snapshot: 'x'.repeat(4 * 1024 * 1024) });
    await request('release', { snapshot: 'x'.repeat(4 * 1024 * 1024) });
    assert.deepEqual(durations, [30_000, 180_000, 180_000, 30_000]);
    assert.equal(calls, 4);
    await assert.rejects(request('restore', { snapshot: 'x'.repeat(30 * 1024 * 1024) }),
      error => error.code === 'NATIVE_RESTORE_PAYLOAD_TOO_LARGE');
    assert.equal(calls, 4, 'oversized restore must fail before sending');
  } finally {
    AbortSignal.timeout = original;
  }
});

test('simulated slow upload past the old 30-second bound succeeds with the bounded large-restore budget', async () => {
  const { nativeHistoryRequest } = await import('../src/native-session-switch-restore.mjs');
  const original = AbortSignal.timeout;
  const virtualDelay = 35_000;
  let requests = 0;
  AbortSignal.timeout = milliseconds => {
    const controller = new AbortController();
    if (milliseconds <= virtualDelay) queueMicrotask(() => controller.abort(new DOMException('PRIVATE_TIMEOUT', 'TimeoutError')));
    return controller.signal;
  };
  try {
    const request = nativeHistoryRequest({
      relayUrl: 'https://relay.invalid', relayToken: 'PRIVATE_TOKEN',
      fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
        requests++;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        queueMicrotask(() => {
          if (!signal.aborted) resolve(Response.json({ success: true, data: { accepted: true } }));
        });
      }),
    });
    assert.deepEqual(await request('restore', { snapshot: 'x'.repeat(4 * 1024 * 1024) }), { accepted: true });
    assert.equal(requests, 1, 'restore must never retry automatically');
  } finally {
    AbortSignal.timeout = original;
  }
});

test('native restore separates timeout from opaque server rejection without leaking details or retrying', async () => {
  const { nativeHistoryRequest } = await import('../src/native-session-switch-restore.mjs');
  const original = AbortSignal.timeout;
  let requests = 0;
  const controller = new AbortController();
  AbortSignal.timeout = () => controller.signal;
  try {
    const timedOut = nativeHistoryRequest({
      relayUrl: 'https://relay.invalid', relayToken: 'PRIVATE_TOKEN',
      fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
        requests++;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        queueMicrotask(() => controller.abort(new DOMException('PRIVATE_BODY_AND_TOKEN', 'TimeoutError')));
      }),
    });
    await assert.rejects(timedOut('restore', { snapshot: 'x'.repeat(4 * 1024 * 1024) }),
      error => error.code === 'NATIVE_RESTORE_TIMEOUT' && error.message === 'NATIVE_RESTORE_TIMEOUT');
    assert.equal(requests, 1);
  } finally {
    AbortSignal.timeout = original;
  }
  const refused = nativeHistoryRequest({
    relayUrl: 'https://relay.invalid', relayToken: 'PRIVATE_TOKEN',
    fetchImpl: async () => {
      requests++;
      return new Response('PRIVATE_SERVER_DETAIL', { status: 413 });
    },
  });
  await assert.rejects(refused('restore', { hello: 'world' }),
    error => error.code === 'NATIVE_RESTORE_SERVER_REJECTED' && error.message === 'NATIVE_RESTORE_SERVER_REJECTED');
  assert.equal(requests, 2, 'neither a timeout nor an HTTP refusal triggers an automatic retry');
});

test('default Desktop launcher runs under a pseudo terminal with stdin from /dev/null', { skip: process.platform !== 'darwin' }, async () => {
  const { launchDesktopNativeSession } = await import('../src/native-session-switch-restore.mjs');
  const { mkdtemp, writeFile, chmod, readFile, rm } = await import('node:fs/promises');
  const dir = await mkdtemp(path.join(tmpdir(), 'desktop-launch-'));
  try {
    // A stand-in `claude` that records whether it saw terminals, like --desktop requires.
    await writeFile(path.join(dir, 'claude'), `#!/bin/sh\ni=; o=; [ -t 0 ] && i=stdin-tty; [ -t 1 ] && o=stdout-tty\nprintf '%s\\n%s\\n%s\\n' "$i" "$o" "$*" > "${dir}/seen"\n`);
    await chmod(path.join(dir, 'claude'), 0o755);
    await launchDesktopNativeSession({ providerSessionId: A, workingDirectory: dir }, undefined, { PATH: `${dir}:/usr/bin:/bin` });
    assert.equal(await readFile(path.join(dir, 'seen'), 'utf8'), `stdin-tty\nstdout-tty\n--desktop --resume ${A}\n`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
