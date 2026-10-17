// The CLI owns scheduling, persistence, CronList/CronDelete and missed-fire policy.
// This guard owns only admission into this live writer, never a second timer queue.
export function createScheduledInputGuard({ getHost, admit, now = () => Date.now() }) {
  const createdAt = now();
  const seen = new Set();
  let lastAttemptAt = null;
  let autonomousAttempts = 0;
  let admissionPending = false;
  const block = code => ({ decision: 'block', reason: `LeileiOS scheduled input rejected. [${code}]`,
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
      return {};
    }
    // Task notifications and poll events retain their existing lifecycle. This
    // guard does not turn every autonomous event into a scheduled invocation.
    if (['system', 'poll_event'].includes(input?.source)) return {};
    // source is optional. Keep one exact literal hook per admitted input.
    if (input?.source === undefined && consumeForeground()) return {};
    if (!host || host.queryClosed || ['closed', 'failed'].includes(host.state)
      || input?.session_id !== host.sessionId || input.agent_id) return block('SESSION_UNAVAILABLE_OR_FOREIGN');
    // source is optional independently of prompt_id (generic correlation).
    // Do not mistake its absence for a native timer or inspect prompt text.
    const unclassified = input.source === undefined;
    if (!unclassified && !['loop_wakeup', 'schedule_wakeup'].includes(input.source)) return block('UNSUPPORTED_SOURCE');
    const id = input.prompt_id;
    const at = now();
    if (host.backgroundPending) return block('BACKGROUND_COMMIT_PENDING');
    if (admissionPending) return block('ADMISSION_PENDING');
    if (autonomousAttempts >= 64) return block('ATTEMPT_BUDGET');
    if (at < createdAt || at - createdAt >= 7 * 24 * 60 * 60 * 1_000) return block('WRITER_LIFETIME');
    if (!unclassified && (typeof id !== 'string' || !id.trim() || id.length > 512
      || seen.has(id) || (lastAttemptAt !== null && at - lastAttemptAt < 60_000))) return block('TIMER_ID_OR_CADENCE');
    // Reserve before awaiting admission. Unknown-source notifications may burst,
    // but share the finite attempt/lifetime budget and cannot overlap admission.
    autonomousAttempts++; admissionPending = true;
    if (!unclassified) { seen.add(id); lastAttemptAt = at; }
    const generation = host.backgroundGeneration;
    const foreground = host.active;
    const abort = new AbortController();
    let timer;
    try {
      await Promise.race([(async () => {
        // Native Cron/Loop may fire while F is still running. A one-shot
        // callback cannot wait for F and then retry after a 2s hook deadline:
        // that discards the only fire. Ask the Mac router for fresh committed
        // source/lease/generation admission even while F owns its input. The
        // SDK's own command UUID and the durable B=>F cover still fence output.
        await admit();
      })(), new Promise((_, reject) => {
        timer = setTimeout(() => { abort.abort(); reject(new Error('Scheduled admission timed out.')); }, 2_000);
      })]);
      if (getHost() !== host || host.queryClosed || ['closed', 'failed'].includes(host.state)
        || (host.active !== foreground && host.active !== null)
        || host.backgroundPending || host.backgroundGeneration !== generation) return block('STALE_ADMISSION');
      return {};
    } catch { return block(abort.signal.aborted ? 'ADMISSION_TIMEOUT' : 'ADMISSION_DENIED'); }
    finally { clearTimeout(timer); abort.abort(); admissionPending = false; }
  };
  return hook;
}

export function isNativeLoopInput(text, source) {
  return source === 'human' && /^\/loop(?:\s|$)/u.test(text);
}
