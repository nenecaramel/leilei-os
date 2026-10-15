import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { normalizeAgentSdkInterruptReceipt } from './agent-sdk-interrupt.mjs';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

// Session host used by the explicit transport API; not enabled by the daemon.
// The caller owns SDK launch settings, auth, canonical preparations and UI capabilities.
export async function createAgentSdkSessionHost({ queryImpl, queryOptions = {}, expectedSessionId = null, beforeSubmit = null, onBackgroundResult = null } = {}) {
  if (typeof queryImpl !== 'function') throw new Error('Session host requires an injected SDK query.');
  if (queryOptions.forkSession) throw new Error('Session host cannot fork.');
  const input = createInputQueue();
  const query = queryImpl({ prompt: input, options: queryOptions });
  if (!query || typeof query[Symbol.asyncIterator] !== 'function') {
    input.end(); query?.close?.(); throw new Error('SDK query must be async iterable.');
  }
  return new SessionHost(query, input, expectedSessionId, queryOptions.perTaskStopAffordance === true, beforeSubmit, onBackgroundResult);
}

class SessionHost {
  constructor(query, input, expectedSessionId, perTaskStopAffordance, beforeSubmit, onBackgroundResult) {
    this.query = query; this.input = input; this.expectedSessionId = expectedSessionId;
    this.perTaskStopAffordance = perTaskStopAffordance;
    this.beforeSubmit = beforeSubmit; this.onBackgroundResult = onBackgroundResult;
    this.events = new EventEmitter(); this.tasks = new Map(); this.ids = new Set();
    this.pending = []; this.active = null; this.state = 'starting'; this.sessionId = null;
    this.turnEvents = [];
    this.queryClosed = false;
    this.backgroundPending = false;
    this.backgroundAcknowledgement = null;
    this.backgroundGeneration = 0;
    this.completion = this.consume();
    // Consumers may attach after startup failure. Preserve rejection for awaiters.
    this.completion.catch(() => {});
  }
  submit(text, { id = randomUUID(), source = 'unclassified' } = {}) {
    if (this.state === 'closed' || this.state === 'failed') return Promise.reject(new Error('Session host is closed.'));
    if (typeof text !== 'string' || !text.trim() || typeof id !== 'string' || !id.trim()) return Promise.reject(new Error('Nonblank input/id required.'));
    if (id === ZERO_UUID) return Promise.reject(new Error('Zero input id cannot establish correlation.'));
    if (this.ids.has(id)) return Promise.reject(new Error('Duplicate session input id.'));
    if (!['human', 'task-notification', 'unclassified'].includes(source)) return Promise.reject(new Error('Invalid session input source.'));
    this.ids.add(id);
    const completion = new Promise((resolve, reject) => this.pending.push({ text, id, source, resolve, reject }));
    this.pump(); return completion;
  }
  async pump() {
    if (this.backgroundPending || this.active || !this.pending.length || ['closed', 'failed'].includes(this.state)) return;
    this.active = this.pending.shift(); this.state = 'running';
    const turn = this.active;
    try {
      // A background result may arrive while admission awaits canonical state.
      // Await its durable acknowledgement, then revalidate before dispatch.
      let generation;
      do {
        if (this.backgroundAcknowledgement) await this.backgroundAcknowledgement;
        if (this.active !== turn || ['closed', 'failed'].includes(this.state)) return;
        generation = this.backgroundGeneration;
        if (this.beforeSubmit) await this.beforeSubmit({ inputId: turn.id, providerSessionId: this.sessionId, source: turn.source });
      } while (this.backgroundPending || generation !== this.backgroundGeneration);
      if (this.active !== turn || ['closed', 'failed'].includes(this.state)) return;
      this.input.push({ type: 'user', uuid: turn.id, parent_tool_use_id: null, origin: { kind: turn.source },
        message: { role: 'user', content: [{ type: 'text', text: turn.text }] } });
    } catch (error) {
      if (this.active !== turn) return;
      this.active = null; this.state = 'idle'; turn.reject(error); void this.pump();
    }
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
    if (this.queryClosed) return;
    this.state = 'closed'; this.rejectWork(new Error('Session host was closed.'));
    this.input.end(); await this.query.close();
    this.queryClosed = true;
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
          const consumed = [message.user_message_uuid, ...(Array.isArray(message.user_message_uuids) ? message.user_message_uuids : [])].filter(id => id !== ZERO_UUID);
          if (this.active && !consumed.some(id => typeof id === 'string' && id.trim())) throw new Error('SDK input correlation is unavailable.');
          if (!this.active || !consumed.includes(this.active.id)) {
            if (this.onBackgroundResult) {
              this.backgroundGeneration++;
              this.backgroundPending = true;
              this.backgroundAcknowledgement = Promise.resolve().then(() => this.onBackgroundResult({ result: message, events: frame }));
              try { await this.backgroundAcknowledgement; }
              finally { this.backgroundPending = false; this.backgroundAcknowledgement = null; }
            }
            if (this.state === 'closed') break;
            this.events.emit('background-result', { result: message, events: frame });
            this.events.emit('event', message);
            void this.pump();
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
      try { await this.query.close(); this.queryClosed = true; } catch { /* Ownership remains held until close succeeds. */ }
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
