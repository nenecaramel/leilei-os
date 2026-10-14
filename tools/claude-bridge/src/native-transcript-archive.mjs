import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readNativeSession } from './native-session-catalog.mjs';
import { readNativeHistorySources, scanNativeSessionIndex } from './native-session-source-files.mjs';
import { nativeDisplayChain, projectNativeHistory } from './native-session-history.mjs';
const fail = code => Object.assign(new Error(code), { code });
const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const lastAssistant = snapshot => snapshot.entries.filter(e => !e.isSidechain).findLast(e => e.type === 'assistant' && typeof e.uuid === 'string')?.uuid ?? null;

/**
 * Decide which transcripts in one project folder can be archived. Read-only.
 * Kept: every Desktop window's current session, every session LeileiOS still
 * references, anything open or touched within `recentMs`, and whatever those
 * need to rebuild their full history. Each kept session's history must read
 * identically from the kept files alone, or nothing is archived.
 */
export async function planNativeTranscriptArchive({ projectDirectory, windows = new Map(), referenced = new Set(),
  isOpen = async () => false, now = Date.now(), recentMs = 24 * 60 * 60 * 1000 }) {
  const index = await scanNativeSessionIndex(projectDirectory);
  const ids = [...index.keys()];
  const sizes = new Map(), reasons = new Map();
  const keep = new Set();
  const add = (id, reason) => { keep.add(id); reasons.set(id, [...(reasons.get(id) ?? []), reason]); };
  for (const id of ids) {
    const info = await stat(path.join(projectDirectory, `${id}.jsonl`));
    sizes.set(id, info.size);
    if (windows.has(id)) add(id, 'window');
    if (referenced.has(id)) add(id, 'referenced');
    if (now - info.mtimeMs < recentMs) add(id, 'recent');
    if (await isOpen(id)) add(id, 'open');
  }
  const snapshots = new Map();
  const snapshot = async id => snapshots.get(id) ?? snapshots.set(id, await readNativeSession(projectDirectory, id)).get(id);
  const project = async (id, allow) => {
    const root = await snapshot(id);
    const checkpoint = windows.get(id) ?? lastAssistant(root);
    if (!checkpoint) return { error: 'NO_CHECKPOINT' };
    let sources = [];
    try { nativeDisplayChain(root, checkpoint); }
    catch (error) {
      if (!['COMPACT_SOURCE_HISTORY_REQUIRED', 'NATIVE_HISTORY_GAP'].includes(error.code)) return { error: error.code ?? 'UNKNOWN' };
      sources = await readNativeHistorySources(projectDirectory, id, root, { index, allow });
    }
    try {
      const options = { sourceSnapshots: sources };
      const chain = nativeDisplayChain(root, checkpoint, options);
      const projection = projectNativeHistory(root, checkpoint, options);
      return { chain: chain.map(e => e.uuid), messages: projection.messages.length,
        hash: sha256(JSON.stringify([chain.map(e => e.uuid), projection.messages])), sources: sources.map(s => s.sessionId) };
    } catch (error) { return { error: error.code ?? 'UNKNOWN' }; }
  };
  const targets = new Map();
  for (let round = 0, changed = true; changed && round < 16; round++) {
    changed = false;
    for (const id of [...keep]) {
      const full = targets.get(id)?.full ?? await project(id);
      const kept = await project(id, keep);
      targets.set(id, { full, kept });
      if (full.error) {
        // Cannot read it (e.g. a turn in progress): keep every possible source.
        for (const source of full.error === 'NO_CHECKPOINT' ? [] : (await readNativeHistorySources(projectDirectory, id, await snapshot(id), { index })).map(s => s.sessionId)) {
          if (!keep.has(source)) { add(source, `source-of-unreadable:${id}`); changed = true; }
        }
        continue;
      }
      if (!kept.error && kept.hash === full.hash) continue;
      // Re-add sources (greedy set cover) for records the kept files lack.
      const covered = new Set([id, ...keep].flatMap(k => [...(index.get(k) ?? [])]));
      let missing = new Set(full.chain.filter(uuid => uuid && !covered.has(uuid.toLowerCase())).map(uuid => uuid.toLowerCase()));
      if (!missing.size) for (const source of full.sources) if (!keep.has(source)) { add(source, `source:${id}`); changed = true; }
      while (missing.size) {
        let best = null, bestCount = 0;
        for (const candidate of ids) {
          if (keep.has(candidate)) continue;
          let count = 0;
          for (const uuid of missing) if (index.get(candidate).has(uuid)) count++;
          if (count > bestCount) { best = candidate; bestCount = count; }
        }
        if (!best) throw fail('ARCHIVE_PLAN_UNRESOLVED');
        add(best, `source:${id}`); changed = true;
        missing = new Set([...missing].filter(uuid => !index.get(best).has(uuid)));
      }
    }
  }
  // Final proof: every kept history reads identically from the kept files alone.
  const verified = [];
  for (const id of keep) {
    const { full } = targets.get(id) ?? { full: await project(id) };
    if (full.error) { verified.push({ sessionId: id, readable: false, reason: full.error }); continue; }
    const kept = await project(id, keep);
    if (kept.error || kept.hash !== full.hash) throw fail('ARCHIVE_PLAN_UNVERIFIED');
    verified.push({ sessionId: id, readable: true, messages: full.messages, identical: true });
  }
  const archive = ids.filter(id => !keep.has(id)).sort();
  const total = list => list.reduce((sum, id) => sum + sizes.get(id), 0);
  return { projectDirectory, keep: [...keep].sort().map(id => ({ sessionId: id, reasons: reasons.get(id) })), archive,
    bytes: { keep: total([...keep]), archive: total(archive) }, verified };
}

function run(command, args, { input, output, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: [input ? 'pipe' : 'ignore', output ? 'pipe' : 'ignore', 'ignore'] });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(fail('ARCHIVE_COMMAND_FAILED')));
    if (input) input.pipe(child.stdin);
    if (output) child.stdout.pipe(output);
  });
}

async function fileDigests(root, members) {
  const digests = {};
  const walk = async relative => {
    const absolute = path.join(root, relative);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) throw fail('ARCHIVE_UNSAFE_MEMBER');
    if (info.isDirectory()) for (const name of (await readdir(absolute)).sort()) await walk(path.join(relative, name));
    else digests[relative] = sha256(await readFile(absolute));
  };
  for (const member of members) await walk(member);
  return digests;
}

const exists = file => access(file).then(() => true, () => false);

/**
 * Archive the planned sessions (and their same-named subfolders), verify every
 * file byte-for-byte from the archive, write a manifest, then remove originals.
 * Any failure leaves the originals in place.
 */
export async function applyNativeTranscriptArchive({ projectDirectory, sessionIds, archiveDirectory, label,
  zstd = '/opt/homebrew/bin/zstd' }) {
  if (!sessionIds.length) return null;
  if (!sessionIds.every(id => sessionPattern.test(id)) || !/^[a-z0-9-]+$/.test(label)) throw fail('ARCHIVE_INVALID_INPUT');
  const members = [];
  for (const id of sessionIds) {
    members.push(`${id}.jsonl`);
    if (await exists(path.join(projectDirectory, id))) members.push(id);
  }
  await mkdir(archiveDirectory, { recursive: true, mode: 0o700 });
  const useZstd = await exists(zstd);
  const archiveFile = path.join(archiveDirectory, `${label}.tar.${useZstd ? 'zst' : 'xz'}`);
  if (await exists(archiveFile)) throw fail('ARCHIVE_EXISTS');
  const before = await fileDigests(projectDirectory, members);
  const { createWriteStream } = await import('node:fs');
  if (useZstd) {
    const tar = spawn('tar', ['-cf', '-', '-C', projectDirectory, '--', ...members], { stdio: ['ignore', 'pipe', 'ignore'] });
    const tarDone = new Promise((resolve, reject) => tar.on('close', code => code === 0 ? resolve() : reject(fail('ARCHIVE_COMMAND_FAILED'))));
    const out = createWriteStream(archiveFile, { mode: 0o600 });
    await Promise.all([tarDone, run(zstd, ['-q', '-19', '--long=31', '-T0', '-c'], { input: tar.stdout, output: out })]);
    await new Promise(resolve => out.end(resolve));
  } else {
    await run('tar', ['-cJf', archiveFile, '-C', projectDirectory, '--', ...members]);
  }
  const verifyDirectory = await mkdtemp(path.join(archiveDirectory, '.verify-'));
  try {
    if (useZstd) {
      const unzstd = spawn(zstd, ['-dc', '--long=31', archiveFile], { stdio: ['ignore', 'pipe', 'ignore'] });
      await Promise.all([new Promise((resolve, reject) => unzstd.on('close', code => code === 0 ? resolve() : reject(fail('ARCHIVE_VERIFY_FAILED')))),
        run('tar', ['-xf', '-', '-C', verifyDirectory], { input: unzstd.stdout })]);
    } else await run('tar', ['-xJf', archiveFile, '-C', verifyDirectory]);
    const after = await fileDigests(verifyDirectory, members);
    if (JSON.stringify(after) !== JSON.stringify(before)) throw fail('ARCHIVE_VERIFY_FAILED');
  } catch (error) {
    await rm(archiveFile, { force: true });
    throw error.code ? error : fail('ARCHIVE_VERIFY_FAILED');
  } finally { await rm(verifyDirectory, { recursive: true, force: true }); }
  const manifest = { createdAt: new Date().toISOString(), projectDirectory, archiveFile, sessionIds,
    files: Object.entries(before).map(([file, digest]) => ({ file, sha256: digest })),
    restore: `cd '${projectDirectory}' && ${useZstd ? `zstd -dc --long=31 '${archiveFile}' | tar xf - <id>.jsonl <id>` : `tar -xJf '${archiveFile}' <id>.jsonl <id>`}` };
  await writeFile(`${archiveFile}.manifest.json`, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  for (const member of members) await rm(path.join(projectDirectory, member), { recursive: true, force: true });
  return { archiveFile, members: members.length, files: manifest.files.length };
}
