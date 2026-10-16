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
    if (!body || typeof body.output !== 'string' || body.output.length > 8198
      || !Number.isSafeInteger(body.total_bytes) || body.total_bytes < 0
      || typeof body.truncated !== 'boolean') throw new Error('Invalid SDK task output response.');
    const bytes = Buffer.from(body.output, 'utf8');
    // An 8 KiB byte tail can start with up to three orphan continuation bytes.
    // UTF-8 decoding may expand these into replacement characters (+6 bytes).
    // Accept only that bounded, explicitly truncated case, then return <=8 KiB
    // on a complete character boundary. This does not enlarge the read window.
    const decodedBoundary = body.truncated && body.total_bytes > 8192
      && bytes.length <= 8198 && body.output.startsWith('\uFFFD');
    if ((bytes.length > 8192 && !decodedBoundary)
      || (bytes.length <= 8192 && body.total_bytes < bytes.length)) throw new Error('Invalid SDK task output response.');
    let start = Math.max(0, bytes.length - 8192);
    while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
    return { output: bytes.subarray(start).toString('utf8'), totalBytes: body.total_bytes, truncated: body.truncated };
  } finally {
    clearTimeout(timer); callerSignal?.removeEventListener('abort', cancelled);
    controller.signal.removeEventListener('abort', onAbort);
    // A pre-aborted caller can throw before Promise.race attaches its observer.
    aborted.catch(() => {});
  }
}
