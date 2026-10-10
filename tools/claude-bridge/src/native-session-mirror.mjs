// Native execution uses the original local JSONL. Keep the existing durable
// append adapter, but never let SDK resume materialize its remote replica.
// This adapter is not a completeness claim, source synchronizer or write lease.
const mirrors = new WeakMap();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isNativeSessionMirror(value, sessionId = null) {
  return mirrors.has(value) && (sessionId === null || mirrors.get(value) === sessionId);
}

export function createNativeSessionMirror(store, { projectKey, sessionId }) {
  if (typeof store?.append !== 'function' || typeof projectKey !== 'string' || !projectKey.trim() || !uuid.test(sessionId ?? '')) {
    throw new Error('INVALID_NATIVE_MIRROR');
  }
  const verify = key => {
    if (key?.projectKey !== projectKey || key?.sessionId !== sessionId) {
      throw new Error('NATIVE_MIRROR_IDENTITY_MISMATCH');
    }
  };
  const mirror = Object.freeze({
    async load(key) { verify(key); return null; },
    async listSubkeys(key) { verify(key); return []; },
    async append(key, entries) { verify(key); await store.append(key, entries); },
  });
  mirrors.set(mirror, sessionId);
  return mirror;
}
