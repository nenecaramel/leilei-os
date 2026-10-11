import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { readDesktopNativeHistory } from './native-session-inspection.mjs';
import { readNativeSessionRelease } from './native-session-activity.mjs';
import { readNativeSession } from './native-session-catalog.mjs';
import { readOnlyFileSnapshot } from './read-only-file-snapshot.mjs';
const fail = code => Object.assign(new Error(code), { code });

// Read-only part of the fixed switching entry. This is neither a write lease
// nor an instruction to query the SDK. Canonical/durability checks follow it.
export async function preflightNativeSessionSwitch(input) {
  const { configDirectory, projectDirectory, peerDirectory, indexFile } = input;
  // indexFile is null for a local-only session that has no Desktop window yet.
  if (![configDirectory, projectDirectory, peerDirectory].every(value => typeof value === 'string' && path.isAbsolute(value))
    || !(indexFile === null || (typeof indexFile === 'string' && path.isAbsolute(indexFile)))) {
    throw fail('NATIVE_CONFIG_LOCATION_MISMATCH');
  }
  const [config, project, peers] = await Promise.all([
    realpath(configDirectory), realpath(projectDirectory), realpath(peerDirectory),
  ]);
  if (path.dirname(path.dirname(project)) !== config || path.basename(path.dirname(project)) !== 'projects' || peers !== path.join(config, 'sessions')) {
    throw fail('NATIVE_CONFIG_LOCATION_MISMATCH');
  }
  const index = indexFile === null ? null : await readOnlyFileSnapshot(indexFile, 4 * 1024 * 1024);
  const result = await readDesktopNativeHistory(input);
  const release = await readNativeSessionRelease(peers, input.expectedSessionId, { probeProcessStart: input.probeProcessStart });
  const [currentSource, currentIndex] = await Promise.all([
    readNativeSession(project, input.expectedSessionId),
    index ? readOnlyFileSnapshot(indexFile, 4 * 1024 * 1024) : null,
  ]);
  if (currentSource.revision !== input.expectedRevision || (index && currentIndex.revision !== index.revision)) throw fail('NATIVE_INSPECTION_CHANGED');
  if (release.state === 'still_open') throw fail('NATIVE_SESSION_STILL_OPEN');
  if (release.state !== 'not_open_observed') throw fail('NATIVE_RELEASE_UNCONFIRMED');
  return {
    readOnly: true,
    executionAuthorized: false,
    providerSessionId: result.inspection.providerSessionId,
    providerCheckpointId: result.inspection.providerCheckpointId,
    nativeRevision: result.inspection.nativeRevision,
    historyRevision: result.inspection.historyRevision,
    workingDirectory: result.inspection.workingDirectory,
    messageCount: result.projection.messages.length,
    release,
  };
}
