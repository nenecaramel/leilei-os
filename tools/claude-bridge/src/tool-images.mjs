import { createHash } from 'node:crypto';

// Consume actual tool-result image blocks only. Never interpret text, URLs or paths.
export function createToolImageForwarder(handler) {
  const seen = new Set();
  let attempts = 0;
  let uploadTimeMs = 0;
  return async (message, signal) => {
    const diagnostics = [];
    if (!handler || message?.type !== 'user' || message.isSidechain === true || signal.aborted) return diagnostics;
    const blocks = message.message?.content;
    if (!Array.isArray(blocks)) return diagnostics;
    for (const block of blocks) {
      if (block?.type !== 'tool_result' || typeof block.tool_use_id !== 'string' || !block.tool_use_id || !Array.isArray(block.content)) continue;
      for (const image of block.content) {
        if (image?.type !== 'image' || signal.aborted) continue;
        const source = image.source ?? image;
        if (image.source && source.type !== 'base64') continue;
        const data = source.data, mimeType = source.media_type ?? source.mimeType;
        if (typeof data !== 'string' || !data || data.length > 28 * 1024 * 1024 || typeof mimeType !== 'string') continue;
        const key = block.tool_use_id + ':' + createHash('sha256').update(mimeType).update(data).digest('hex');
        if (seen.has(key)) continue;
        if (attempts >= 8 || uploadTimeMs >= 15_000) return diagnostics;
        seen.add(key); attempts++;
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal.addEventListener('abort', abort, { once: true });
        const startedAt = Date.now();
        const timer = setTimeout(abort, 15_000 - uploadTimeMs);
        let rejectAbort;
        const aborted = new Promise((_, reject) => { rejectAbort = () => reject(new Error('cancelled')); controller.signal.addEventListener('abort', rejectAbort, { once: true }); });
        try {
          await Promise.race([handler({ data, mimeType }, { signal: controller.signal }), aborted]);
        } catch {
          diagnostics.push({ tool_use_id: block.tool_use_id, code: 'TOOL_IMAGE_UNAVAILABLE' });
        } finally {
          clearTimeout(timer);
          uploadTimeMs += Math.max(0, Date.now() - startedAt);
          signal.removeEventListener('abort', abort);
          controller.signal.removeEventListener('abort', rejectAbort);
        }
      }
    }
    return diagnostics;
  };
}
