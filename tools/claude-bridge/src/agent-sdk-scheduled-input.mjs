// The CLI owns scheduling, persistence, CronList/CronDelete and missed-fire policy.
// This guard owns only admission into this live writer, never a second timer queue.
export function createScheduledInputGuard({ getHost, admit, now = () => Date.now() }) {
  const createdAt = now();
  const seen = new Set();
  let stampedProducer = false;
  let lastAttemptAt = null;
  const block = () => ({ decision: 'block', reason: 'LeileiOS scheduled input rejected.',
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', suppressOriginalPrompt: true } });
  const hook = async input => {
    const host = getHost();
    const consumeForeground = () => {
      const turn = host?.active;
      if (!turn?.dispatched || typeof input?.session_id !== 'string' || !input.session_id
        || (host.sessionId && input.session_id !== host.sessionId) || input.agent_id) return false;
      const index = turn.promptHooks.indexOf(input.prompt);
      if (index < 0) return false;
      turn.promptHooks.splice(index, 1);
      return true;
    };
    if (['user', 'sdk'].includes(input?.source)) {
      // Stamped expansion may change the text; consume its oldest input ticket.
      const matched = consumeForeground();
      if (!matched && host?.active?.dispatched && !input.agent_id) host.active.promptHooks.shift();
      if (host?.active?.dispatched && !input.agent_id) stampedProducer = true;
      return {};
    }
    // Task notifications and poll events retain their existing lifecycle. This
    // guard does not turn every autonomous event into a scheduled invocation.
    if (['system', 'poll_event'].includes(input?.source)) return {};
    // Older CLIs omit source. Keep one exact literal hook per admitted input,
    // but do not enable new native schedules on that unsupported producer.
    if (input?.source === undefined && consumeForeground()) return {};
    if (!host || host.queryClosed || ['closed', 'failed'].includes(host.state)
      || input?.session_id !== host.sessionId || input.agent_id) return block();
    // Never infer a trigger from prompt text or admit an unclassified producer.
    if (!['loop_wakeup', 'schedule_wakeup'].includes(input.source)) return block();
    const id = input.prompt_id;
    const at = now();
    if (host.backgroundPending || typeof id !== 'string' || !id.trim() || id.length > 512
      || seen.has(id) || seen.size >= 64 || at < createdAt || at - createdAt >= 7 * 24 * 60 * 60 * 1_000
      || (lastAttemptAt !== null && at - lastAttemptAt < 60_000)) return block();
    // Reserve synchronously. Duplicate/concurrent callbacks cannot borrow an
    // in-flight authorization, and an uncertain admission is never retried.
    seen.add(id); lastAttemptAt = at;
    const generation = host.backgroundGeneration;
    const abort = new AbortController();
    let timer;
    try {
      await Promise.race([(async () => {
        // SDK control callbacks can overtake delivery of the preceding result
        // to this iterator. Wait for that exact boundary, never a later input.
        if (host.active) await precedingBoundary(host, abort.signal);
        if (abort.signal.aborted || host.active) throw new Error('Foreground input owns the writer.');
        await admit();
      })(), new Promise((_, reject) => {
        timer = setTimeout(() => { abort.abort(); reject(new Error('Scheduled admission timed out.')); }, 2_000);
      })]);
      if (getHost() !== host || host.queryClosed || ['closed', 'failed'].includes(host.state)
        || host.active || host.backgroundPending || host.backgroundGeneration !== generation) return block();
      stampedProducer = true;
      return {};
    } catch { return block(); }
    finally { clearTimeout(timer); abort.abort(); }
  };
  hook.allowsTool = (name, input) => stampedProducer || !['CronCreate', 'ScheduleWakeup'].includes(name)
    || (name === 'ScheduleWakeup' && input?.stop === true);
  return hook;
}

function precedingBoundary(host, signal) {
  const inputId = host.active.id;
  return new Promise((resolve, reject) => {
    const cleanup = () => { host.events.off('turn-result', finished); signal.removeEventListener('abort', cancelled); };
    const finished = frame => { if (frame.inputId !== inputId) return; cleanup(); resolve(); };
    const cancelled = () => { cleanup(); reject(new Error('Scheduled boundary deadline expired.')); };
    host.events.on('turn-result', finished); signal.addEventListener('abort', cancelled, { once: true });
    if (signal.aborted) cancelled();
  });
}

export function isNativeLoopInput(text, source) {
  return source === 'human' && /^\/loop(?:\s|$)/u.test(text);
}
