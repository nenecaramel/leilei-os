// Compatibility shim for the pinned SDK 0.3.296. Its Query exposes the
// get_task_output control protocol internally, without a public convenience
// method. Keep this one subtype isolated; never accept arbitrary requests/files.
export async function readAgentSdkTaskOutput(query, taskId, callerSignal) {
  if (typeof query.request !== 'function') throw new Error('SDK task output unavailable.');
  const controller = new AbortController();
  const cancelled = () => controller.abort(callerSignal.reason);
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(new Error('SDK task output cancelled or timed out.'));
  controller.signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), 2_000);
  callerSignal?.addEventListener('abort', cancelled, { once: true });
  if (callerSignal?.aborted) cancelled();
  try {
    controller.signal.throwIfAborted();
    if (typeof query.initializationResult === 'function') await Promise.race([query.initializationResult(), aborted]);
    controller.signal.throwIfAborted();
    const result = await Promise.race([query.request({ subtype: 'get_task_output', task_id: taskId }, { signal: controller.signal }), aborted]);
    const body = result?.response;
    if (!body || typeof body.output !== 'string' || Buffer.byteLength(body.output, 'utf8') > 8192
      || !Number.isSafeInteger(body.total_bytes) || body.total_bytes < Buffer.byteLength(body.output, 'utf8')
      || typeof body.truncated !== 'boolean') throw new Error('Invalid SDK task output response.');
    return { output: body.output, totalBytes: body.total_bytes, truncated: body.truncated };
  } finally {
    clearTimeout(timer); callerSignal?.removeEventListener('abort', cancelled);
    controller.signal.removeEventListener('abort', onAbort);
    // A pre-aborted caller can throw before Promise.race attaches its observer.
    aborted.catch(() => {});
  }
}
