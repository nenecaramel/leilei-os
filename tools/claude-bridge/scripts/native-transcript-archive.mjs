import path from 'node:path';
import { homedir } from 'node:os';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { planNativeTranscriptArchive, applyNativeTranscriptArchive } from '../src/native-transcript-archive.mjs';
import { assertNativeHandoffRecoveryClear } from '../src/native-session-switch-restore.mjs';
import { readNativeSessionRelease } from '../src/native-session-activity.mjs';

// Plans (default) or applies (--apply) archival of redundant native transcripts
// in every project folder that holds a Desktop window. Prints ids, counts and
// sizes only. LeileiOS's referenced sessions come from the authenticated relay;
// without them nothing is planned. Daily continuation needs physical native
// execution chains, not pre-compact display-history reconstruction.
const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = code => Object.assign(new Error(code), { code });

async function referencedSessions({ relayUrl, relayToken, fetchImpl = fetch }) {
  let url;
  try { url = new URL('internal/native-live-session-store/native-history/referenced-sessions', relayUrl); }
  catch { throw fail('ARCHIVE_REFERENCES_UNAVAILABLE'); }
  try {
    const response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + relayToken }, body: '{}' });
    const value = await response.json();
    if (!response.ok || value?.success !== true || !Array.isArray(value.data?.sessionIds) || !value.data.sessionIds.every(id => sessionPattern.test(id))) throw new Error();
    return new Set(value.data.sessionIds);
  } catch { throw fail('ARCHIVE_REFERENCES_UNAVAILABLE'); }
}

async function desktopEntries(directory, allowMissing = false) {
  try { return await readdir(directory, { withFileTypes:true }); }
  catch(error) {
    if(allowMissing && error.code==='ENOENT')return [];
    throw fail('ARCHIVE_DESKTOP_INDEX_UNREADABLE');
  }
}

async function desktopWindows(desktopSessionsDirectory) {
  const windows = [];
  const accounts = await desktopEntries(desktopSessionsDirectory, true);
  for (const account of accounts) {
    if (!account.isDirectory()) continue;
    for (const org of await desktopEntries(path.join(desktopSessionsDirectory, account.name))) {
      if (!org.isDirectory()) continue;
      const folder = path.join(desktopSessionsDirectory, account.name, org.name);
      for (const name of await readdir(folder)) {
        if (!/^local_[0-9a-f-]{36}\.json$/i.test(name)) continue;
        try {
          const index = JSON.parse(await readFile(path.join(folder, name), 'utf8'));
          if (!sessionPattern.test(index.cliSessionId ?? '')) throw fail('ARCHIVE_DESKTOP_INDEX_UNREADABLE');
          windows.push({ sessionId: index.cliSessionId, checkpoint: sessionPattern.test(index.lastAssistantUuid ?? '') ? index.lastAssistantUuid : null });
        } catch { throw fail('ARCHIVE_DESKTOP_INDEX_UNREADABLE'); }
      }
    }
  }
  return windows;
}

export async function runNativeTranscriptArchive({ apply = false, relayUrl, relayToken, fetchImpl,
  configDirectory = path.resolve(process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude')),
  desktopSessionsDirectory = path.join(homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions'),
  archiveDirectory = path.join(homedir(), '.leileios', 'archive'), recoveryDirectory=path.join(homedir(),'.leileios'), now = Date.now() } = {}) {
  await assertNativeHandoffRecoveryClear(recoveryDirectory);
  const referenced = await referencedSessions({ relayUrl, relayToken, fetchImpl });
  const windows = await desktopWindows(desktopSessionsDirectory);
  const projectsDirectory = path.join(configDirectory, 'projects');
  const peerDirectory = path.join(configDirectory, 'sessions');
  const folders = new Set();
  for (const project of await readdir(projectsDirectory, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const names = new Set(await readdir(path.join(projectsDirectory, project.name)));
    if (windows.some(w => names.has(`${w.sessionId}.jsonl`)) || [...referenced].some(id=>names.has(`${id}.jsonl`))) folders.add(path.join(projectsDirectory, project.name));
  }
  // Open unless a release is positively observed (no live process holds it).
  const isOpen = async id => (await readNativeSessionRelease(peerDirectory, id)).state !== 'not_open_observed';
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-').toLowerCase();
  const results = [];
  for (const projectDirectory of [...folders].sort()) {
    const plan = await planNativeTranscriptArchive({ projectDirectory, now, isOpen, referenced,
      windows: new Map(windows.map(w => [w.sessionId, w.checkpoint])), historyMode:'continuation' });
    const label = `${path.basename(projectDirectory).replace(/[^a-z0-9-]/gi, '').toLowerCase()}-${stamp}`;
    const applied = apply && plan.archive.length
      ? await applyNativeTranscriptArchive({ projectDirectory, sessionIds: plan.archive, archiveDirectory, label, expectedDigests:plan.digests,
          verifyReferences:async()=>{
            await assertNativeHandoffRecoveryClear(recoveryDirectory);
            const refs=await referencedSessions({relayUrl,relayToken,fetchImpl});
            const currentWindows=await desktopWindows(desktopSessionsDirectory);
            for(const id of plan.archive)if(refs.has(id)||currentWindows.some(w=>w.sessionId===id)||await isOpen(id))throw fail('ARCHIVE_PLAN_CHANGED');
          },
          verifyPlan:async()=>{
            await assertNativeHandoffRecoveryClear(recoveryDirectory);
            const currentReferences=await referencedSessions({relayUrl,relayToken,fetchImpl});
            const currentWindows=await desktopWindows(desktopSessionsDirectory);
            const current=await planNativeTranscriptArchive({projectDirectory,now:Date.now(),isOpen,referenced:currentReferences,
              windows:new Map(currentWindows.map(w=>[w.sessionId,w.checkpoint])),historyMode:'continuation'});
            if(plan.archive.some(id=>!current.archive.includes(id)))throw fail('ARCHIVE_PLAN_CHANGED');
          } }) : null;
    if(apply){
      await mkdir(path.join(archiveDirectory,'plans'),{recursive:true,mode:0o700});
      await writeFile(path.join(archiveDirectory,'plans',`${label}.json`),JSON.stringify(plan,null,2),{mode:0o600});
    }
    results.push({ folder: path.basename(projectDirectory), keep: plan.keep.length, archive: plan.archive.length,
      keepMB: Math.round(plan.bytes.keep / 1048576), archiveMB: Math.round(plan.bytes.archive / 1048576),
      applied: applied ? path.basename(applied.archiveFile) : null,
      protectionCounts:Object.fromEntries(['window','referenced','recent','open','unreadable'].map(reason=>[reason,plan.keep.filter(k=>k.reasons.includes(reason)).length])),
      nativeFileDependencies:plan.keep.filter(k=>k.reasons.some(r=>r.startsWith('native_files:'))).length,
      unverified:plan.verified.filter(v=>!v.readable).length,
      keepDetails:plan.keep,archiveDetails:plan.archiveDetails });
  }
  return { mode: apply ? 'apply' : 'plan', results };
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  try {
    const result = await runNativeTranscriptArchive({ apply: process.argv.includes('--apply'),
      relayUrl: process.env.LEILEI_NATIVE_LIVE_RELAY_URL, relayToken: process.env.LEILEI_NATIVE_LIVE_RELAY_TOKEN });
    console.log(JSON.stringify(result));
  } catch (error) { console.error(/^[A-Z][A-Z_]+$/.test(error?.code ?? '') ? error.code : 'ARCHIVE_FAILED'); process.exitCode = 1; }
}
