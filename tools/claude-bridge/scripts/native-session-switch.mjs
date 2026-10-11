import { restoreDesktopNativeSession, handoffNativeSessionToDesktop } from '../src/native-session-switch-restore.mjs';
import path from 'node:path';
import { homedir } from 'node:os';
import { inspectDesktopNativeSession, listDesktopNativeSessions, resolveDesktopNativeSelection, nativeInspectionErrorCode } from '../src/native-session-inspection.mjs';
import { preflightNativeSessionSwitch } from '../src/native-session-switch-preflight.mjs';

// Restore is explicit/authenticated. Only --desktop invokes the official
// launcher after release; no command supplies a model prompt.
const args = process.argv.slice(2);
const flags = new Map();
const allowed = new Set(['--desktop-index', '--project-dir', '--config-dir', '--conversation-id', '--session-id', '--desktop-dir']);
let valid = ['--list', '--check', '--restore', '--desktop', '--desktop-manual'].includes(args[0]) && args.length % 2 === 1;
for (let i = 1; i < args.length; i += 2) {
  if (!allowed.has(args[i]) || flags.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) valid = false;
  flags.set(args[i], args[i + 1]);
}
const explicitPaths = flags.has('--desktop-index') || flags.has('--project-dir');
if (args[0] === '--list') valid &&= [...flags.keys()].every(flag => ['--config-dir', '--desktop-dir'].includes(flag));
else valid &&= flags.has('--session-id')
  ? !explicitPaths
  : flags.has('--desktop-index') && flags.has('--project-dir') && !flags.has('--desktop-dir');
if (!valid || (['--desktop', '--desktop-manual'].includes(args[0]) && !flags.has('--session-id'))) {
  console.error('Usage: native-session-switch.mjs --list|--check|--restore|--desktop|--desktop-manual [--session-id UUID] [--config-dir DIRECTORY] [--desktop-dir DIRECTORY] [--conversation-id UUID]; explicit --desktop-index FILE --project-dir DIRECTORY remains supported for check/restore');
  process.exitCode = 1;
} else {
  const configDirectory = path.resolve(flags.get('--config-dir') ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude'));
  const discovery = { desktopSessionsDirectory: path.resolve(flags.get('--desktop-dir') ?? path.join(homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions')),
    projectsDirectory: path.join(configDirectory, 'projects'), peerDirectory: path.join(configDirectory, 'sessions') };
  const publicCodes = new Set(['CANONICAL_CHECKPOINT_CHANGED', 'CANONICAL_HEAD_CHANGED', 'CANONICAL_HISTORY_CHANGED', 'NATIVE_HISTORY_REWRITTEN', 'NATIVE_CONFIG_LOCATION_MISMATCH', 'NATIVE_SESSION_STILL_OPEN', 'NATIVE_RELEASE_UNCONFIRMED', 'INVALID_NATIVE_RESTORE_ENDPOINT', 'NATIVE_RESTORE_UNAVAILABLE', 'NATIVE_RESTORE_INVALID_RESPONSE', 'NATIVE_RESTORE_PAYLOAD_TOO_LARGE', 'NATIVE_CONVERSATION_BUSY', 'STALE_NATIVE_PROJECTION', 'NATIVE_TRANSCRIPT_DIVERGED', 'NATIVE_SESSION_RECOVERY_REQUIRED', 'NATIVE_SOURCE_BINDING_REQUIRED', 'EXPLICIT_BRANCH_SELECTION_REQUIRED', 'NATIVE_SESSION_ALREADY_ATTACHED', 'NATIVE_RECOVERY_UNCONFIRMED', 'NATIVE_DESKTOP_LAUNCH_FAILED', 'INVALID_NATIVE_ASSET', 'NATIVE_ASSET_UNAVAILABLE', 'NATIVE_ASSET_MISMATCH', 'NATIVE_ASSET_UPLOAD_FAILED']);
  try {
    if (args[0] === '--list') {
      console.log(JSON.stringify(await listDesktopNativeSessions(discovery), null, 2));
    } else {
      const resolved = flags.has('--session-id')
        ? await resolveDesktopNativeSelection({ ...discovery, sessionId: flags.get('--session-id') }) : null;
      const input = { indexFile: resolved?.indexFile ?? path.resolve(flags.get('--desktop-index')),
        projectDirectory: resolved?.projectDirectory ?? path.resolve(flags.get('--project-dir')),
        configDirectory, peerDirectory: discovery.peerDirectory, followNativeContinuation: resolved !== null };
      const selection = resolved?.inspection ?? await inspectDesktopNativeSession(input);
      const pinned = { ...input,
        expectedSessionId: selection.providerSessionId,
        expectedCheckpointId: selection.providerCheckpointId,
        expectedRevision: selection.nativeRevision,
      };
      const write = ['--desktop', '--desktop-manual'].includes(args[0]) ? handoffNativeSessionToDesktop : restoreDesktopNativeSession;
      const result = args[0] === '--check' ? await preflightNativeSessionSwitch(pinned) : await write({
        input: pinned, conversationId: flags.get('--conversation-id') ?? selection.providerSessionId,
        relayUrl: process.env.LEILEI_NATIVE_LIVE_RELAY_URL,
        relayToken: process.env.LEILEI_NATIVE_LIVE_RELAY_TOKEN,
        ...(args[0] === '--desktop-manual' ? { launchImpl: async () => {} } : {}),
      });
      console.log(JSON.stringify(args[0] === '--desktop-manual' ? { ...result, desktopLaunchRequested: false } : result, null, 2));
    }
  } catch (error) {
    console.error(publicCodes.has(error?.code) ? error.code : nativeInspectionErrorCode(error));
    process.exitCode = 1;
  }
}
