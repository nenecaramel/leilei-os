import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { readNativeSession } from './native-session-catalog.mjs';
const fail = code => Object.assign(new Error(code), { code });
const MAX_SCANNED_FILES = 4096, MAX_SCANNED_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_SOURCE_FILES = 256, MAX_SOURCE_BYTES = 256 * 1024 * 1024;
const uuidKey = /"uuid"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/gi;

// Records a compacted transcript points at in its sources: the boundary's
// logical parent and the original of the retained copy.
function crossFileReferences(snapshot) {
  const byId = new Map(snapshot.entries.filter(e => typeof e?.uuid === 'string').map(e => [e.uuid, e]));
  const refs = new Set();
  for (const e of snapshot.entries) {
    if (e?.type !== 'system' || e.subtype !== 'compact_boundary' || e.isSidechain || typeof e.logicalParentUuid !== 'string') continue;
    refs.add(e.logicalParentUuid.toLowerCase());
    const original = byId.get(e.logicalParentUuid)?.forkedFrom?.messageUuid;
    if (typeof original === 'string') refs.add(original.toLowerCase());
  }
  return refs;
}

// Same project only, bounded, no symlink/archive traversal or native writes.
// History only crosses files at compact boundaries, and only into transcripts
// holding the referenced record, so parse exactly those (and theirs, in turn).
// Every transcript carrying a needed record is offered, as when all were read,
// so conflicting copies are still detected. Unrelated Rewind copies are only
// scanned as text and never count toward the source limits.
export async function readNativeHistorySources(projectDirectory, sessionId, root) {
  const files = (await readdir(projectDirectory, { withFileTypes: true })).filter(e =>
    e.isFile() && /^[a-f0-9-]{36}\.jsonl$/i.test(e.name) && e.name !== `${sessionId}.jsonl`).sort((a, b) => a.name.localeCompare(b.name));
  if (files.length > MAX_SCANNED_FILES) throw fail('NATIVE_SOURCE_SCAN_LIMIT');
  let scanned = 0;
  const index = new Map();
  for (const file of files) {
    scanned += (await stat(path.join(projectDirectory, file.name))).size;
    if (scanned > MAX_SCANNED_BYTES) throw fail('NATIVE_SOURCE_SCAN_LIMIT');
    const text = await readFile(path.join(projectDirectory, file.name), 'utf8');
    index.set(file.name.slice(0, -6), new Set(Array.from(text.matchAll(uuidKey), match => match[1].toLowerCase())));
  }
  const selected = new Map();
  let bytes = 0;
  const pending = [root ?? await readNativeSession(projectDirectory, sessionId)];
  while (pending.length) {
    for (const ref of crossFileReferences(pending.pop())) {
      for (const [id, uuids] of index) {
        if (selected.has(id) || !uuids.has(ref)) continue;
        bytes += (await stat(path.join(projectDirectory, `${id}.jsonl`))).size;
        if (selected.size >= MAX_SOURCE_FILES || bytes > MAX_SOURCE_BYTES) throw fail('NATIVE_SOURCE_SCAN_LIMIT');
        const source = await readNativeSession(projectDirectory, id);
        selected.set(id, source);
        pending.push(source);
      }
    }
  }
  return [...selected.values()].sort((a, b) => a.sessionId.localeCompare(b.sessionId));
}

export async function verifyNativeHistorySources(projectDirectory, sources) {
  for (const source of sources) {
    if ((await readNativeSession(projectDirectory, source.sessionId)).revision !== source.revision) throw fail('NATIVE_INSPECTION_CHANGED');
  }
}
