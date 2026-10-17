import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { access, link, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { durableCheckpointPrefix } from './provider-checkpoint-prefix.mjs';
import { readOnlyFileSnapshot } from './read-only-file-snapshot.mjs';
import { isDeepStrictEqual } from 'node:util';
import { readNativeSession } from './native-session-catalog.mjs';
import { readNativeHistorySources, scanNativeSessionIndex } from './native-session-source-files.mjs';
// Planning is offline and must read every Rewind copy that carries a needed
// record (each a full ~12 MB transcript), so it takes a larger explicit bound.
const OFFLINE_SOURCE_LIMITS = { maxSourceFiles: 4096, maxSourceBytes: 2 * 1024 * 1024 * 1024 };
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
  isOpen = async () => false, now = Date.now(), recentMs = 5 * 60 * 1000, historyMode = 'complete' }) {
  if (!['complete', 'continuation'].includes(historyMode)) throw fail('ARCHIVE_INVALID_MODE');
  if (historyMode === 'continuation') return planContinuationArchive({ projectDirectory, windows, referenced, isOpen, now, recentMs });
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
      sources = await readNativeHistorySources(projectDirectory, id, root, { index, allow, ...OFFLINE_SOURCE_LIMITS });
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
        for (const source of full.error === 'NO_CHECKPOINT' ? [] : (await readNativeHistorySources(projectDirectory, id, await snapshot(id), { index, ...OFFLINE_SOURCE_LIMITS })).map(s => s.sessionId)) {
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


// Continuation resumes the physical chain in the kept JSONL, including its
// compact summary. logicalParentUuid is a display-history link, not an SDK
// execution dependency. Keep entire files; never prune records inside them.
async function planContinuationArchive({ projectDirectory, windows, referenced, isOpen, now, recentMs }) {
  const files = (await readdir(projectDirectory, { withFileTypes:true }))
    .filter(f=>f.isFile() && sessionPattern.test(f.name.slice(0,-6)) && f.name.endsWith('.jsonl'))
    .sort((a,b)=>a.name.localeCompare(b.name));
  if(files.length>4096)throw fail('NATIVE_SOURCE_SCAN_LIMIT');
  const keep=new Map(), sizes=new Map(), digests={}, verified=[], historySources=new Set();
  const add=(id,reason)=>keep.set(id,[...(keep.get(id)??[]),reason]);
  let scanned=0;
  for(const file of files){
    const id=file.name.slice(0,-6), absolute=path.join(projectDirectory,file.name);
    const info=await stat(absolute);scanned+=info.size;
    if(scanned>4*1024*1024*1024)throw fail('NATIVE_SOURCE_SCAN_LIMIT');
    sizes.set(id,info.size);
    try { digests[file.name]=(await readOnlyFileSnapshot(absolute,64*1024*1024)).revision; }
    catch { add(id,'unreadable'); }
    if(windows.has(id))add(id,'window');
    // The existing server reference set is intentionally conservative: it also
    // protects older checkpoints that legacy conversations may still edit.
    if(referenced.has(id))add(id,'referenced');
    if(now-info.mtimeMs<recentMs)add(id,'recent');
    if(await isOpen(id))add(id,'open');
  }
  let uncertain=null;
  for(const id of keep.keys()){
    try{
      const root=await readNativeSession(projectDirectory,id);
      if(root.revision!==digests[`${id}.jsonl`])throw fail('ARCHIVE_PLAN_CHANGED');
      const carriers=root.entries.filter(e=>!e.isSidechain && ['user','assistant','system','attachment'].includes(e.type) && typeof e.uuid==='string' && Object.hasOwn(e,'parentUuid'));
      const byId=new Map();
      for(const e of carriers){
        const prior=byId.get(e.uuid);
        if(prior&&!isDeepStrictEqual([prior.type,prior.parentUuid,prior.message,prior.attachment],[e.type,e.parentUuid,e.message,e.attachment]))throw fail('CONFLICTING_NATIVE_UUID');
        byId.set(e.uuid,e);
        if(sessionPattern.test(e.forkedFrom?.sessionId??''))historySources.add(e.forkedFrom.sessionId);
      }
      const tail=carriers.at(-1);if(!tail)throw fail('NO_CHECKPOINT');
      const current=durableCheckpointPrefix(root.entries,tail.uuid);
      // Forked transcripts can still point at an older Session's tool-output
      // files. Preserve that whole companion bundle; display-only ancestry is
      // the dependency we remove, not file references in the native context.
      const execution=JSON.stringify(current.prefix);
      for(const file of files){
        const source=file.name.slice(0,-6);
        if(source!==id && execution.includes(path.join(projectDirectory,source)+path.sep)
          && !keep.get(source)?.includes(`native_files:${id}`))add(source,`native_files:${id}`);
      }
      const checkpoint=windows.get(id);
      if(checkpoint&&!current.ancestry.has(checkpoint))throw fail('EXPLICIT_BRANCH_SELECTION_REQUIRED');
      verified.push({sessionId:id,readable:true,executionIdentical:true,checkpointId:tail.uuid,revision:root.revision});
    }catch(error){
      uncertain=id;verified.push({sessionId:id,readable:false,reason:error.code??error.runtimeCode??'INVALID_NATIVE_EXECUTION'});
    }
  }
  // A broken/unknown kept root cannot prove its native dependencies. Preserve
  // this whole project rather than guessing which old file might repair it.
  if(uncertain)for(const file of files)add(file.name.slice(0,-6),`unverified_execution:${uncertain}`);
  const archive=files.map(f=>f.name.slice(0,-6)).filter(id=>!keep.has(id));
  const bytes=ids=>ids.reduce((n,id)=>n+sizes.get(id),0);
  return {projectDirectory,historyMode:'continuation',keep:[...keep].sort(([a],[b])=>a.localeCompare(b)).map(([sessionId,reasons])=>({sessionId,reasons})),archive,
    archiveDetails:archive.map(sessionId=>({sessionId,reasons:[historySources.has(sessionId)?'history_only_source':'unreferenced_session']})),
    bytes:{keep:bytes([...keep.keys()]),archive:bytes(archive)},verified,digests};
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
    else if (info.isFile() && info.nlink === 1) digests[relative] = (await readOnlyFileSnapshot(absolute, Math.max(1, info.size))).revision;
    else throw fail('ARCHIVE_UNSAFE_MEMBER');
  };
  for (const member of members) await walk(member);
  return digests;
}

const exists = file => access(file).then(() => true, () => false);

/**
 * Archive the planned sessions (and their same-named subfolders), verify every
 * file byte-for-byte from the archive, write a manifest, then remove originals.
 * Before retirement, changed plans leave originals in place. After an atomic
 * retirement move, failure retains the original in a private recovery directory
 * and restores missing paths without overwriting any concurrently created file.
 */
export async function applyNativeTranscriptArchive({ projectDirectory, sessionIds, archiveDirectory, label,
  zstd = '/opt/homebrew/bin/zstd', expectedDigests = {}, verifyPlan = async () => {},
  assertStagedFilesClosed = assertNoStagedWriter, verifyReferences = async () => {} }) {
  if (!sessionIds.length) return null;
  if (!sessionIds.every(id => sessionPattern.test(id)) || !/^[a-z0-9-]+$/.test(label)) throw fail('ARCHIVE_INVALID_INPUT');
  const members = [];
  for (const id of sessionIds) {
    members.push(`${id}.jsonl`);
    if (await exists(path.join(projectDirectory, id))) members.push(id);
  }
  await verifyPlan();
  const before = await fileDigests(projectDirectory, members);
  for (const id of sessionIds) if (expectedDigests[`${id}.jsonl`] && before[`${id}.jsonl`] !== expectedDigests[`${id}.jsonl`]) throw fail('ARCHIVE_PLAN_CHANGED');
  await mkdir(archiveDirectory, { recursive: true, mode: 0o700 });
  const useZstd = await exists(zstd);
  const archiveFile = path.join(archiveDirectory, `${label}.tar.${useZstd ? 'zst' : 'xz'}`);
  if (await exists(archiveFile)) throw fail('ARCHIVE_EXISTS');
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
  await verifyPlan();
  if (!isDeepStrictEqual(await fileDigests(projectDirectory, members), before)) throw fail('ARCHIVE_PLAN_CHANGED');
  const manifest = { createdAt: new Date().toISOString(), projectDirectory, archiveFile, sessionIds,
    files: Object.entries(before).map(([file, digest]) => ({ file, sha256: digest })),
    restore: `cd '${projectDirectory}' && ${useZstd ? `zstd -dc --long=31 '${archiveFile}' | tar xf - <id>.jsonl <id>` : `tar -xJf '${archiveFile}' <id>.jsonl <id>`}` };
  await writeFile(`${archiveFile}.manifest.json`, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  // Never unlink an original pathname after observing it: it may now name a
  // different file. Atomic rename captures the actual inode in a private path;
  // existing writers retain their descriptors and can be detected there. A
  // later reopen of the old name creates a new file that we never remove.
  const stagingDirectory = await mkdtemp(path.join(projectDirectory, '.archive-recovery-'));
  const moved = [];
  try {
    for (const member of members) {
      await rename(path.join(projectDirectory, member), path.join(stagingDirectory, member));
      moved.push(member);
    }
    await verifyReferences();
    await assertStagedFilesClosed(stagingDirectory);
    if (!isDeepStrictEqual(await fileDigests(stagingDirectory, members), before)
      || (await Promise.all(members.map(member => exists(path.join(projectDirectory, member))))).some(Boolean)) {
      throw fail('ARCHIVE_PLAN_CHANGED');
    }
    // No old-path writer can acquire this unadvertised inode after the move.
    // Open file or directory descriptors fail closed in assertStagedFilesClosed.
    await rm(stagingDirectory, { recursive: true });
  } catch (error) {
    // Restore only missing names using exclusive hard links. In particular a
    // newly created native transcript is never overwritten by a rollback.
    for (const member of moved) {
      try { await restoreMissingMember(path.join(stagingDirectory, member), path.join(projectDirectory, member)); }
      catch { /* The private original remains recoverable even if restore fails. */ }
    }
    await writeFile(`${archiveDirectory}/${label}.recovery.json`, JSON.stringify({
      createdAt:new Date().toISOString(), projectDirectory, stagingDirectory, archiveFile, members:moved,
      reason:error.code ?? 'ARCHIVE_RETIREMENT_FAILED',
      instructions:'Stop all clients before recovery. Preserve both original-path files and this recovery directory; never overwrite a newer transcript.'
    }, null, 2), { mode:0o600 });
    throw error.code ? error : fail('ARCHIVE_RETIREMENT_FAILED');
  }
  return { archiveFile, members: members.length, files: manifest.files.length };
}


function assertNoStagedWriter(directory) {
  try {
    execFileSync(process.platform === 'darwin' ? '/usr/sbin/lsof' : 'lsof', ['-t', '+D', directory], {
      encoding:'utf8', stdio:['ignore','pipe','pipe'], timeout:10_000, maxBuffer:1024*1024,
    });
  } catch(error) {
    // lsof: exit 1 and completely empty output means no open descriptors.
    // Permissions, warnings, an unavailable executable or a timeout are unknown.
    const output=String(error.stdout??'').trim();
    // macOS can report matching PIDs with exit 1. Positive evidence of an
    // open descriptor is authoritative regardless of that exit status.
    if (/^[0-9]+(?:\s+[0-9]+)*$/.test(output)) throw fail('ARCHIVE_SOURCE_OPEN');
    if(error.status===1 && !output && !String(error.stderr??'').trim()) return;
    throw fail('ARCHIVE_SOURCE_STATE_UNAVAILABLE');
  }
  throw fail('ARCHIVE_SOURCE_OPEN');
}

async function restoreMissingMember(from, to) {
  const info=await lstat(from);
  if(info.isFile()) {
    try { await link(from,to); } catch(error) { if(error.code!=='EEXIST')throw error; }
  } else if(info.isDirectory()) {
    try { await mkdir(to,{mode:0o700}); } catch(error) { if(error.code==='EEXIST')return;throw error; }
    for(const name of await readdir(from))await restoreMissingMember(path.join(from,name),path.join(to,name));
  }
}
