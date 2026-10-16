import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentSdkSessionHost } from '../src/agent-sdk-session-host.mjs';

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function queue() {
  const items = []; let waiter; let ended = false;
  return { push(value) { if (waiter) { const r = waiter; waiter = null; r({ value, done: false }); } else items.push(value); },
    end() { ended = true; waiter?.({ done: true }); },
    [Symbol.asyncIterator]() { return { next() { return items.length ? Promise.resolve({ value: items.shift(), done: false }) : ended ? Promise.resolve({ done: true }) : new Promise(r => { waiter = r; }); } }; } };
}
async function fixture(t, stop = async () => {}, queryOptions = {}) {
  const output = queue(); const stopped = []; let closes = 0, interrupts = 0;
  const host = await createAgentSdkSessionHost({ queryOptions, queryImpl: () => ({
    [Symbol.asyncIterator]: () => output[Symbol.asyncIterator](), close() { closes++; output.end(); },
    async interrupt() { interrupts++; return { still_queued: [] }; },
    stopTask(id) { stopped.push(id); return stop(id); },
  }) });
  t.after(() => host.close());
  const event = message => new Promise(resolve => { host.events.once('event', resolve); output.push({ session_id: 'session', type: 'system', ...message }); });
  await event({ subtype: 'init' });
  return { host, event, stopped, output, get closes() { return closes; }, get interrupts() { return interrupts; } };
}
const snapshot = tasks => ({ subtype: 'background_tasks_changed', tasks });
const task = (run_id = '002') => ({ task_id: 'task', run_id, task_type: 'shell', description: 'synthetic task' });

// These tests fail if real host membership/control ownership is missing or a late edge retargets a task.
test('idle task state survives a foreground result and exposes detached run handles', async t => {
  const f = await fixture(t);
  await f.event(snapshot([task()]));
  const state = f.host.listTasks();
  assert.equal(state.length, 1); assert.equal(state[0].status, 'running');
  assert.equal(state[0].runId, '002'); assert.equal(state[0].taskId, 'task');
  assert.ok(state[0].handle); state[0].status = 'completed';
  assert.equal(f.host.listTasks()[0].status, 'running');
  const turn = f.host.submit('synthetic', { id: 'input' });
  await f.event({ type: 'result', subtype: 'success', user_message_uuid: 'input' }); await turn;
  assert.equal(f.host.listTasks()[0].status, 'running');
});
test('late terminal and progress events cannot overwrite a resumed run', async t => {
  const f = await fixture(t); await f.event(snapshot([task('001')]));
  const old = f.host.listTasks()[0];
  await f.event(snapshot([task('002')]));
  await f.event({ subtype: 'task_notification', task_id: 'task', run_id: '001', status: 'completed', summary: 'old' });
  await f.event({ subtype: 'task_progress', task_id: 'task', run_id: '001', summary: 'old progress' });
  const current = f.host.listTasks().find(x => x.active);
  assert.equal(current.runId, '002'); assert.equal(current.status, 'running'); assert.equal(current.summary, null);
  await assert.rejects(f.host.stopTask('task', { handle: old.handle }), /stale/i);
  assert.deepEqual(f.stopped, []);
});
test('task disappearance without a terminal notification is ended, not completed', async t => {
  const f = await fixture(t); await f.event(snapshot([task()])); await f.event(snapshot([]));
  assert.equal(f.host.listTasks()[0].status, 'ended');
  await f.event({ subtype: 'task_notification', task_id: 'task', run_id: '002', status: 'completed', summary: 'done' });
  assert.equal(f.host.listTasks()[0].status, 'completed'); assert.equal(f.host.listTasks()[0].summary, 'done');
});
test('missing run identity never binds an ambiguous late notification to a reused task id', async t => {
  const f = await fixture(t); const legacy = { task_id: 'task', task_type: 'shell' };
  await f.event(snapshot([legacy])); const first = f.host.listTasks()[0];
  await f.event(snapshot([])); await f.event(snapshot([legacy]));
  await f.event({ subtype: 'task_notification', task_id: 'task', status: 'completed' });
  const current = f.host.listTasks().find(x => x.active);
  assert.notEqual(current.handle, first.handle); assert.equal(current.status, 'running');
  await assert.rejects(f.host.stopTask('task', { handle: first.handle }), /stale/i);
});
test('duplicate stop requests share one RPC and wait for authoritative membership', async t => {
  const reply = deferred(); const f = await fixture(t, () => reply.promise);
  await f.event(snapshot([task()])); const { handle } = f.host.listTasks()[0];
  const first = f.host.stopTask('task', { handle }); const second = f.host.stopTask('task', { handle });
  assert.deepEqual(f.stopped, ['task']); reply.resolve(); await Promise.all([first, second]);
  assert.equal(f.host.listTasks()[0].status, 'running'); assert.equal(f.host.listTasks()[0].stopStatus, 'requested'); assert.equal(f.host.tasks.size, 1);
  await f.event({ subtype: 'task_notification', task_id: 'task', run_id: '002', status: 'stopped' });
  assert.equal(f.host.listTasks()[0].status, 'stopped'); assert.equal(f.host.tasks.size, 1);
  await f.event(snapshot([])); assert.equal(f.host.tasks.size, 0);
});
test('an in-flight stop never reports success for a replacement run or resends', async t => {
  const reply = deferred(); const f = await fixture(t, () => reply.promise);
  await f.event(snapshot([task('001')])); const { handle } = f.host.listTasks()[0];
  const stopped = assert.rejects(f.host.stopTask('task', { handle }), /stale/i);
  await f.event(snapshot([task('002')])); reply.resolve(); await stopped;
  assert.deepEqual(f.stopped, ['task']); assert.equal(f.host.listTasks().find(x => x.active).status, 'running');
});
test('close and unexpected process exit leave unfinished tasks unknown without replay', async t => {
  for (const fail of [false, true]) {
    const f = await fixture(t); await f.event(snapshot([task()]));
    if (fail) { const rejected = assert.rejects(f.host.completion, /ended/i); f.output.end(); await rejected; }
    else { await f.host.close(); await f.host.completion; }
    assert.equal(f.host.listTasks()[0].status, 'unknown'); assert.equal(f.host.listTasks()[0].active, false);
    assert.deepEqual(f.stopped, []);
  }
});
test('bounded history retains active tasks and snapshots do not alias SDK objects', async t => {
  const f = await fixture(t); const raw = task(); await f.event(snapshot([raw]));
  raw.description = 'mutated'; assert.equal(f.host.listTasks()[0].description, 'synthetic task');
  for (let i = 0; i < 140; i++) { await f.event(snapshot([task(), { task_id: `old-${i}`, task_type: 'shell' }])); }
  const state = f.host.listTasks(); assert.ok(state.length <= 130); assert.equal(state.filter(x => x.active).length, 2);
  assert.ok(state.some(x => x.taskId === 'task' && x.active));
});
test('task bookends arriving before a level snapshot retain progress and terminal evidence', async t => {
  const f = await fixture(t);
  await f.event({ subtype: 'task_progress', task_id: 'task', run_id: '002', summary: 'working' });
  await f.event(snapshot([task()]));
  assert.equal(f.host.listTasks().find(x => x.active).summary, 'working');
  await f.event(snapshot([]));
  await f.event({ subtype: 'task_notification', task_id: 'other', run_id: '001', status: 'completed', summary: 'finished' });
  await f.event(snapshot([{ ...task('001'), task_id: 'other' }]));
  const completed = f.host.listTasks().find(x => x.active);
  assert.equal(completed.status, 'completed'); assert.equal(completed.summary, 'finished');
});
test('stop timeout and RPC failure remain uncertain and are never automatically retried', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await fixture(t, () => new Promise(() => {})); await f.event(snapshot([task()]));
  const timedOut = assert.rejects(f.host.stopTask('task'), /unknown/i);
  t.mock.timers.tick(2_000); await timedOut;
  assert.equal(f.host.listTasks()[0].status, 'running'); assert.equal(f.host.listTasks()[0].stopStatus, 'unknown');
  await assert.rejects(f.host.stopTask('task'), /unknown/i); assert.deepEqual(f.stopped, ['task']);
  const bad = await fixture(t, async () => { throw new Error('synthetic disconnect'); }); await bad.event(snapshot([task()]));
  await assert.rejects(bad.host.stopTask('task'), /unknown/i);
  await assert.rejects(bad.host.stopTask('task'), /unknown/i); assert.deepEqual(bad.stopped, ['task']);
});
test('a stop for a completed task cannot invoke the SDK and does not close foreground input', async t => {
  const f = await fixture(t); await f.event(snapshot([task()]));
  await f.event({ subtype: 'task_notification', task_id: 'task', run_id: '002', status: 'completed' });
  await assert.rejects(f.host.stopTask('task'), /ended/i); assert.deepEqual(f.stopped, []);
  const turn = f.host.submit('synthetic', { id: 'next' });
  await f.event({ type: 'result', subtype: 'success', user_message_uuid: 'next' }); await turn;
  assert.equal(f.host.state, 'idle');
});
test('new SDK process instances never accept handles from the previous process', async t => {
  const first = await fixture(t); await first.event(snapshot([task()])); const old = first.host.listTasks()[0].handle;
  await first.host.close();
  const next = await fixture(t); await next.event(snapshot([task()]));
  await assert.rejects(next.host.stopTask('task', { handle: old }), /stale/i); assert.deepEqual(next.stopped, []);
});
test('malformed or excessive membership fails closed without executing task controls', async t => {
  for (const entries of [[task(), task()], Array.from({ length: 1025 }, (_, i) => ({ task_id: `task-${i}` }))]) {
    const f = await fixture(t); const failed = assert.rejects(f.host.completion, /task/i);
    f.output.push({ type: 'system', session_id: 'session', ...snapshot(entries) }); await failed;
    assert.deepEqual(f.stopped, []); assert.equal(f.host.state, 'failed');
  }
});
test('invalid task notifications cannot grow history', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 160; i++) await f.event({ subtype: 'task_notification', task_id: `invalid-${i}`, run_id: '001', status: 'not-terminal' });
  assert.equal(f.host.listTasks().length, 0);
});
test('observed-only tasks become unknown on exit', async t => {
  const f = await fixture(t);
  await f.event({ subtype: 'task_started', task_id: 'unlisted', run_id: '001', description: 'synthetic' });
  await f.host.close(); assert.equal(f.host.listTasks()[0].status, 'unknown');
});
test('throwing state observers cannot bypass explicit close or strand foreground work', async t => {
  const f = await fixture(t); await f.event(snapshot([task()]));
  let rejected = false; const pending = f.host.submit('synthetic'); pending.catch(() => { rejected = true; });
  f.host.events.on('task-state', () => { throw new Error('synthetic observer failure'); });
  await assert.doesNotReject(f.host.close()); await f.host.completion;
  assert.equal(f.closes, 1); assert.equal(rejected, true); assert.equal(f.host.listTasks()[0].status, 'unknown');
});
test('throwing state observers cannot prevent stream-failure cleanup or other observers', async t => {
  const f = await fixture(t); const entered = deferred(); let states = 0, rejected = false;
  f.host.submit('synthetic').catch(() => { rejected = true; });
  f.host.events.on('task-state', () => { entered.resolve(); throw new Error('synthetic observer failure'); });
  f.host.events.on('task-state', () => { states++; });
  const failed = assert.rejects(f.host.completion, /ended/i);
  f.output.push({ type: 'system', session_id: 'session', ...snapshot([task()]) });
  await entered.promise; f.output.end(); await failed;
  assert.equal(f.closes, 1); assert.equal(rejected, true); assert.equal(states, 2);
});
test('reentrant interrupt observes newly committed task membership and uses whole-session fallback', async t => {
  const f = await fixture(t, async () => {}, { perTaskStopAffordance: false });
  const turn = assert.rejects(f.host.submit('synthetic'), error => error.runtimeCode === 'INTERRUPTED');
  turn.catch(() => {});
  let interrupt;
  f.host.events.once('task-state', () => { interrupt = f.host.interruptTurn(); });
  await f.event(snapshot([task()])); const receipt = await interrupt;
  assert.equal(f.interrupts, 0); assert.equal(f.closes, 1); assert.deepEqual(f.stopped, ['task']);
  assert.equal(receipt.session_closed, true); await turn;
});
test('matching task_updated patch updates bounded description without changing membership', async t => {
  const f = await fixture(t); await f.event(snapshot([task()]));
  await f.event({ subtype: 'task_updated', task_id: 'task', run_id: '002', patch: { description: 'x'.repeat(2500), status: 'completed' } });
  const [state] = f.host.listTasks(); assert.equal(state.description, 'x'.repeat(2000));
  assert.equal(state.active, true); assert.equal(state.status, 'completed'); assert.equal(f.host.tasks.size, 1);
  await f.event({ subtype: 'task_updated', task_id: 'task', run_id: '001', patch: { description: 'old run' } });
  assert.equal(f.host.listTasks().find(x => x.active).description, 'x'.repeat(2000));
});
test('whole-session interrupt does not resend a previously uncertain task stop', async t => {
  const f = await fixture(t, async () => { throw new Error('synthetic lost response'); }, { perTaskStopAffordance: false });
  await f.event(snapshot([task()])); await assert.rejects(f.host.stopTask('task'), /unknown/i);
  const turn = assert.rejects(f.host.submit('synthetic'), error => error.runtimeCode === 'INTERRUPTED'); turn.catch(() => {});
  const receipt = await f.host.interruptTurn(); await turn;
  assert.deepEqual(f.stopped, ['task']); assert.equal(receipt.session_closed, true); assert.equal(f.closes, 1);
});

test('SDK status patches preserve paused and killed independently from live membership', async t => {
  const f = await fixture(t); await f.event(snapshot([task()]));
  await f.event({ subtype: 'task_updated', task_id: 'task', run_id: '002', patch: { status: 'paused' } });
  assert.equal(f.host.listTasks()[0].status, 'paused'); assert.equal(f.host.tasks.size, 1);
  await f.event({ subtype: 'task_updated', task_id: 'task', run_id: '001', patch: { status: 'running' } });
  assert.equal(f.host.listTasks().find(x => x.active).status, 'paused');
  await f.event({ subtype: 'task_updated', task_id: 'task', run_id: '002', patch: { status: 'killed' } });
  assert.equal(f.host.listTasks().find(x => x.active).status, 'killed'); assert.equal(f.host.tasks.size, 1);
  await assert.rejects(f.host.stopTask('task'), /ended/i); assert.deepEqual(f.stopped, []);
});
test('a stop request does not replace the SDK task status with a client control state', async t => {
  const reply = deferred(); const f = await fixture(t, () => reply.promise); await f.event(snapshot([task()]));
  const stopping = f.host.stopTask('task'); stopping.catch(() => {}); t.after(() => reply.resolve());
  assert.equal(f.host.listTasks()[0].status, 'running'); assert.equal(f.host.listTasks()[0].stopStatus, 'requested');
  reply.resolve(); await stopping;
  await f.event({ subtype: 'task_updated', task_id: 'task', run_id: '002', patch: { status: 'paused' } });
  assert.equal(f.host.listTasks()[0].status, 'paused'); assert.equal(f.host.listTasks()[0].stopStatus, 'requested');
});
test('closed writer retains unconfirmed SDK membership for handoff while reporting inactive unknown tasks', async t => {
  const f = await fixture(t); await f.event(snapshot([task()])); await f.host.close();
  assert.equal(f.host.tasks.size, 1); assert.equal(f.host.listTasks()[0].active, false); assert.equal(f.host.listTasks()[0].status, 'unknown');
});

test('task output is bounded and belongs to the exact registered task appearance', async t => {
  const f = await fixture(t); await f.event(snapshot([task()])); const handle=f.host.listTasks()[0].handle; const requests=[];
  f.host.query.request=async (request,options)=>{requests.push(request);assert.ok(options.signal);return {response:{output:'synthetic stdout',total_bytes:16,truncated:false}};};
  const output=await f.host.readTaskOutput('task',{handle});
  assert.deepEqual(output,{output:'synthetic stdout',totalBytes:16,truncated:false});
  assert.deepEqual(requests,[{subtype:'get_task_output',task_id:'task'}]);
  await f.event(snapshot([task('003')]));
  await assert.rejects(f.host.readTaskOutput('task',{handle}),/stale/i); assert.equal(requests.length,1);
});
test('task output returning after ID reuse is rejected rather than attributed to the replacement run', async t => {
  const f=await fixture(t);await f.event(snapshot([task()]));const handle=f.host.listTasks()[0].handle,reply=deferred(),entered=deferred();
  f.host.query.request=()=>{entered.resolve();return reply.promise;};
  const pending=f.host.readTaskOutput('task',{handle});pending.catch(()=>{});await entered.promise;
  await f.event(snapshot([task('003')]));reply.resolve({response:{output:'old output',total_bytes:10,truncated:false}});
  await assert.rejects(pending,/stale/i);
});
test('malformed or oversized task output fails closed without guessing file paths', async t => {
  const f=await fixture(t);await f.event(snapshot([task()]));const handle=f.host.listTasks()[0].handle;
  for(const body of [{output:'x',total_bytes:-1,truncated:false},{output:'x'.repeat(8193),total_bytes:8193,truncated:true},{output:'x',total_bytes:1,truncated:'yes'}]){
    f.host.query.request=async()=>({response:body});await assert.rejects(f.host.readTaskOutput('task',{handle}),/output/i);
  }
  delete f.host.query.request;await assert.rejects(f.host.readTaskOutput('task',{handle}),/unavailable/i);
});
