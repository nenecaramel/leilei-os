import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { normalizeAgentSdkInterruptReceipt } from './agent-sdk-interrupt.mjs';
import { ClaudeEventNormalizer } from './normalized-events.mjs';
import { createToolImageForwarder } from './tool-images.mjs';
import { AgentSdkTaskState } from './agent-sdk-task-state.mjs';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

// Persistent session host used by the Mac daemon transport.
// The caller owns SDK launch settings, auth, canonical preparations and UI capabilities.
export async function createAgentSdkSessionHost({ queryImpl, queryOptions = {}, expectedSessionId = null, beforeSubmit = null, onBackgroundResult = null, observeOutput = null } = {}) {
  if (typeof queryImpl !== 'function') throw new Error('Session host requires an injected SDK query.');
  if (queryOptions.forkSession) throw new Error('Session host cannot fork.');
  const input = createInputQueue();
  const query = queryImpl({ prompt: input, options: queryOptions });
  if (!query || typeof query[Symbol.asyncIterator] !== 'function') {
    input.end(); query?.close?.(); throw new Error('SDK query must be async iterable.');
  }
  return new SessionHost(query, input, expectedSessionId, queryOptions.perTaskStopAffordance === true, beforeSubmit, onBackgroundResult, observeOutput);
}

class SessionHost {
  constructor(query, input, expectedSessionId, perTaskStopAffordance, beforeSubmit, onBackgroundResult, observeOutput) {
    this.query = query; this.input = input; this.expectedSessionId = expectedSessionId;
    this.perTaskStopAffordance = perTaskStopAffordance;
    this.observeOutput = observeOutput;
    this.beforeSubmit = beforeSubmit; this.onBackgroundResult = onBackgroundResult;
    this.events = new EventEmitter(); this.tasks = new Map(); this.ids = new Set();
    this.taskState = new AgentSdkTaskState(() => this.publishTaskState());
    this.pending = []; this.active = null; this.state = 'starting'; this.sessionId = null;
    this.segment = newSegment();
    this.queryClosed = false;
    this.backgroundPending = false;
    this.backgroundAcknowledgement = null;
    this.backgroundGeneration = 0;
    this.completion = this.consume();
    // Consumers may attach after startup failure. Preserve rejection for awaiters.
    this.completion.catch(() => {});
  }
  // Live output is routed to a turn only after the SDK stamps that turn's input
  // UUID on a reply frame. Unstamped output stays background, never guessed.
  ownedInputId() {
    return this.segment.owner === 'turn' && this.active?.id === this.segment.ownerId ? this.active.id : null;
  }
  submit(text, { id = randomUUID(), source = 'unclassified', onNormalizedEvent = null, toolImageHandler = null } = {}) {
    if (this.state === 'closed' || this.state === 'failed') return Promise.reject(new Error('Session host is closed.'));
    if (typeof text !== 'string' || !text.trim() || typeof id !== 'string' || !id.trim()) return Promise.reject(new Error('Nonblank input/id required.'));
    if (id === ZERO_UUID) return Promise.reject(new Error('Zero input id cannot establish correlation.'));
    if (this.ids.has(id)) return Promise.reject(new Error('Duplicate session input id.'));
    if (!['human', 'task-notification', 'unclassified'].includes(source)) return Promise.reject(new Error('Invalid session input source.'));
    if ((onNormalizedEvent !== null && typeof onNormalizedEvent !== 'function') || (toolImageHandler !== null && typeof toolImageHandler !== 'function')) return Promise.reject(new Error('Invalid turn output handler.'));
    this.ids.add(id);
    const completion = new Promise((resolve, reject) => this.pending.push({ text, id, source, resolve, reject,
      onNormalizedEvent, forwardImages: createToolImageForwarder(toolImageHandler), images: new AbortController(), delivery: Promise.resolve(),
      normalizedEvents: [], rawEvents: [], stampedReply: false, commandIds: new Set([id]), remainingIds: new Set([id]), dispatched: false }));
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
      turn.dispatched = true;
      this.input.push({ type: 'user', uuid: turn.id, parent_tool_use_id: null, origin: { kind: turn.source },
        message: { role: 'user', content: [{ type: 'text', text: turn.text }] } });
    } catch (error) {
      if (this.active !== turn) return;
      this.active = null; this.state = 'idle'; turn.reject(error); void this.pump();
    }
  }
  async sendUserMessage(text, { uuid = null } = {}) {
    uuid ??= randomUUID();
    const turn = this.active;
    if (!turn?.dispatched || this.state !== 'running') throw new Error('Session turn is not accepting input.');
    if (typeof text !== 'string' || !text.trim() || typeof uuid !== 'string' || !uuid.trim() || uuid === ZERO_UUID) throw new Error('Nonblank input/id required.');
    if (this.ids.has(uuid)) throw new Error('Duplicate session input id.');
    const generation = this.backgroundGeneration;
    if (this.backgroundPending) throw new Error('Background acknowledgement is pending.');
    if (this.beforeSubmit) await this.beforeSubmit({ inputId: turn.id, providerSessionId: this.sessionId, source: turn.source });
    if (this.active !== turn || this.state !== 'running' || this.backgroundPending || generation !== this.backgroundGeneration) throw new Error('Session input ownership changed.');
    if (this.ids.has(uuid)) throw new Error('Duplicate session input id.');
    this.ids.add(uuid); turn.commandIds.add(uuid); turn.remainingIds.add(uuid);
    this.input.push({ type: 'user', uuid, parent_tool_use_id: null, origin: { kind: turn.source }, message: { role: 'user', content: [{ type: 'text', text }] } });
    const receipt = { status: 'queued', command_uuid: uuid };
    this.events.emit('mid-turn-input', receipt);
    return receipt;
  }
  async interruptTurn() {
    if (!this.active) return null;
    if (this.tasks.size && !this.perTaskStopAffordance) {
      // No task-management UI is advertised. Stop the whole owned writer
      // rather than making the user's foreground interrupt unavailable.
      const ids = [...this.tasks.keys()]; this.active.interruptRequested = true;
      let timer;
      try { await Promise.race([Promise.allSettled(ids.map(async id => { await this.stopTask(id); })), new Promise(resolve => { timer = setTimeout(resolve, 1_000); })]); }
      finally { clearTimeout(timer); }
      await this.close(Object.assign(new Error('SDK turn interrupted; session closed.'), {runtimeCode:'INTERRUPTED'}));
      const all = [...new Set([...ids, ...this.tasks.keys()])];
      return {still_queued:[],session_closed:true,background_tasks:all.map(id=>({id,status:this.tasks.has(id)?'unknown':'stopped'}))};
    }
    const turn = this.active;
    const expected = new Set([...turn.commandIds, ...this.pending.flatMap(item => [...item.commandIds])]);
    turn.interruptRequested = true;
    const receipt = normalizeAgentSdkInterruptReceipt(await this.query.interrupt());
    if (new Set(receipt.still_queued).size !== receipt.still_queued.length || receipt.still_queued.some(id => !expected.has(id))) throw new Error('Interrupt queued command identity is invalid.');
    turn.interruptReceipt = receipt;
    return receipt;
  }
  publishTaskState() {
    // Observers cannot strand a provider process or prevent another observer
    // from seeing cleanup. Give each subscriber a detached snapshot.
    for (const listener of this.events.rawListeners('task-state')) {
      try { listener.call(this.events, this.taskState.list()); } catch { /* Observability is nonfatal. */ }
    }
  }
  listTasks() { return this.taskState.list(); }
  stopTask(id, expected) {
    if (['closed', 'failed'].includes(this.state)) return Promise.reject(new Error('Session host is closed.'));
    return this.taskState.stop(id, expected, taskId => this.query.stopTask(taskId));
  }
  rejectWork(error) {
    this.active?.images.abort(); this.active?.reject(error); this.active = null;
    for (const item of this.pending.splice(0)) item.reject(error);
  }
  async route(message) {
    if (!['assistant', 'user', 'result', 'stream_event', 'system'].includes(message?.type)) return;
    // Init identifies the session; it is not a reply or a background turn.
    if (message.type === 'system' && message.subtype === 'init') return;
    const segment = this.segment;
    const stamps = message.parent_tool_use_id || message.parent_agent_id
      ? [] : [message.user_message_uuid, ...(Array.isArray(message.user_message_uuids) ? message.user_message_uuids : [])];
    // Only a top-level reply can establish ownership, not a user echo or ping.
    const isReply = message.type === 'assistant'
      || (message.type === 'stream_event' && message.event?.type !== 'ping');
    if (isReply && stamps.some(id => typeof id === 'string' && id && id !== ZERO_UUID)) {
      const turn = this.active && stamps.some(id => this.active.commandIds.has(id)) ? this.active : null;
      segment.owner = turn ? 'turn' : 'background'; segment.ownerId = turn?.id ?? null;
      if (turn) turn.stampedReply = true;
    }
    const isOwnedResult = message.type === 'result'
      && this.segment.owner === 'turn' && this.active
      && stamps.some(id => this.active.commandIds.has(id));
    const turn = isOwnedResult ? this.active
      : message.type === 'result' ? null
      : this.ownedInputId() ? this.active : null;
    const next = segment.normalizer.normalize(message);
    if (turn && !next.some(event => event.type === 'error')) {
      for (const diagnostic of await turn.forwardImages(message, turn.images.signal)) next.push(...segment.normalizer.normalize({ type: 'system', subtype: 'tool_image_delivery', ...diagnostic }));
    }
    if (turn) {
      // Keep owned output across an interleaved autonomous result boundary.
      // A foreign result must not steal it or be streamed to this turn.
      turn.normalizedEvents.push(...next);
      if (['assistant', 'user', 'result', 'stream_event'].includes(message.type)) turn.rawEvents.push(message);
      if (turn.onNormalizedEvent) for (const event of next) {
        // Best effort and ordered: a failed live delivery cannot change the durable result.
        turn.delivery = turn.delivery.then(() => turn.onNormalizedEvent(event)).catch(() => {});
      }
    } else {
      segment.background.push(...next);
      if (['assistant', 'user', 'result', 'stream_event'].includes(message.type)) segment.rawBackground.push(message);
    }
  }
  async close(reason = new Error('Session host was closed.')) {
    if (this.queryClosed) return;
    this.state = 'closed'; this.taskState.close(); this.rejectWork(reason);
    this.input.end(); await this.query.close();
    this.queryClosed = true;
  }
  async consume() {
    try {
      for await (const message of this.query) {
        if (this.state === 'closed') break;
        this.observeOutput?.(message);
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
            tasks.set(task.task_id, Object.freeze({ ...task }));
          }
          this.tasks = tasks;
        }
        // Commit both views before task-state observers can issue controls.
        this.taskState.observe(message);
        // SDK membership snapshots are authoritative. Notifications can arrive
        // out of order; never use their bookends to mutate the live task set.
        // Only the current turn owns conversation output. Idle/background events
        // remain session events; canonical backend attribution is stage-2 work.
        await this.route(message);
        if (this.state === 'closed') break;
        if (message?.type === 'result') {
          const segment = this.segment; this.segment = newSegment();
          const consumed = [message.user_message_uuid, ...(Array.isArray(message.user_message_uuids) ? message.user_message_uuids : [])].filter(id => id !== ZERO_UUID);
          if (this.active && !consumed.some(id => typeof id === 'string' && id.trim())) throw new Error('SDK input correlation is unavailable.');
          if (!this.active || !consumed.some(id => this.active.commandIds.has(id))) {
            if (this.onBackgroundResult) {
              this.backgroundGeneration++;
              this.backgroundPending = true;
              this.backgroundAcknowledgement = Promise.resolve().then(() => this.onBackgroundResult({ result: message, events: segment.rawBackground, normalizedEvents: segment.background }));
              try { await this.backgroundAcknowledgement; }
              finally { this.backgroundPending = false; this.backgroundAcknowledgement = null; }
            }
            if (this.state === 'closed') break;
            this.events.emit('background-result', { result: message, events: segment.rawBackground, normalizedEvents: segment.background });
            this.events.emit('event', message);
            void this.pump();
            continue;
          }
          const turn = this.active;
          // A result may fold several accepted commands. Resolve this logical
          // reservation only after every queued command has an authoritative result.
          const remaining = consumed.filter(id => turn.remainingIds.has(id));
          if (!remaining.length) throw new Error('Duplicate SDK command result.');
          for (const id of remaining) turn.remainingIds.delete(id);
          if (segment.owner !== 'turn') {
            turn.rawEvents.push(...segment.rawBackground);
            turn.normalizedEvents.push(...segment.background);
          }
          if (message.subtype === 'success' && !message.is_error && turn.remainingIds.size) {
            this.events.emit('event', message); continue;
          }
          this.active = null; this.state = 'idle';
          // Distinguish a logical foreground boundary from autonomous results.
          // The owner serializes its durable commit before later background frames.
          this.events.emit('turn-result', { inputId: turn.id });
          turn.images.abort();
          // Without a live stamp (older producer) the result alone proves the
          // whole frame is this turn's; it was just not streamed early.
          // Older producers may omit reply stamps. A matching result then
          // attributes the unstamped frame without streaming it early.
          const events = turn.rawEvents;
          const normalizedEvents = turn.normalizedEvents;
          await turn.delivery;
          if (message.subtype !== 'success' || message.is_error) turn.reject(Object.assign(new Error(turn.interruptRequested ? 'SDK turn interrupted.' : 'SDK turn failed.'), {
            runtimeCode: turn.interruptRequested ? 'INTERRUPTED' : 'CLAUDE_PROCESS_FAILED', ...(turn.interruptReceipt ? { interruptReceipt: turn.interruptReceipt } : {}),
          }));
          else turn.resolve({ providerSessionId: this.sessionId, inputId: turn.id, result: message, events, normalizedEvents });
          this.pump();
        }
        this.events.emit('event', message);
      }
      if (this.state !== 'closed') throw new Error('SDK session stream ended unexpectedly.');
    } catch (error) {
      if (this.state === 'closed') return;
      this.state = 'failed'; this.taskState.close(); this.rejectWork(error); this.input.end();
      try { await this.query.close(); this.queryClosed = true; } catch { /* Ownership remains held until close succeeds. */ }
      throw error;
    }
  }
}

function newSegment() {
  return { owner: null, ownerId: null, background: [], rawBackground: [],
    normalizer: new ClaudeEventNormalizer({ logicalConversationId: null, mode: 'resume' }) };
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
