import path from 'node:path';
import { homedir } from 'node:os';
import { inspectDesktopNativeSession, nativeInspectionErrorCode } from '../src/native-session-inspection.mjs';
import { preflightNativeSessionSwitch } from '../src/native-session-switch-preflight.mjs';

// Only the read-only check is enabled until durable sync and the normal relay
// execution path are integrated. Never silently turn an inspection into a query.
const args = process.argv.slice(2);
const flags = new Map();
const allowed = new Set(['--desktop-index', '--project-dir', '--config-dir']);
let valid = args[0] === '--check' && args.length % 2 === 1;
for (let i = 1; i < args.length; i += 2) {
  if (!allowed.has(args[i]) || flags.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) valid = false;
  flags.set(args[i], args[i + 1]);
}
if (!valid || !flags.has('--desktop-index') || !flags.has('--project-dir')) {
  console.error('Usage: native-session-switch.mjs --check --desktop-index FILE --project-dir DIRECTORY [--config-dir DIRECTORY]');
  process.exitCode = 1;
} else {
  const configDirectory = flags.get('--config-dir') ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude');
  const input = {
    indexFile: path.resolve(flags.get('--desktop-index')),
    projectDirectory: path.resolve(flags.get('--project-dir')),
    configDirectory: path.resolve(configDirectory),
    peerDirectory: path.resolve(configDirectory, 'sessions'),
  };
  const publicCodes = new Set(['NATIVE_CONFIG_LOCATION_MISMATCH', 'NATIVE_SESSION_STILL_OPEN', 'NATIVE_RELEASE_UNCONFIRMED']);
  try {
    const selection = await inspectDesktopNativeSession(input);
    const result = await preflightNativeSessionSwitch({ ...input,
      expectedSessionId: selection.providerSessionId,
      expectedCheckpointId: selection.providerCheckpointId,
      expectedRevision: selection.nativeRevision,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(publicCodes.has(error?.code) ? error.code : nativeInspectionErrorCode(error));
    process.exitCode = 1;
  }
}
