import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const fail = code => Object.assign(new Error(code), { code });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest = /^[a-f0-9]{64}$/;
const receipt = /^[a-f0-9]{64}\.json$/;
const MAX_RECORD_BYTES = 64 * 1024 * 1024;

// Identity-verified recovery scope, shared by archive and continuation switching.
// A quarantined background result cannot always be re-delivered (the canonical
// branch can have moved), but its own native session and conversation must stay
// protected while unrelated, verified sessions may be archived or switched.
// Terminal and append journals, and any unverifiable file, stay globally fail-closed.
export async function nativeRecoveryProtectedSessions(root) {
  const directory = async folder => {
    try {
      if (!(await lstat(folder)).isDirectory()) throw fail('NATIVE_RECOVERY_UNCONFIRMED');
      const entries = await readdir(folder, { withFileTypes: true });
      if (entries.length > 1000) throw fail('NATIVE_RECOVERY_UNCONFIRMED');
      return entries;
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw fail('NATIVE_RECOVERY_UNCONFIRMED');
    }
  };
  const scopes = async name => {
    const entries = (await directory(path.join(root, name))).filter(e => !e.name.startsWith('.'));
    if (entries.some(e => !e.isDirectory() || !digest.test(e.name))) throw fail('NATIVE_RECOVERY_UNCONFIRMED');
    return entries.map(e => path.join(root, name, e.name));
  };

  // Terminal delivery and SDK append intents have more complex native
  // dependencies; retain the existing global fail-closed policy for them.
  for (const name of ['terminal-results', 'session-store-append-receipts']) {
    for (const folder of await scopes(name)) {
      if ((await directory(folder)).some(e => !e.name.startsWith('.'))) throw fail('NATIVE_SESSION_RECOVERY_REQUIRED');
    }
  }

  const sessions = new Set(), conversations = new Set();
  let backgroundReceipts = 0;
  const inspectReceipt = async file => {
    try {
      const metadata = await lstat(file);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 2 || metadata.size > MAX_RECORD_BYTES)
        throw new Error('Invalid background receipt file');
      const value = JSON.parse(await readFile(file, 'utf8'));
      const result = value?.result;
      if (!uuid.test(result?.provider_session_id ?? '') ||
          !uuid.test(result?.conversation_id ?? '') ||
          !uuid.test(value?.parentProviderCheckpointId ?? '') ||
          !uuid.test(value?.receiptId ?? '') ||
          !uuid.test(value?.sourcePrepareId ?? '') ||
          !uuid.test(value?.listenerInstanceId ?? '') ||
          !uuid.test(value?.generationId ?? '') ||
          result?.prepare_id !== value.sourcePrepareId)
        throw new Error('Background receipt cannot be bound to a native session');
      const expectedName = createHash('sha256').update(JSON.stringify([
        value.listenerInstanceId, value.generationId, value.receiptId
      ])).digest('hex') + '.json';
      if (path.basename(file) !== expectedName)
        throw new Error('Background receipt does not match its journal identity');
      sessions.add(result.provider_session_id.toLowerCase());
      conversations.add(result.conversation_id.toLowerCase());
      backgroundReceipts++;
    } catch {
      throw fail('NATIVE_RECOVERY_UNCONFIRMED');
    }
  };
  for (const folder of await scopes('background-results')) {
    const entries = await directory(folder);
    for (const entry of entries) {
      if (entry.name === '.delivery-order.json' && entry.isFile()) continue;
      if (entry.name === 'blocked' && entry.isDirectory()) {
        for (const quarantined of await directory(path.join(folder, 'blocked'))) {
          if (!quarantined.isFile() || !receipt.test(quarantined.name))
            throw fail('NATIVE_RECOVERY_UNCONFIRMED');
          await inspectReceipt(path.join(folder, 'blocked', quarantined.name));
        }
      } else if (entry.isFile() && receipt.test(entry.name)) {
        await inspectReceipt(path.join(folder, entry.name));
      } else {
        // Incomplete writes, symlinks and unknown journals are not proof
        // that all native dependencies have been identified.
        throw fail('NATIVE_RECOVERY_UNCONFIRMED');
      }
    }
  }
  return { sessions, conversations, backgroundReceipts };
}
export const archiveRecoveryProtectedSessions = nativeRecoveryProtectedSessions;
