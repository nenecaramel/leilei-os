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

test('switch requests separate timeout from opaque server rejection without leaking details or retrying', async () => {
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
    await assert.rejects(timedOut('attachment-upload-slot', { small: true }),
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
  await assert.rejects(refused('attachment-upload-slot', { hello: 'world' }),
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

test('continuation attach/release exchanges metadata only, never restores history/assets or modifies native files', async () => {
  const { attachDesktopNativeContinuation, handoffNativeContinuationToDesktop } = await import('../src/native-session-continuation.mjs');
  await fixture(async ({ input, transcriptFile }) => {
    const before = await readFile(transcriptFile), calls = [];
    const options = { input: { ...input, historyMode: 'continuation' }, conversationId: A, relayUrl: 'https://fixture.example', relayToken: 'PRIVATE_TOKEN', retryDelaysMs: [],
      fetchImpl: async (url, request) => {
        const route = new URL(url).pathname.split('/').at(-1), body = JSON.parse(request.body);
        calls.push({ route, body });
        assert.doesNotMatch(request.body, /PRIVATE_PROMPT|PRIVATE_REPLY|nativeSnapshot|projection|displayAssets/);
        const data = route === 'continuation-state' ? { expectedHeadMessageId: null, expectedRevision: input.expectedRevision,
          providerSessionId: A, providerCheckpointId: CP, effectiveWorkingDirectory: '/fixture', owner: 'desktop' }
          : route === 'continuation-release-begin' ? { outcome: 'releasing', owner: 'releasing', conversationId: A, headMessageId: null, providerSessionId: A, expectedRevision: '1'.repeat(64) }
          : { outcome: 'attached', owner: route === 'continuation-release' ? 'desktop' : 'leileios', conversationId: A,
            headMessageId: null, providerSessionId: A, providerCheckpointId: CP, inserted: 0 };
        return new Response(JSON.stringify({ success: true, data }));
      },
    };
    assert.equal((await attachDesktopNativeContinuation(options)).inserted, 0);
    let launched;
    await handoffNativeContinuationToDesktop({ ...options, launchImpl: async selection => { launched = selection.providerSessionId; } });
    assert.equal(launched, A);
    assert.deepEqual(calls.map(c => c.route), ['continuation-state', 'continuation-attach', 'continuation-state', 'continuation-release-begin', 'continuation-release']);
    assert.deepEqual(await readFile(transcriptFile), before);
  });
});

test('continuation refuses pending durable recovery and open native peers before attachment', async () => {
  const { attachDesktopNativeContinuation } = await import('../src/native-session-continuation.mjs');
  await fixture(async ({ input }) => {
    const options = { input, conversationId: A, relayUrl: 'https://fixture.example', relayToken: 'PRIVATE',
      fetchImpl: async () => assert.fail('must refuse before network') };
    const scope = path.join(input.recoveryDirectory, 'terminal-results', 'a'.repeat(64));
    await mkdir(scope, { recursive: true }); await writeFile(path.join(scope, 'pending.json'), '{}');
    await assert.rejects(attachDesktopNativeContinuation(options), e => e.code === 'NATIVE_SESSION_RECOVERY_REQUIRED');
  });
});

test('fixed CLI continuation mode uses the metadata endpoint instead of legacy restore', async () => {
  const { createServer } = await import('node:http');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  await fixture(async ({ input, transcriptFile }) => {
    const before = await readFile(transcriptFile), routes = [];
    const server = createServer(async (request, response) => {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString();
      assert.doesNotMatch(text, /PRIVATE_PROMPT|PRIVATE_REPLY|nativeSnapshot|projection/);
      assert.equal(request.headers.authorization, 'Bearer fixture');
      const route = request.url.split('/').at(-1); routes.push(route);
      const data = route === 'continuation-state' ? { expectedHeadMessageId: null, expectedRevision: null,
        providerSessionId: null, providerCheckpointId: null, effectiveWorkingDirectory: null, owner: null }
        : { outcome: 'attached', owner: 'leileios', conversationId: A, providerSessionId: A, providerCheckpointId: CP, headMessageId: null, inserted: 0 };
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ success: true, data }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const { stdout, stderr } = await promisify(execFile)(process.execPath, [new URL('../scripts/native-session-switch.mjs', import.meta.url).pathname,
        '--restore', '--history-mode', 'continuation', '--desktop-index', input.indexFile, '--project-dir', input.projectDirectory,
        '--config-dir', input.configDirectory, '--conversation-id', A], { env: { ...process.env, HOME: path.dirname(input.configDirectory),
          LEILEI_NATIVE_LIVE_RELAY_URL: `http://127.0.0.1:${server.address().port}`, LEILEI_NATIVE_LIVE_RELAY_TOKEN: 'fixture' }, timeout: 10_000 });
      assert.equal(stderr, ''); assert.equal(JSON.parse(stdout).inserted, 0);
      assert.deepEqual(routes, ['continuation-state', 'continuation-attach']);
      assert.deepEqual(await readFile(transcriptFile), before);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
});

test('continuation detects transcript changes across state round trips before binding and never falls back to full upload', async () => {
  const { attachDesktopNativeContinuation } = await import('../src/native-session-continuation.mjs');
  await fixture(async ({ input, transcriptFile }) => {
    let calls = 0;
    await assert.rejects(attachDesktopNativeContinuation({ input, conversationId: A, relayUrl: 'https://fixture.example', relayToken: 'fixture', retryDelaysMs: [],
      fetchImpl: async () => {
        calls++;
        await writeFile(transcriptFile, (await readFile(transcriptFile, 'utf8')) + '\n' + JSON.stringify({ type: 'system', subtype: 'local_auxiliary' }));
        return Response.json({ success: true, data: { expectedHeadMessageId: null, expectedRevision: null,
          providerSessionId: null, providerCheckpointId: null, owner: null } });
      },
    }), e => e.code === 'STALE_NATIVE_SELECTION');
    assert.equal(calls, 1);
  });
});

test('Desktop continuation re-pins only native exit metadata the drained daemon writer appends around its receipt', async t => {
  const { handoffNativeContinuationToDesktop } = await import('../src/native-session-continuation.mjs');
  const { createNativeSessionDrainServer } = await import('../src/native-session-daemon-drain.mjs');
  const exitMetadata = [{ type: 'last-prompt', lastPrompt: 'PRIVATE_PROMPT', sessionId: A }, { type: 'cost-state', sessionId: A, totalCostUSD: 1 }];
  const newTurn = [{ type: 'user', uuid: D, parentUuid: CP, message: { content: 'new turn' } }];
  // The SDK child flushes its exit records either before or after the receipt.
  for (const [appended, delayMs] of [[exitMetadata, 0], [exitMetadata, 60], [newTurn, 60]]) {
    await fixture(async ({ input, transcriptFile }) => {
      let pending = Promise.resolve();
      const append = async () => writeFile(transcriptFile, (await readFile(transcriptFile, 'utf8')) + '\n' + appended.map(JSON.stringify).join('\n'));
      const close = await createNativeSessionDrainServer({ recoveryDirectory: input.recoveryDirectory, drain: async () => {
        if (delayMs) pending = new Promise(resolve => setTimeout(resolve, delayMs)).then(append);
        else await append();
        return { ready: true, writer: 'closed', tasks: [] };
      } });
      t.after(close);
      const routes = [];
      let launched = false;
      const run = handoffNativeContinuationToDesktop({ input: { ...input, historyMode: 'continuation' }, conversationId: A,
        relayUrl: 'https://fixture.example', relayToken: 'fixture', retryDelaysMs: [], drainSettle: { pollMs: 20, quietMs: 150, timeoutMs: 3000 },
        launchImpl: async () => { launched = true; },
        fetchImpl: async (url, request) => {
          const route = new URL(url).pathname.split('/').at(-1), body = JSON.parse(request.body);
          routes.push({ route, body });
          const data = route === 'continuation-state' ? { expectedHeadMessageId: null, expectedRevision: null,
            providerSessionId: A, providerCheckpointId: CP, effectiveWorkingDirectory: '/fixture', owner: 'leileios' }
            : route === 'continuation-release-begin' ? { outcome: 'releasing', owner: 'releasing', conversationId: A, headMessageId: null, providerSessionId: A, expectedRevision: '1'.repeat(64) }
            : { outcome: 'attached', owner: 'desktop', conversationId: A, headMessageId: null, providerSessionId: A, providerCheckpointId: CP, inserted: 0 };
          return Response.json({ success: true, data });
        } });
      try {
        if (appended === exitMetadata) {
          await run;
          await pending;
          const settled = createHash('sha256').update(await readFile(transcriptFile)).digest('hex');
          assert.notEqual(settled, input.expectedRevision);
          assert.equal(routes.at(-1).route, 'continuation-release');
          assert.equal(routes.at(-1).body.revision, settled);
          assert.equal(launched, true);
        } else {
          await assert.rejects(run, e => e.code === 'NATIVE_INSPECTION_CHANGED');
          assert.deepEqual(routes.map(c => c.route), ['continuation-state', 'continuation-release-begin', 'continuation-release-cancel']);
          assert.equal(launched, false);
        }
      } finally { await pending; await close(); }
    });
  }
});

test('continuation attach tells a running daemon to lift its handoff fence only after the server attaches', async t => {
  const { attachDesktopNativeContinuation, handoffNativeContinuationToDesktop } = await import('../src/native-session-continuation.mjs');
  const { createNativeSessionDrainServer } = await import('../src/native-session-daemon-drain.mjs');
  await fixture(async ({ input }) => {
    const events = [];
    const close = await createNativeSessionDrainServer({ recoveryDirectory: input.recoveryDirectory,
      drain: async (c, s) => { events.push(['drain', c, s]); return { ready: true, writer: 'closed', tasks: [] }; },
      resume: async (c, s) => { events.push(['resume', c, s]); } });
    t.after(close);
    let attachOk = true;
    const options = { input: { ...input, historyMode: 'continuation' }, conversationId: A, relayUrl: 'https://fixture.example', relayToken: 'fixture', retryDelaysMs: [],
      drainSettle: { pollMs: 10, quietMs: 20, timeoutMs: 1000 }, launchImpl: async () => {},
      fetchImpl: async url => {
        const route = new URL(url).pathname.split('/').at(-1);
        events.push([route]);
        if (route === 'continuation-attach' && !attachOk) return Response.json({ success: false, error: { code: 'NATIVE_SESSION_ALREADY_ATTACHED' } }, { status: 409 });
        const data = route === 'continuation-state' ? { expectedHeadMessageId: null, expectedRevision: null,
          providerSessionId: A, providerCheckpointId: CP, effectiveWorkingDirectory: '/fixture', owner: 'desktop' }
          : route === 'continuation-release-begin' ? { outcome: 'releasing', owner: 'releasing', conversationId: A, headMessageId: null, providerSessionId: A, expectedRevision: '1'.repeat(64) }
          : { outcome: 'attached', owner: route === 'continuation-release' ? 'desktop' : 'leileios', conversationId: A, headMessageId: null, providerSessionId: A, providerCheckpointId: CP, inserted: 0 };
        return Response.json({ success: true, data });
      } };
    await handoffNativeContinuationToDesktop(options);
    await attachDesktopNativeContinuation(options);
    assert.deepEqual(events.map(e => e[0]), ['continuation-state', 'continuation-release-begin', 'drain', 'continuation-release', 'continuation-state', 'continuation-attach', 'resume']);
    assert.deepEqual(events.at(-1), ['resume', A, A]);
    events.length = 0; attachOk = false;
    await assert.rejects(attachDesktopNativeContinuation(options));
    assert.equal(events.some(e => e[0] === 'resume'), false);
    await close();
  });
});

test('Desktop continuation begins before drain and cancels then resumes every failed exit', async t => {
  const { handoffNativeContinuationToDesktop } = await import('../src/native-session-continuation.mjs');
  const { createNativeSessionDrainServer } = await import('../src/native-session-daemon-drain.mjs');
  const R1 = '1'.repeat(64), R2 = '2'.repeat(64);
  for (const stage of ['success', 'pin', 'drain', 'settle', 'recovery', 'preflight', 'complete', 'launch', 'cancel', 'resume', 'malformed-cancel']) {
    await t.test(stage, async () => fixture(async ({ input, transcriptFile }) => {
      const events = [], bodies = {};
      const expectedCode = { pin: 'ENOENT', drain: 'NATIVE_DAEMON_DRAIN_UNCONFIRMED', settle: 'NATIVE_INSPECTION_CHANGED',
        recovery: 'NATIVE_SESSION_RECOVERY_REQUIRED', preflight: 'STALE_NATIVE_SELECTION', complete: 'STALE_NATIVE_PROJECTION',
        launch: 'NATIVE_DESKTOP_LAUNCH_FAILED', cancel: 'NATIVE_DAEMON_DRAIN_UNCONFIRMED', resume: 'NATIVE_DAEMON_DRAIN_UNCONFIRMED',
        'malformed-cancel': 'NATIVE_DAEMON_DRAIN_UNCONFIRMED' }[stage];
      const close = await createNativeSessionDrainServer({ recoveryDirectory: input.recoveryDirectory,
        drain: async () => {
          events.push('drain');
          if (['drain', 'cancel', 'resume', 'malformed-cancel'].includes(stage)) throw new Error('fixture drain failure');
          if (stage === 'settle') await writeFile(transcriptFile, '{}\n');
          if (stage === 'recovery') {
            const scope = path.join(input.recoveryDirectory, 'terminal-results', 'a'.repeat(64));
            await mkdir(scope, { recursive: true }); await writeFile(path.join(scope, 'pending.json'), '{}');
          }
          return { ready: true, writer: 'closed', tasks: [] };
        }, resume: async () => { events.push('resume'); if (stage === 'resume') throw new Error('fixture resume failure'); } });
      const options = { input: stage === 'preflight' ? { ...input, expectedCheckpointId: D } : input, conversationId: A,
        relayUrl: 'https://fixture.example', relayToken: 'fixture', retryDelaysMs: [],
        drainSettle: { pollMs: 1, quietMs: 1, timeoutMs: 100 },
        launchImpl: async () => { events.push('launch'); if (stage === 'launch') throw Object.assign(new Error('launch'), { code: expectedCode }); },
        fetchImpl: async (url, request) => {
          const route = new URL(url).pathname.split('/').at(-1); events.push(route); bodies[route] = JSON.parse(request.body);
          if (route === 'continuation-state') return Response.json({ success: true, data: { expectedHeadMessageId: null,
            expectedRevision: input.expectedRevision, providerSessionId: A, providerCheckpointId: CP, effectiveWorkingDirectory: '/fixture', owner: 'leileios' } });
          if (route === 'continuation-release-begin') {
            if (stage === 'pin') await rm(transcriptFile);
            return Response.json({ success: true, data: { outcome: 'releasing', owner: 'releasing', conversationId: A,
              headMessageId: null, providerSessionId: A, expectedRevision: R1 } });
          }
          if (route === 'continuation-release-cancel') {
            if (['cancel', 'launch'].includes(stage)) return Response.json({ success: false, error: { code: 'STALE_NATIVE_PROJECTION' } }, { status: 409 });
            return Response.json({ success: true, data: stage === 'malformed-cancel' ? {} : {
              outcome: 'cancelled', owner: 'leileios', conversationId: A, expectedRevision: R2 } });
          }
          if (stage === 'complete') return Response.json({ success: false, error: { code: expectedCode } }, { status: 409 });
          return Response.json({ success: true, data: { outcome: 'attached', owner: 'desktop', conversationId: A,
            headMessageId: null, providerSessionId: A, providerCheckpointId: CP, inserted: 0 } });
        } };
      try {
        if (stage === 'success') {
          await handoffNativeContinuationToDesktop(options);
          assert.deepEqual(events, ['continuation-state', 'continuation-release-begin', 'drain', 'continuation-release', 'launch']);
        } else {
          await assert.rejects(handoffNativeContinuationToDesktop(options), error => {
            assert.equal(error.code, expectedCode);
            if (['cancel', 'launch'].includes(stage)) assert.deepEqual(error.cleanupErrors.map(e => e.code), ['STALE_NATIVE_PROJECTION']);
            if (stage === 'resume') assert.deepEqual(error.cleanupErrors.map(e => e.code), ['NATIVE_DAEMON_RESUME_UNCONFIRMED']);
            if (stage === 'malformed-cancel') assert.deepEqual(error.cleanupErrors.map(e => e.code), ['NATIVE_RELEASE_CANCEL_UNCONFIRMED']);
            return true;
          });
          assert.deepEqual(events.slice(-2), ['continuation-release-cancel', 'resume']);
          assert.deepEqual(bodies['continuation-release-cancel'], { conversationId: A, expectedRevision: R1 });
        }
        assert.deepEqual(bodies['continuation-release-begin'], { conversationId: A, sessionId: A,
          expectedHeadMessageId: null, expectedRevision: input.expectedRevision });
        if (bodies['continuation-release']) assert.equal(bodies['continuation-release'].expectedRevision, R1);
      } finally { await close(); }
    }));
  }
});

test('fixed CLI prints original and cancel failures after resuming the daemon', async () => {
  const { createServer } = await import('node:http');
  const { createNativeSessionDrainServer } = await import('../src/native-session-daemon-drain.mjs');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  await fixture(async ({ input }) => {
    const root = path.dirname(input.configDirectory), desktopDirectory = path.join(root, 'desktop');
    const org = path.join(desktopDirectory, 'account', 'org');
    await mkdir(org, { recursive: true }); await copyFile(input.indexFile, path.join(org, `local_${D}.json`));
    const events = [];
    const close = await createNativeSessionDrainServer({ recoveryDirectory: path.join(root, '.leileios'),
      drain: async () => { events.push('drain'); throw new Error('PRIVATE_DRAIN'); },
      resume: async () => { events.push('resume'); } });
    const server = createServer(async (request, response) => {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const route = request.url.split('/').at(-1); events.push(route);
      response.setHeader('Content-Type', 'application/json');
      if (route === 'continuation-release-cancel') {
        response.statusCode = 409;
        response.end(JSON.stringify({ success: false, error: { code: 'STALE_NATIVE_PROJECTION', message: 'PRIVATE_CANCEL' } }));
      } else response.end(JSON.stringify({ success: true, data: route === 'continuation-state' ? {
        expectedHeadMessageId: null, expectedRevision: input.expectedRevision, providerSessionId: A,
        providerCheckpointId: CP, effectiveWorkingDirectory: '/fixture', owner: 'leileios',
      } : { outcome: 'releasing', owner: 'releasing', conversationId: A, headMessageId: null,
        providerSessionId: A, expectedRevision: '1'.repeat(64) } }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      await assert.rejects(promisify(execFile)(process.execPath, [new URL('../scripts/native-session-switch.mjs', import.meta.url).pathname,
        '--desktop', '--history-mode', 'continuation', '--session-id', A, '--desktop-dir', desktopDirectory,
        '--config-dir', input.configDirectory, '--conversation-id', A], { env: { ...process.env, HOME: root,
          LEILEI_NATIVE_LIVE_RELAY_URL: `http://127.0.0.1:${server.address().port}`, LEILEI_NATIVE_LIVE_RELAY_TOKEN: 'fixture' }, timeout: 10_000 }), error => {
        assert.equal(error.code, 1);
        assert.equal(error.stderr, 'NATIVE_DAEMON_DRAIN_UNCONFIRMED\nSTALE_NATIVE_PROJECTION\n');
        assert.equal(error.stdout, '');
        return true;
      });
      assert.deepEqual(events, ['continuation-state', 'continuation-release-begin', 'drain', 'continuation-release-cancel', 'resume']);
    } finally { await close(); await new Promise(resolve => server.close(resolve)); }
  });
});

test('Desktop continuation retries lost begin and cancel responses with identical CAS payloads', async t => {
  const { handoffNativeContinuationToDesktop } = await import('../src/native-session-continuation.mjs');
  const { createNativeSessionDrainServer } = await import('../src/native-session-daemon-drain.mjs');
  for (const stage of ['begin-unavailable', 'cancel-unavailable', 'begin-timeout', 'cancel-timeout', 'begin-exhausted']) {
    await t.test(stage, async () => fixture(async ({ input }) => {
      const calls = [], delays = [], R1 = '1'.repeat(64), counts = {};
      const close = await createNativeSessionDrainServer({ recoveryDirectory: input.recoveryDirectory,
        drain: async () => { calls.push({ route: 'drain' }); throw new Error('fixture drain refusal'); },
        resume: async () => { calls.push({ route: 'resume' }); } });
      const originalTimeout = AbortSignal.timeout;
      if (stage.endsWith('timeout')) AbortSignal.timeout = () => originalTimeout(1);
      try {
        await assert.rejects(handoffNativeContinuationToDesktop({ input, conversationId: A,
          relayUrl: 'https://fixture.example', relayToken: 'fixture', retryDelaysMs: [1, 2], sleep: async delay => { delays.push(delay); },
          fetchImpl: async (url, request) => {
            const route = new URL(url).pathname.split('/').at(-1), body = JSON.parse(request.body);
            calls.push({ route, body }); counts[route] = (counts[route] ?? 0) + 1;
            if (route === 'continuation-state') return Response.json({ success: true, data: { expectedHeadMessageId: null,
              expectedRevision: input.expectedRevision, providerSessionId: A, providerCheckpointId: CP, effectiveWorkingDirectory: '/fixture', owner: 'leileios' } });
            const lostRoute = stage.startsWith('begin') ? 'continuation-release-begin' : 'continuation-release-cancel';
            if (route === lostRoute && (counts[route] === 1 || stage === 'begin-exhausted')) {
              // The server committed before its response was lost. A replay must
              // reuse the original CAS and return that committed revision.
              if (stage.endsWith('timeout')) await new Promise(resolve => setTimeout(resolve, 5));
              throw new TypeError('fixture response lost');
            }
            return Response.json({ success: true, data: route === 'continuation-release-begin' ? {
              outcome: counts[route] > 1 ? 'already_current' : 'releasing', owner: 'releasing', conversationId: A,
              headMessageId: null, providerSessionId: A, expectedRevision: R1,
            } : { outcome: 'already_current', owner: 'leileios', conversationId: A, expectedRevision: '2'.repeat(64) } });
          } }), error => {
          assert.equal(error.code, stage === 'begin-exhausted' ? 'NATIVE_RESTORE_UNAVAILABLE' : 'NATIVE_DAEMON_DRAIN_UNCONFIRMED');
          assert.equal(error.cleanupErrors, undefined);
          return true;
        });
        const begins = calls.filter(call => call.route === 'continuation-release-begin');
        assert.deepEqual(begins.map(call => call.body), Array.from({ length: stage === 'begin-exhausted' ? 3 : stage.startsWith('begin') ? 2 : 1 }, () => ({
          conversationId: A, sessionId: A, expectedHeadMessageId: null, expectedRevision: input.expectedRevision,
        })));
        const cancels = calls.filter(call => call.route === 'continuation-release-cancel');
        if (stage === 'begin-exhausted') {
          assert.equal(cancels.length, 0);
          assert.equal(calls.some(call => ['drain', 'resume'].includes(call.route)), false);
          assert.deepEqual(delays, [1, 2]);
        } else {
          assert.deepEqual(cancels.map(call => call.body), Array.from({ length: stage.startsWith('cancel') ? 2 : 1 }, () => ({ conversationId: A, expectedRevision: R1 })));
          assert.equal(calls.at(-1).route, 'resume');
          assert.deepEqual(delays, [1]);
        }
      } finally { AbortSignal.timeout = originalTimeout; await close(); }
    }));
  }
});

test('manual continuation recovers an exact completed failed input using UUID evidence only',async()=>{
 const {attachDesktopNativeContinuation}=await import('../src/native-session-continuation.mjs');
 await fixture(async({input,transcriptFile})=>{
  const failedInput='00000000-0000-4000-8000-000000000051',newCp='00000000-0000-4000-8000-000000000052',prepare='00000000-0000-4000-8000-000000000053';
  const old=await readFile(transcriptFile,'utf8');const text=old+'\n'+[
   {type:'user',uuid:failedInput,parentUuid:CP,sessionId:A,message:{content:'PRIVATE_FAILED_INPUT'}},
   {type:'assistant',uuid:newCp,parentUuid:failedInput,sessionId:A,message:{content:[{type:'text',text:'PRIVATE_COMPLETED_REPLY'}],stop_reason:'end_turn'}}
  ].map(JSON.stringify).join('\n')+'\n';await writeFile(transcriptFile,text);
  const options={retryDelaysMs:[],sleep:async()=>{},input:{...input,expectedCheckpointId:newCp,expectedRevision:createHash('sha256').update(text).digest('hex')},conversationId:A,relayUrl:'https://fixture.test',relayToken:'fixture',fetchImpl:async(url,request)=>{
   const route=new URL(url).pathname.split('/').at(-1),body=JSON.parse(request.body);assert.doesNotMatch(request.body,/PRIVATE_FAILED_INPUT|PRIVATE_COMPLETED_REPLY|normalizedEvents|projection/);
   if(route==='continuation-state')return Response.json({success:true,data:{expectedHeadMessageId:null,expectedRevision:null,providerSessionId:A,providerCheckpointId:CP,effectiveWorkingDirectory:'/fixture',owner:'leileios',recoverableFailedTurn:{prepareId:prepare,userMessageId:failedInput}}});
   assert.equal(route,'continuation-attach');assert.equal(body.recoveredFailedTurnId,prepare);assert.ok(body.checkpointIds.includes(failedInput));
   return Response.json({success:true,data:{outcome:'attached',owner:'leileios',conversationId:A,headMessageId:null,providerSessionId:A,providerCheckpointId:newCp,inserted:0}});
  }};
  assert.equal((await attachDesktopNativeContinuation(options)).nativeProgressRecovered,true);assert.equal(await readFile(transcriptFile,'utf8'),text);
 });
});

test('continuation recovery gate is scoped: another session\'s quarantined receipt does not block, this session\'s does', async () => {
  const { handoffNativeContinuationToDesktop } = await import('../src/native-session-continuation.mjs');
  const quarantine = async (recoveryDirectory, { sessionId, conversationId, name }) => {
    const listenerInstanceId = '00000000-0000-4000-8000-0000000000a1', generationId = '00000000-0000-4000-8000-0000000000a2';
    const receiptId = '00000000-0000-4000-8000-0000000000a3', sourcePrepareId = '00000000-0000-4000-8000-0000000000a4';
    const blocked = path.join(recoveryDirectory, 'background-results', 'e'.repeat(64), 'blocked');
    await mkdir(blocked, { recursive: true });
    const file = name ?? createHash('sha256').update(JSON.stringify([listenerInstanceId, generationId, receiptId])).digest('hex') + '.json';
    await writeFile(path.join(blocked, file), JSON.stringify({ sourcePrepareId, receiptId, listenerInstanceId, generationId,
      parentProviderCheckpointId: CP, result: { prepare_id: sourcePrepareId, conversation_id: conversationId, provider_session_id: sessionId } }));
    return blocked;
  };
  const OTHER_SESSION = '00000000-0000-4000-8000-0000000000b1', OTHER_CONVERSATION = '00000000-0000-4000-8000-0000000000b2';
  const run = async (setup, expected) => fixture(async ({ input }) => {
    await setup(input.recoveryDirectory);
    const routes = [];
    const options = { input: { ...input, historyMode: 'continuation' }, conversationId: D, relayUrl: 'https://fixture.example', relayToken: 'PRIVATE', retryDelaysMs: [],
      launchImpl: async () => {},
      fetchImpl: async (url, request) => {
        const route = new URL(url).pathname.split('/').at(-1); routes.push(route);
        const data = route === 'continuation-state' ? { expectedHeadMessageId: null, expectedRevision: '0'.repeat(64),
          providerSessionId: A, providerCheckpointId: CP, effectiveWorkingDirectory: '/fixture', owner: 'leileios' }
          : route === 'continuation-release-begin' ? { outcome: 'releasing', owner: 'releasing', conversationId: D, headMessageId: null, providerSessionId: A, expectedRevision: '1'.repeat(64) }
          : route === 'continuation-release-cancel' ? { outcome: 'cancelled', owner: 'leileios', conversationId: D, expectedRevision: '2'.repeat(64) }
          : { outcome: 'attached', owner: 'desktop', conversationId: D, headMessageId: null, providerSessionId: A, providerCheckpointId: CP, inserted: 0 };
        return new Response(JSON.stringify({ success: true, data }));
      } };
    if (expected) { await assert.rejects(handoffNativeContinuationToDesktop(options), e => e.code === expected); assert.ok(routes.includes('continuation-release-cancel')); }
    else { assert.equal((await handoffNativeContinuationToDesktop(options)).owner, 'desktop'); assert.ok(!routes.includes('continuation-release-cancel')); }
  });
  await run(dir => quarantine(dir, { sessionId: OTHER_SESSION, conversationId: OTHER_CONVERSATION }), null);
  await run(dir => quarantine(dir, { sessionId: A, conversationId: OTHER_CONVERSATION }), 'NATIVE_SESSION_RECOVERY_REQUIRED');
  await run(dir => quarantine(dir, { sessionId: OTHER_SESSION, conversationId: D }), 'NATIVE_SESSION_RECOVERY_REQUIRED');
  await run(dir => quarantine(dir, { sessionId: OTHER_SESSION, conversationId: OTHER_CONVERSATION, name: 'f'.repeat(64) + '.json' }), 'NATIVE_RECOVERY_UNCONFIRMED');
  await run(async dir => { const scope = path.join(dir, 'terminal-results', 'a'.repeat(64)); await mkdir(scope, { recursive: true }); await writeFile(path.join(scope, 'pending.json'), '{}'); },
    'NATIVE_SESSION_RECOVERY_REQUIRED');
});
