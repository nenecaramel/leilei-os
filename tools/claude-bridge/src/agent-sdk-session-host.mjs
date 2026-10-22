import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { normalizeAgentSdkInterruptReceipt } from './agent-sdk-interrupt.mjs';
import { ClaudeEventNormalizer } from './normalized-events.mjs';
import { createToolImageForwarder } from './tool-images.mjs';
import { AgentSdkTaskState } from './agent-sdk-task-state.mjs';
import { readAgentSdkTaskOutput } from './agent-sdk-task-output.mjs';
import { isNativeLoopInput } from './agent-sdk-scheduled-input.mjs';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

// Persistent session host used by the Mac daemon transport.
// The caller owns SDK launch settings, auth, canonical preparations and UI capabilities.
export async function createAgentSdkSessionHost({ queryImpl, queryOptions = {}, expectedSessionId = null, beforeSubmit = null, onBackgroundResult = null, createBackgroundOutput = null, observeOutput = null, onCloseDiagnostic = null } = {}) {
  if (typeof queryImpl !== 'function') throw new Error('Session host requires an injected SDK query.');
  // A live writer never forks: Edit/Retry rewind their own session in place.
  if (queryOptions.forkSession) throw new Error('Session host cannot fork.');
  const input = createInputQueue();
  const query = queryImpl({ prompt: input, options: queryOptions });
  if (!query || typeof query[Symbol.asyncIterator] !== 'function') {
    input.end(); query?.close?.(); throw new Error('SDK query must be async iterable.');
  }
  return new SessionHost(query, input, expectedSessionId, queryOptions.perTaskStopAffordance === true, beforeSubmit, onBackgroundResult, createBackgroundOutput, observeOutput, onCloseDiagnostic);
}

class SessionHost {
  constructor(query, input, expectedSessionId, perTaskStopAffordance, beforeSubmit, onBackgroundResult, createBackgroundOutput, observeOutput, onCloseDiagnostic) {
    this.query = query; this.input = input; this.expectedSessionId = expectedSessionId;
    this.perTaskStopAffordance = perTaskStopAffordance;
    this.observeOutput = observeOutput; this.onCloseDiagnostic = onCloseDiagnostic; this.closeDiagnostic = null;
    this.beforeSubmit = beforeSubmit; this.onBackgroundResult = onBackgroundResult;
    this.createBackgroundOutput = createBackgroundOutput; this.backgroundOutputs = new Set();
    this.events = new EventEmitter(); this.ids = new Set(); this.startedCommands = new Set();
    this.currentCommandUuid = null;
    this.taskState = new AgentSdkTaskState(() => this.publishTaskState());
    this.pending = []; this.active = null; this.finishing = null; this.state = 'starting'; this.sessionId = null;
    this.segment = newSegment();
    this.queryClosed = false;
    this.backgroundWork = new Set();
    this.backgroundGeneration = 0;
    this.failure = null;
    this.completion = this.consume();
    // Consumers may attach after startup failure. Preserve rejection for awaiters.
    this.completion.catch(() => {});
  }
  get backgroundPending() { return this.backgroundWork.size > 0; }
  get backgroundAcknowledgement() { return this.backgroundWork.size ? Promise.all([...this.backgroundWork]) : null; }
  background(frame, message) {
    if (!this.onBackgroundResult) {
      this.events.emit('background-result', frame); this.events.emit('event', message); void this.pump(); return;
    }
    // Keep observing SDK task state while the caller serializes durable commits.
    // Bound unacknowledged frames rather than buffering without limit.
    if (this.backgroundWork.size >= 8) throw new Error('Background acknowledgement backlog exceeded.');
    this.backgroundGeneration++;
    let resolve, reject;
    const work = new Promise((yes, no) => { resolve = yes; reject = no; });
    this.backgroundWork.add(work);
    // Invoke now: the router must register its commit before a later foreground
    // result. Deferring this invocation can invert acknowledgement order.
    try { Promise.resolve(this.onBackgroundResult(frame)).then(resolve, reject); }
    catch (error) { reject(error); }
    void work.then(() => {
      this.backgroundWork.delete(work);
      if (['closed', 'failed'].includes(this.state)) return;
      this.events.emit('background-result', frame); this.events.emit('event', message); void this.pump();
    }, async error => { this.backgroundWork.delete(work); await this.fail(error, "BACKGROUND_ACK_FAILED"); }).catch(error => this.fail(error, "BACKGROUND_ACK_FAILED"));
  }
  async fail(error, reasonCode = "SDK_FAILURE") {
    if (['closed', 'failed'].includes(this.state)) return;
    this.observeClose('requested', reasonCode);
    this.failure = error; this.state = 'failed'; this.taskState.close(); this.rejectWork(error); this.input.end();
    try { await this.query.close(); this.queryClosed = true; this.observeClose('completed'); } catch { this.observeClose('failed'); /* Failed close remains owned. */ }
  }
  // Live output is routed to a turn only after the SDK stamps that turn's input
  // UUID on a reply frame. Unstamped output stays background, never guessed.
  ownedInputId() {
    return this.segment.owner === 'turn' && this.active?.id === this.segment.ownerId ? this.active.id : null;
  }
  // SDK tool callbacks may run before the first stamped assistant frame.
  // A native command_lifecycle.started UUID identifies that exact foreground
  // input without attributing unstamped text or background output to it.
  // Do not use this early owner for event streaming or canonical commits.
  fileToolOwnerInputId() {
    const turn = this.active;
    if (!turn?.dispatched || this.state !== 'running') return null;
    if (this.currentCommandUuid && !turn.commandIds.has(this.currentCommandUuid)) return null;
    if (this.segment.owner === 'turn' && this.segment.ownerId === turn.id) return turn.id;
    if (this.segment.owner !== null || !this.currentCommandUuid) return null;
    return turn.commandIds.has(this.currentCommandUuid) ? turn.id : null;
  }
  // A background capability belongs to one exact SDK segment and native
  // command. An unstamped frame or queued foreground never supplies its owner.
  backgroundOutputOwner() {
    if (!this.createBackgroundOutput || ['closed', 'failed'].includes(this.state)) return null;
    const segment = this.segment;
    const commandUuid = this.currentCommandUuid ?? segment.commandUuid;
    if (!commandUuid || this.active?.commandIds.has(commandUuid)) return null;
    if (segment.commandUuid && segment.commandUuid !== commandUuid) return null;
    if (!this.startedCommands.has(commandUuid) && segment.commandUuid !== commandUuid) return null;
    if (segment.output) return segment.output.commandUuid === commandUuid && !segment.output.sealed ? segment.output : null;
    const owner = Object.freeze({ segmentId: segment.id, commandUuid });
    const collector = this.createBackgroundOutput(owner);
    if (!collector) return null;
    const output = { ...owner, collector, segment, images: new AbortController(), pending: new Set(), accepting: true, sealed: false,
      forwardImages: createToolImageForwarder(collector.toolImageHandler ? (image, context) => this.runBackgroundOutput(output,
        () => collector.toolImageHandler(image, context)) : null) };
    segment.output = output; this.backgroundOutputs.add(output);
    return output;
  }
  assertBackgroundOutput(output) {
    if (['closed', 'failed'].includes(this.state) || output.images.signal.aborted || output.sealed
      || this.segment !== output.segment || this.backgroundOutputOwner() !== output) throw new Error('Background output owner changed or closed.');
  }
  runBackgroundOutput(output, send) {
    if (!output.accepting) throw new Error("Background output owner is sealing.");
    this.assertBackgroundOutput(output);
    const work = (async () => { const value = await send(); this.assertBackgroundOutput(output); return value; })();
    output.pending.add(work);
    // Keep a rejection handled even if the SDK abandons its tool callback.
    work.then(() => output.pending.delete(work), () => output.pending.delete(work));
    return work;
  }
  async sealBackgroundOutput(segment, message) {
    const output = segment.output;
    if (!output) return {};
    const stamps = [message.user_message_uuid, ...(Array.isArray(message.user_message_uuids) ? message.user_message_uuids : [])];
    if (!stamps.includes(output.commandUuid) || stamps.some(id => this.active?.commandIds.has(id))) {
      throw new Error('Background result does not exclusively own its uploaded attachments.');
    }
    output.accepting = false;
    await Promise.all([...output.pending]);
    this.assertBackgroundOutput(output);
    const receipt = await output.collector.seal();
    this.assertBackgroundOutput(output);
    output.sealed = true; this.backgroundOutputs.delete(output);
    return { segmentId: output.segmentId, commandUuid: output.commandUuid,
      outputAttachmentIds: [...receipt.outputAttachmentIds],
      ...(receipt.outputAttachmentMetadata ? { outputAttachmentMetadata: [...receipt.outputAttachmentMetadata] } : {}) };
  }
  submit(text, { id = randomUUID(), source = 'unclassified', onNormalizedEvent = null, toolImageHandler = null } = {}) {
    if (this.state === 'closed' || this.state === 'failed') return Promise.reject(new Error('Session host is closed.'));
    if (typeof text !== 'string' || !text.trim() || typeof id !== 'string' || !id.trim()) return Promise.reject(new Error('Nonblank input/id required.'));
    if (id === ZERO_UUID) return Promise.reject(new Error('Zero input id cannot establish correlation.'));
    if (this.ids.has(id)) return Promise.reject(new Error('Duplicate session input id.'));
    if (!['human', 'task-notification', 'unclassified'].includes(source)) return Promise.reject(new Error('Invalid session input source.'));
    if ((onNormalizedEvent !== null && typeof onNormalizedEvent !== 'function') || (toolImageHandler !== null && typeof toolImageHandler !== 'function')) return Promise.reject(new Error('Invalid turn output handler.'));
    this.ids.add(id);
    let cancelDelivery;
    const cancelled = new Promise(resolve => { cancelDelivery = resolve; });
    const completion = new Promise((resolve, reject) => this.pending.push({ text, id, source, resolve, reject,
      cancelled, cancelDelivery, onNormalizedEvent, forwardImages: createToolImageForwarder(toolImageHandler), images: new AbortController(), delivery: Promise.resolve(),
      normalizedEvents: [], rawEvents: [], promptHooks: [text], stampedReply: false, commandIds: new Set([id]), remainingIds: new Set([id]), dispatched: false }));
    this.pump(); return completion;
  }
  async pump() {
    if (this.backgroundPending || this.active || this.finishing || !this.pending.length || ['closed', 'failed'].includes(this.state)) return;
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
        ...(!isNativeLoopInput(turn.text, turn.source) ? { client_composed: true } : {}),
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
    turn.promptHooks.push(text);
    this.input.push({ type: 'user', uuid, parent_tool_use_id: null, origin: { kind: turn.source }, client_composed: true, message: { role: 'user', content: [{ type: 'text', text }] } });
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
      await this.close(Object.assign(new Error('SDK turn interrupted; session closed.'), {runtimeCode:'INTERRUPTED',sessionCloseReason:'INTERRUPT_WITH_BACKGROUND_TASKS'}));
      const all = [...new Set([...ids, ...this.tasks.keys()])];
      return {still_queued:[],session_closed:true,background_tasks:all.map(id=>({id,status:this.tasks.has(id)?'unknown':'stopped'}))};
    }
    const turn = this.active;
    const expected = new Set([...turn.commandIds, ...this.pending.flatMap(item => [...item.commandIds])]);
    turn.interruptRequested = true;
    const receipt = normalizeAgentSdkInterruptReceipt(await this.query.interrupt());
    if (new Set(receipt.still_queued).size !== receipt.still_queued.length) throw new Error('Interrupt queued command identity is invalid.');
    // The SDK also reports internally enqueued cron/auto-resume commands. They
    // are not this client's queued user input and must never be attributed to it.
    receipt.still_queued = receipt.still_queued.filter(id => expected.has(id));
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
  get tasks() { return this.taskState.members(); }
  listTasks() { return this.taskState.list(); }
  stopTask(id, expected) {
    if (['closed', 'failed'].includes(this.state)) return Promise.reject(new Error('Session host is closed.'));
    return this.taskState.stop(id, expected, taskId => this.query.stopTask(taskId));
  }
  async readTaskOutput(id, { handle, signal } = {}) {
    if (['closed', 'failed'].includes(this.state)) throw new Error('Session host is closed.');
    const record = this.taskState.capture(id, handle);
    const result = await readAgentSdkTaskOutput(this.query, id, signal);
    if (this.taskState.capture(id, handle) !== record) throw new Error('Stale task output.');
    return result;
  }
  rejectWork(error) {
    for (const output of this.backgroundOutputs) { output.images.abort(); output.collector.abort(); }
    this.backgroundOutputs.clear();
    for (const turn of [this.active, this.finishing]) {
      turn?.images.abort(); turn?.cancelDelivery(); turn?.reject(error);
    }
    this.active = null; this.finishing = null;
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
      if (!turn) {
        const commandUuid = stamps.find(id => typeof id === 'string' && id && id !== ZERO_UUID);
        if (segment.output && segment.output.commandUuid !== commandUuid) throw new Error('Background output command changed before its result.');
        segment.commandUuid = commandUuid; this.currentCommandUuid = commandUuid;
      }
      if (turn) {
        turn.stampedReply = true;
        this.currentCommandUuid = stamps.find(id => turn.commandIds.has(id)) ?? this.currentCommandUuid;
      }
    }
    const isOwnedResult = message.type === 'result'
      && this.segment.owner === 'turn' && this.active
      && stamps.some(id => this.active.commandIds.has(id));
    const turn = isOwnedResult ? this.active
      : message.type === 'result' ? null
      : this.ownedInputId() && (!this.currentCommandUuid || this.active.commandIds.has(this.currentCommandUuid)) ? this.active : null;
    const next = segment.normalizer.normalize(message);
    if (turn && !next.some(event => event.type === 'error')) {
      for (const diagnostic of await turn.forwardImages(message, turn.images.signal)) next.push(...segment.normalizer.normalize({ type: 'system', subtype: 'tool_image_delivery', ...diagnostic }));
    }
    if (!turn && message.type === 'user' && message.isSidechain !== true
      && Array.isArray(message.message?.content)
      && message.message.content.some(block => block?.type === 'tool_result' && Array.isArray(block.content) && block.content.some(value => value?.type === 'image'))
      && !next.some(event => event.type === 'error')) {
      const output = this.backgroundOutputOwner();
      if (output) for (const diagnostic of await output.forwardImages(message, output.images.signal)) {
        next.push(...segment.normalizer.normalize({ type: 'system', subtype: 'tool_image_delivery', ...diagnostic }));
      }
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
  // Capture BEFORE rejectWork clears active/finishing. Keep the first cause when
  // catch cleanup or a failed query.close retries the same owned writer.
  observeClose(phase, reasonCode = null) {
    if (!this.closeDiagnostic) this.closeDiagnostic = Object.freeze({
      closeId: randomUUID(), reasonCode, state: this.state, providerSessionId: this.sessionId,
      inputId: (this.active ?? this.finishing)?.id ?? null,
      resultReceived: this.finishing !== null, pendingInputs: this.pending.length,
      backgroundTasks: this.tasks.size,
    });
    else if (phase === 'requested') return;
    try {
      const emitted = this.onCloseDiagnostic?.(Object.freeze({ ...this.closeDiagnostic, phase }));
      emitted?.catch?.(() => {});
    } catch { /* Diagnostics cannot change session close or its rejection. */ }
  }
  async close(reason = new Error('Session host was closed.')) {
    if (this.queryClosed) return;
    const code = typeof reason?.sessionCloseReason === 'string' && /^[A-Z_]{1,64}$/.test(reason.sessionCloseReason)
      ? reason.sessionCloseReason : 'EXPLICIT_CLOSE';
    this.observeClose('requested', code);
    this.state = 'closed'; this.taskState.close(); this.rejectWork(reason);
    this.input.end();
    try { await this.query.close(); this.queryClosed = true; this.observeClose('completed'); }
    catch (error) { this.observeClose('failed'); throw error; }
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
        this.taskState.observe(message);
        // Native CLI 2.1.206+ emits command_lifecycle.started with the exact
        // uuid of the input actually selected to run. This is the sole
        // correlation authority for autonomous input: never match text,
        // prompt_id, an arbitrary active turn or provider output timestamps.
        if (message?.type === 'command_lifecycle'
          && message.state === 'started'
          && typeof message.command_uuid === 'string'
          && message.command_uuid.trim()
          && message.command_uuid !== ZERO_UUID
          && !this.startedCommands.has(message.command_uuid)) {
          this.startedCommands.add(message.command_uuid);
          this.currentCommandUuid = message.command_uuid;
          this.events.emit('command-started', Object.freeze({
            inputId: message.command_uuid,
            source: this.active?.dispatched && this.active.commandIds.has(message.command_uuid)
              ? 'foreground' : 'autonomous',
          }));
        }
        // SDK membership snapshots are authoritative. Notifications can arrive
        // out of order; never use their bookends to mutate the live task set.
        // Only the current turn owns conversation output. Idle/background events
        // remain session events and use the independent durable background sink.
        await this.route(message);
        if (this.state === 'closed') break;
        if (message?.type === 'result') {
          const segment = this.segment;
          const outputReceipt = await this.sealBackgroundOutput(segment, message);
          this.currentCommandUuid = null; this.segment = newSegment();
          const consumed = [message.user_message_uuid, ...(Array.isArray(message.user_message_uuids) ? message.user_message_uuids : [])].filter(id => id !== ZERO_UUID);
          if (this.active && !consumed.some(id => typeof id === 'string' && id.trim())) throw new Error('SDK input correlation is unavailable.');
          if (!this.active || !consumed.some(id => this.active.commandIds.has(id))) {
            this.background({ result: message, events: segment.rawBackground, normalizedEvents: segment.background, ...outputReceipt }, message);
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
          // Retain cancellation ownership and input ordering until delivery ends.
          this.finishing = turn; this.active = null; this.state = 'idle';
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
          await Promise.race([turn.delivery, turn.cancelled]);
          if (this.state === 'closed') break;
          if (this.state === 'failed') throw this.failure;
          this.finishing = null;
          if (message.subtype !== 'success' || message.is_error) turn.reject(Object.assign(new Error(turn.interruptRequested ? 'SDK turn interrupted.' : 'SDK turn failed.'), {
            runtimeCode: turn.interruptRequested ? 'INTERRUPTED' : 'CLAUDE_PROCESS_FAILED', ...(turn.interruptReceipt ? { interruptReceipt: turn.interruptReceipt } : {}),
          }));
          else turn.resolve({ providerSessionId: this.sessionId, inputId: turn.id, result: message, events, normalizedEvents });
          this.pump();
        }
        this.events.emit('event', message);
      }
      if (this.state !== 'closed') throw this.failure ?? new Error('SDK session stream ended unexpectedly.');
    } catch (error) {
      if (this.state === 'closed') return;
      await this.fail(error);
      throw this.failure ?? error;
    }
  }
}

function newSegment() {
  return { id: randomUUID(), commandUuid: null, output: null, owner: null, ownerId: null, background: [], rawBackground: [],
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
