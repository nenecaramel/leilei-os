import { restoreDesktopNativeSession } from '../src/native-session-switch-restore.mjs';
import path from 'node:path';
import { homedir } from 'node:os';
import { inspectDesktopNativeSession, nativeInspectionErrorCode } from '../src/native-session-inspection.mjs';
import { preflightNativeSessionSwitch } from '../src/native-session-switch-preflight.mjs';

// Restore is explicit and authenticated. Neither mode executes Claude.
const args = process.argv.slice(2);
const flags = new Map();
const allowed = new Set(['--desktop-index', '--project-dir', '--config-dir', '--conversation-id']);
let valid = ['--check', '--restore'].includes(args[0]) && args.length % 2 === 1;
for (let i = 1; i < args.length; i += 2) {
  if (!allowed.has(args[i]) || flags.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) valid = false;
  flags.set(args[i], args[i + 1]);
}
if (!valid || !flags.has('--desktop-index') || !flags.has('--project-dir') || (args[0] === '--restore' && !flags.has('--conversation-id'))) {
  console.error('Usage: native-session-switch.mjs --check|--restore --desktop-index FILE --project-dir DIRECTORY [--config-dir DIRECTORY] [--conversation-id UUID]');
  process.exitCode = 1;
} else {
  const configDirectory = flags.get('--config-dir') ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude');
  const input = {
    indexFile: path.resolve(flags.get('--desktop-index')),
    projectDirectory: path.resolve(flags.get('--project-dir')),
    configDirectory: path.resolve(configDirectory),
    peerDirectory: path.resolve(configDirectory, 'sessions'),
  };
  const publicCodes = new Set(['NATIVE_CONFIG_LOCATION_MISMATCH', 'NATIVE_SESSION_STILL_OPEN', 'NATIVE_RELEASE_UNCONFIRMED', 'INVALID_NATIVE_RESTORE_ENDPOINT', 'NATIVE_RESTORE_UNAVAILABLE', 'NATIVE_RESTORE_INVALID_RESPONSE', 'NATIVE_RESTORE_PAYLOAD_TOO_LARGE', 'NATIVE_CONVERSATION_BUSY', 'STALE_NATIVE_PROJECTION', 'NATIVE_TRANSCRIPT_DIVERGED', 'NATIVE_SESSION_RECOVERY_REQUIRED', 'NATIVE_SOURCE_BINDING_REQUIRED', 'EXPLICIT_BRANCH_SELECTION_REQUIRED']);
  try {
    const selection = await inspectDesktopNativeSession(input);
    const pinned = { ...input,
      expectedSessionId: selection.providerSessionId,
      expectedCheckpointId: selection.providerCheckpointId,
      expectedRevision: selection.nativeRevision,
    };
    const result = args[0] === '--check' ? await preflightNativeSessionSwitch(pinned) : await restoreDesktopNativeSession({
      input: pinned, conversationId: flags.get('--conversation-id'),
      relayUrl: process.env.LEILEI_NATIVE_LIVE_RELAY_URL,
      relayToken: process.env.LEILEI_NATIVE_LIVE_RELAY_TOKEN,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(publicCodes.has(error?.code) ? error.code : nativeInspectionErrorCode(error));
    process.exitCode = 1;
  }
}
