import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { normalizeAgentSdkInterruptReceipt } from './agent-sdk-interrupt.mjs';

// Stage-1 host prototype. Deliberately not wired into the Mac transport/daemon.
// The caller owns SDK launch settings, auth, canonical preparations and UI capabilities.
export async function createAgentSdkSessionHost({ queryImpl, queryOptions = {}, expectedSessionId = null } = {}) {
  if (typeof queryImpl !== 'function') throw new Error('Session host requires an injected SDK query.');
  if (queryOptions.forkSession) throw new Error('Session host cannot fork.');
  const input = createInputQueue();
  const query = queryImpl({ prompt: input, options: queryOptions });
  if (!query || typeof query[Symbol.asyncIterator] !== 'function') {
    input.end(); query?.close?.(); throw new Error('SDK query must be async iterable.');
  }
  return new SessionHost(query, input, expectedSessionId, queryOptions.perTaskStopAffordance === true);
}

class SessionHost {
  constructor(query, input, expectedSessionId, perTaskStopAffordance) {
    this.query = query; this.input = input; this.expectedSessionId = expectedSessionId;
    this.perTaskStopAffordance = perTaskStopAffordance;
    this.events = new EventEmitter(); this.tasks = new Map(); this.ids = new Set();
    this.pending = []; this.active = null; this.state = 'starting'; this.sessionId = null;
    this.turnEvents = [];
    this.completion = this.consume();
    // Consumers may attach after startup failure. Preserve rejection for awaiters.
    this.completion.catch(() => {});
  }
  submit(text, { id = randomUUID() } = {}) {
    if (this.state === 'closed' || this.state === 'failed') return Promise.reject(new Error('Session host is closed.'));
    if (typeof text !== 'string' || !text.trim() || typeof id !== 'string' || !id.trim()) return Promise.reject(new Error('Nonblank input/id required.'));
    if (this.ids.has(id)) return Promise.reject(new Error('Duplicate session input id.'));
    this.ids.add(id);
    const completion = new Promise((resolve, reject) => this.pending.push({ text, id, resolve, reject, events: [] }));
    this.pump(); return completion;
  }
  pump() {
    if (this.active || !this.pending.length || ['closed', 'failed'].includes(this.state)) return;
    this.active = this.pending.shift(); this.state = 'running';
    this.input.push({ type: 'user', uuid: this.active.id, parent_tool_use_id: null,
      message: { role: 'user', content: [{ type: 'text', text: this.active.text }] } });
  }
  async interruptTurn() {
    if (!this.active) return null;
    if (this.tasks.size && !this.perTaskStopAffordance) throw new Error('Per-task stop capability is required before preserving background tasks.');
    return normalizeAgentSdkInterruptReceipt(await this.query.interrupt());
  }
  async stopTask(id) {
    if (['closed', 'failed'].includes(this.state)) throw new Error('Session host is closed.');
    if (!this.tasks.has(id)) throw new Error('Unknown session task.');
    await this.query.stopTask(id);
    // The authoritative SDK task snapshot, not this response, owns membership.
  }
  rejectWork(error) {
    this.active?.reject(error); this.active = null;
    for (const item of this.pending.splice(0)) item.reject(error);
  }
  async close() {
    if (['closed', 'failed'].includes(this.state)) return;
    this.state = 'closed'; this.rejectWork(new Error('Session host was closed.'));
    this.input.end(); await this.query.close();
  }
  async consume() {
    try {
      for await (const message of this.query) {
        if (this.state === 'closed') break;
        const sid = message?.session_id;
        if (sid && ((this.sessionId && sid !== this.sessionId) || (this.expectedSessionId && sid !== this.expectedSessionId))) throw new Error('SDK session identity changed.');
        if (message?.type === 'system' && message.subtype === 'init') {
          if (!sid) throw new Error('SDK session init has no identity.');
          this.sessionId = sid; this.state = this.active ? 'running' : 'idle'; this.pump();
        }
        if (!this.sessionId && ['assistant', 'user', 'result'].includes(message?.type)) throw new Error('SDK output arrived before session init.');
        if (message?.type === 'system' && message.subtype === 'background_tasks_changed') {
          if (!Array.isArray(message.tasks)) throw new Error('Invalid SDK task snapshot.');
          const tasks = new Map();
          for (const task of message.tasks) {
            if (typeof task?.task_id !== 'string' || !task.task_id || tasks.has(task.task_id)) throw new Error('Invalid SDK task identity.');
            tasks.set(task.task_id, task);
          }
          this.tasks = tasks;
        }
        // SDK membership snapshots are authoritative. Notifications can arrive
        // out of order; never use their bookends to mutate the live task set.
        // Only the current turn owns conversation output. Idle/background events
        // remain session events; canonical backend attribution is stage-2 work.
        if (['assistant', 'user', 'result', 'stream_event'].includes(message?.type)) this.turnEvents.push(message);
        if (message?.type === 'result') {
          const frame = this.turnEvents; this.turnEvents = [];
          const consumed = [message.user_message_uuid, ...(Array.isArray(message.user_message_uuids) ? message.user_message_uuids : [])];
          if (!this.active || !consumed.includes(this.active.id)) {
            this.events.emit('background-result', { result: message, events: frame });
            this.events.emit('event', message);
            continue;
          }
          const turn = this.active; this.active = null; this.state = 'idle';
          if (message.subtype !== 'success' || message.is_error) turn.reject(new Error('SDK turn failed.'));
          else turn.resolve({ providerSessionId: this.sessionId, inputId: turn.id, result: message, events: frame });
          this.pump();
        }
        this.events.emit('event', message);
      }
      if (this.state !== 'closed') throw new Error('SDK session stream ended unexpectedly.');
    } catch (error) {
      if (this.state === 'closed') return;
      this.state = 'failed'; this.rejectWork(error); this.input.end();
      try { await this.query.close(); } catch { /* Preserve the original failure. */ }
      throw error;
    }
  }
}

function createInputQueue() {
  const items = []; let waiter = null, ended = false;
  return {
    push(value) {
      if (ended) throw new Error('Session input is closed.');
      if (waiter) { const resolve = waiter; waiter = null; resolve({ value, done: false }); }
      else items.push(value);
    },
    end() { ended = true; items.length = 0; if (waiter) { waiter({ done: true }); waiter = null; } },
    [Symbol.asyncIterator]() { return { next() {
      if (items.length) return Promise.resolve({ value: items.shift(), done: false });
      if (ended) return Promise.resolve({ done: true });
      return new Promise(resolve => { waiter = resolve; });
    } }; },
  };
}
