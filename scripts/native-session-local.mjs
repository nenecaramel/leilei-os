import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const script = fileURLToPath(new URL('../tools/claude-bridge/scripts/native-session-switch.mjs', import.meta.url));
const modes = { list: '--list', desktop: '--desktop-manual', leileios: '--restore' };

// Only the existing authenticated switch performs writes. This local wrapper
// obtains credentials in memory; it does not start a daemon or model query.
export function runLocalSwitch(args, { execute = execFileSync, environment = process.env, print = value => process.stdout.write(value), conversationId } = {}) {
  const [mode, id] = args;
  if (!Object.hasOwn(modes, mode) || (mode === 'list' ? args.length !== 1 : args.length !== 2 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error('Usage: native-session-local.mjs list | desktop SESSION_ID | leileios SESSION_ID');
  }
  if (conversationId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)) throw new Error('INVALID_CONVERSATION_ID');
  const env = { ...environment };
  if (mode !== 'list') {
    let variables;
    try {
      variables = JSON.parse(execute('railway', ['variable', 'list', '--project', 'fb68460c-fda4-4969-836b-577eaa29d8b1', '--environment', 'production', '--service', 'leilei-os', '--json'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000, maxBuffer: 1024 * 1024 }));
      if (!variables.NATIVE_LIVE_RELAY_AUTH_TOKEN || !variables.MCP_SERVER_URL) throw new Error();
    } catch { throw new Error('RELAY_CREDENTIALS_UNAVAILABLE'); }
    env.LEILEI_NATIVE_LIVE_RELAY_TOKEN = variables.NATIVE_LIVE_RELAY_AUTH_TOKEN;
    env.LEILEI_NATIVE_LIVE_RELAY_URL = variables.MCP_SERVER_URL;
  }
  const flags = mode === 'list' ? [] : ['--session-id', id];
  if (mode !== 'list' && conversationId) flags.push('--conversation-id', conversationId);
  try {
    print(execute(process.execPath, [script, modes[mode], ...flags], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 240_000, maxBuffer: 128 * 1024 }));
  } catch (error) {
    // The child CLI emits only public reason codes. Do not print command/env
    // objects or raw Railway errors that may include secret values.
    const reason = String(error.stderr ?? '').trim();
    throw new Error(/^[A-Z][A-Z_]+$/.test(reason) ? reason : 'NATIVE_SWITCH_FAILED');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('NODE_22_REQUIRED');
    runLocalSwitch(process.argv.slice(2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
