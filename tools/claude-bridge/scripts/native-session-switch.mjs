import { attachDesktopNativeContinuation, handoffNativeContinuationToDesktop } from '../src/native-session-continuation.mjs';
import { restoreDesktopNativeSession, handoffNativeSessionToDesktop } from '../src/native-session-switch-restore.mjs';
import path from 'node:path';
import { homedir } from 'node:os';
import { inspectDesktopNativeSession, listDesktopNativeSessions, resolveDesktopNativeSelection } from '../src/native-session-inspection.mjs';
import { nativeSwitchErrorCodes } from '../src/native-session-switch-codes.mjs';
import { preflightNativeSessionSwitch } from '../src/native-session-switch-preflight.mjs';

// Restore is explicit/authenticated. Only --desktop invokes the official
// launcher after release; no command supplies a model prompt.
const args = process.argv.slice(2);
const flags = new Map();
const allowed = new Set(['--desktop-index', '--project-dir', '--config-dir', '--conversation-id', '--session-id', '--desktop-dir', '--history-mode']);
let valid = ['--list', '--check', '--restore', '--desktop', '--desktop-manual'].includes(args[0]) && args.length % 2 === 1;
for (let i = 1; i < args.length; i += 2) {
  if (!allowed.has(args[i]) || flags.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) valid = false;
  flags.set(args[i], args[i + 1]);
}
if (flags.has('--history-mode') && !['complete', 'continuation'].includes(flags.get('--history-mode'))) valid = false;
const explicitPaths = flags.has('--desktop-index') || flags.has('--project-dir');
if (args[0] === '--list') valid &&= [...flags.keys()].every(flag => ['--config-dir', '--desktop-dir', '--history-mode'].includes(flag));
else valid &&= flags.has('--session-id')
  ? !explicitPaths
  : flags.has('--desktop-index') && flags.has('--project-dir') && !flags.has('--desktop-dir');
if (!valid || (['--desktop', '--desktop-manual'].includes(args[0]) && !flags.has('--session-id'))) {
  console.error('Usage: native-session-switch.mjs --list|--check|--restore|--desktop|--desktop-manual [--session-id UUID] [--config-dir DIRECTORY] [--desktop-dir DIRECTORY] [--conversation-id UUID]; explicit --desktop-index FILE --project-dir DIRECTORY remains supported for check/restore');
  process.exitCode = 1;
} else {
  const configDirectory = path.resolve(flags.get('--config-dir') ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude'));
  const historyMode = flags.get('--history-mode') ?? 'complete';
  const discovery = { historyMode, desktopSessionsDirectory: path.resolve(flags.get('--desktop-dir') ?? path.join(homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions')),
    projectsDirectory: path.join(configDirectory, 'projects'), peerDirectory: path.join(configDirectory, 'sessions') };
  try {
    if (args[0] === '--list') {
      console.log(JSON.stringify(await listDesktopNativeSessions(discovery), null, 2));
    } else {
      const resolved = flags.has('--session-id')
        ? await resolveDesktopNativeSelection({ ...discovery, sessionId: flags.get('--session-id') }) : null;
      const input = { indexFile: resolved ? resolved.indexFile : path.resolve(flags.get('--desktop-index')),
        projectDirectory: resolved?.projectDirectory ?? path.resolve(flags.get('--project-dir')),
        configDirectory, peerDirectory: discovery.peerDirectory, historyMode, followNativeContinuation: resolved !== null };
      const selection = resolved?.inspection ?? await inspectDesktopNativeSession(input);
      const manual = args[0] === '--desktop-manual' && input.indexFile !== null;
      const pinned = { ...input,
        expectedSessionId: selection.providerSessionId,
        expectedCheckpointId: selection.providerCheckpointId,
        expectedRevision: selection.nativeRevision,
      };
      const desktop = ['--desktop', '--desktop-manual'].includes(args[0]);
      const write = historyMode === 'continuation'
        ? (desktop ? handoffNativeContinuationToDesktop : attachDesktopNativeContinuation)
        : (desktop ? handoffNativeSessionToDesktop : restoreDesktopNativeSession);
      const result = args[0] === '--check' ? await preflightNativeSessionSwitch(pinned) : await write({
        input: pinned, conversationId: flags.get('--conversation-id') ?? selection.providerSessionId,
        relayUrl: process.env.LEILEI_NATIVE_LIVE_RELAY_URL,
        relayToken: process.env.LEILEI_NATIVE_LIVE_RELAY_TOKEN,
        // A local-only session has no window to open by hand: Desktop must create one.
        ...(manual ? { launchImpl: async () => {} } : {}),
      });
      console.log(JSON.stringify(manual ? { ...result, desktopLaunchRequested: false } : result, null, 2));
    }
  } catch (error) {
    console.error(nativeSwitchErrorCodes(error).join('\n'));
    process.exitCode = 1;
  }
}
