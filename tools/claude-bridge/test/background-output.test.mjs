import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentSdkClaudeTransport } from '../src/agent-sdk-claude-transport.mjs';

function queue() {
  const values = []; let waiter, ended = false;
  return { push(value) { if (waiter) { const resolve = waiter; waiter = null; resolve({ value, done: false }); } else values.push(value); },
    end() { ended = true; waiter?.({ done: true }); },
    [Symbol.asyncIterator]() { return { next() { return values.length ? Promise.resolve({ value: values.shift(), done: false }) : ended ? Promise.resolve({ done: true }) : new Promise(resolve => { waiter = resolve; }); } }; } };
}
const tick = () => new Promise(setImmediate);
const started = id => ({ type: 'command_lifecycle', state: 'started', command_uuid: id, session_id: 's' });
const reply = id => ({ type: 'assistant', session_id: 's', user_message_uuid: id, message: { content: [{ type: 'text', text: 'synthetic' }] } });
const result = id => ({ type: 'result', subtype: 'success', session_id: 's', user_message_uuid: id, result: 'synthetic' });
const image = id => ({ type: 'user', session_id: 's', message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGk=' } }] }] } });
async function fixture(createBackgroundOutput) {
  const output = queue(), frames = [], admissions = []; let sendFile;
  const transport = new AgentSdkClaudeTransport({ environment: {}, cwd: '/synthetic', toolPermissionPolicy: 'auto_allow',
    createSendFileMcpServerImpl: async handler => { sendFile = handler; return { type: 'sdk', name: 'leileios_local' }; },
    queryImpl() { output.push({ type: 'system', subtype: 'init', session_id: 's' }); return { close() { output.end(); }, async *[Symbol.asyncIterator]() { yield* output; } }; },
  });
  const host = await transport.openPersistentSession({ authorize: async context => { admissions.push(context); return true; },
    onBackgroundResult: async frame => { frames.push(frame); }, createBackgroundOutput });
  await tick();
  return { host, frames, admissions, sendFile: input => sendFile(input),
    async step(message) { const delivered = new Promise(resolve => host.events.once('event', resolve)); output.push(message); await delivered; },
    push: message => output.push(message), output };
}
function collector(owner, observations, upload = async () => {}) {
  const ids = []; let aborted = false;
  observations.push({ owner, ids, get aborted() { return aborted; } });
  const send = async () => { await upload(); if (aborted) throw new Error('collector aborted'); const attachmentId = `${owner.commandUuid}-${ids.length}`; ids.push(attachmentId); return { attachmentId }; };
  return { sendFileHandler: send, toolImageHandler: send,
    async seal() { return { outputAttachmentIds: [...ids], outputAttachmentMetadata: [] }; },
    abort() { aborted = true; } };
}

test('background stamped tool images share one segment collector and persist completed IDs', async t => {
  const observations = [];
  const f = await fixture(owner => collector(owner, observations)); t.after(() => f.host.close());
  await f.step(reply('background-one'));
  await f.step(image('tool-one')); await f.step(image('tool-one'));
  await f.step(result('background-one'));
  assert.equal(observations.length, 1);
  assert.equal(observations[0].owner.commandUuid, 'background-one');
  assert.ok(observations[0].owner.segmentId);
  assert.deepEqual(f.frames[0].outputAttachmentIds, ['background-one-0']);
  assert.deepEqual(f.frames[0].outputAttachmentMetadata, []);
  await f.step(reply('background-two')); await f.step(image('tool-one')); await f.step(result('background-two'));
  assert.notEqual(observations[0].owner.segmentId, observations[1].owner.segmentId);
  assert.deepEqual(f.frames[1].outputAttachmentIds, ['background-two-0']);
});

test('ambiguous unstamped background output never creates an upload collector', async t => {
  const observations = [];
  const f = await fixture(owner => collector(owner, observations)); t.after(() => f.host.close());
  await f.step({ ...reply(undefined), user_message_uuid: undefined });
  await f.step(image('ambiguous')); await f.step(result('unknown'));
  await assert.rejects(f.sendFile({ path: 'synthetic.txt' }), /send_file|owner/i);
  assert.deepEqual(observations, []);
  assert.equal(f.frames[0].outputAttachmentIds, undefined);
});

test('native background send_file cannot borrow queued foreground and waits for pending uploads before its receipt', async t => {
  let release; const uploaded = new Promise(resolve => { release = resolve; }); const observations = [];
  const f = await fixture(owner => collector(owner, observations, () => uploaded)); t.after(() => f.host.close());
  let foregroundUploads = 0;
  const foreground = f.host.submit('queued user', { id: 'foreground', sendFileHandler: async () => { foregroundUploads++; return { attachmentId: 'foreign' }; } });
  await tick(); await f.step(started('native-background'));
  const upload = f.sendFile({ path: 'synthetic.txt', displayName: null }); await tick();
  f.push(result('native-background')); await tick();
  assert.equal(f.frames.length, 0, 'receipt must wait for a concurrently running file upload');
  release(); assert.deepEqual(await upload, { attachmentId: 'native-background-0' });
  await tick(); await tick();
  assert.deepEqual(f.frames[0].outputAttachmentIds, ['native-background-0']);
  assert.equal(foregroundUploads, 0);
  assert.ok(f.admissions.some(value => value.phase === 'tool' && value.inputId === 'native-background'));
  await f.step(reply('foreground')); await f.step(result('foreground')); await foreground;
});

test('background upload completion is rejected after native owner changes and close aborts its collector', async t => {
  let release; const uploaded = new Promise(resolve => { release = resolve; }); const observations = [];
  const f = await fixture(owner => collector(owner, observations, () => uploaded)); t.after(() => f.host.close());
  await f.step(started('native-one'));
  const rejected = assert.rejects(f.sendFile({ path: 'synthetic.txt' }), /owner|aborted|closed/i);
  await tick(); await f.step(started('native-two')); release(); await rejected;
  await f.host.close();
  assert.equal(observations[0].aborted, true);
  assert.deepEqual(f.frames, []);
});

test('native background images cannot inherit the preceding foreground reply image handler', async t => {
  const observations = [];
  const f = await fixture(owner => collector(owner, observations)); t.after(() => f.host.close());
  let foregroundUploads = 0;
  const foreground = f.host.submit('user', { id: 'foreground', toolImageHandler: async () => { foregroundUploads++; } });
  await tick(); await f.step(reply('foreground'));
  await f.step(started('native-background'));
  await f.step(image('background-tool'));
  assert.equal(foregroundUploads, 0);
  await f.step(result('native-background'));
  assert.deepEqual(f.frames[0].outputAttachmentIds, ['native-background-0']);
  await f.step(reply('foreground')); await f.step(result('foreground')); await foreground;
});

test('an exact background reply stamp supersedes a preceding native foreground selection for images', async t => {
  const observations = [];
  const f = await fixture(owner => collector(owner, observations)); t.after(() => f.host.close());
  const foreground = f.host.submit('user', { id: 'foreground' }); foreground.catch(() => {});
  await tick(); await f.step(started('foreground'));
  await f.step(reply('background-stamped')); await f.step(image('background-tool'));
  await f.step(result('background-stamped'));
  assert.deepEqual(f.frames[0].outputAttachmentIds, ['background-stamped-0']);
  await f.step(reply('foreground')); await f.step(result('foreground')); await foreground;
});

test('result sealing fences new file uploads while an earlier upload is still pending', async t => {
  let release; const uploaded = new Promise(resolve => { release = resolve; }); const observations = [];
  const f = await fixture(owner => collector(owner, observations, () => uploaded)); t.after(() => f.host.close());
  await f.step(started('native-sealing'));
  const first = f.sendFile({ path: 'first.txt' }); await tick();
  f.push(result('native-sealing')); await tick();
  const late = f.sendFile({ path: 'late.txt' });
  let lateFinished = false; const denied = assert.rejects(late, /seal|owner/i).then(() => { lateFinished = true; });
  await tick();
  assert.equal(lateFinished, true, 'a result boundary must immediately close the segment to new uploads');
  release(); await first; await denied; await tick(); await tick();
  assert.deepEqual(f.frames[0].outputAttachmentIds, ['native-sealing-0']);
});

for (const folded of [false, true]) test(`uploaded background attachments refuse a ${folded ? 'foreground-folded' : 'foreign-command'} result`, { timeout: 1000 }, async t => {
  const observations = [];
  const f = await fixture(owner => collector(owner, observations)); t.after(() => f.host.close());
  const foreground = f.host.submit('user', { id: 'foreground' }); foreground.catch(() => {});
  await tick(); await f.step(started('native-background'));
  await f.sendFile({ path: 'synthetic.txt' });
  const failed = assert.rejects(f.host.completion, /background|attachment|owner/i);
  f.push({ ...result(folded ? 'native-background' : 'foreign-command'), ...(folded ? { user_message_uuids: ['native-background', 'foreground'] } : {}) });
  await failed;
  assert.deepEqual(f.frames, []);
  assert.equal(observations[0].aborted, true);
});
