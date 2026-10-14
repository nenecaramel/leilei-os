import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDesktopNativeSessions, nativeSessionLocations } from '../tools/claude-bridge/src/native-session-inspection.mjs';
import { buildSwitchChoices, selectAndSwitch } from '../tools/claude-bridge/src/native-session-picker.mjs';
import { runLocalSwitch, desktopAppRunning } from './native-session-local.mjs';

export async function readSwitchCatalog({ relayUrl, relayToken, fetchImpl = fetch }) {
  let url;
  try { url = new URL(relayUrl); } catch { throw new Error('INVALID_NATIVE_RESTORE_ENDPOINT'); }
  if (!relayToken || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
    !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('INVALID_NATIVE_RESTORE_ENDPOINT');
  try {
    const response = await fetchImpl(new URL('internal/native-live-session-store/native-history/choices', url), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + relayToken }, body: '{}',
    });
    if (!response.ok) throw new Error();
    const chunks = []; let bytes = 0;
    if (!response.body) throw new Error();
    for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 1024 * 1024) throw new Error(); chunks.push(chunk); }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (result.success !== true || !Array.isArray(result.data?.conversations) || result.data.conversations.length > 1000 || typeof result.data.truncated !== 'boolean') throw new Error();
    if (result.data.truncated) throw new Error('NATIVE_CATALOG_TRUNCATED');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ids = new Set();
    for (const c of result.data.conversations) {
      if (!uuid.test(c.conversationId) || ids.has(c.conversationId) || typeof c.busy !== 'boolean' ||
        !['headMessageId', 'providerSessionId', 'providerCheckpointId', 'sourceSessionId'].every(k => c[k] === null || uuid.test(c[k])) ||
        !(c.sourceLineage === undefined || (Array.isArray(c.sourceLineage) && c.sourceLineage.length <= 1000 && c.sourceLineage.every(id => uuid.test(id))))) throw new Error();
      ids.add(c.conversationId);
    }
    return result.data.conversations;
  } catch (error) { throw new Error(error.message === 'NATIVE_CATALOG_TRUNCATED' ? error.message : 'NATIVE_SWITCH_CATALOG_UNAVAILABLE'); }
}

async function main() {
  const [mode, ...extra] = process.argv.slice(2);
  if (!['desktop', 'leileios'].includes(mode) || extra.length) throw new Error('INVALID_SWITCH_MODE');
  if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('NODE_22_REQUIRED');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('INTERACTIVE_TERMINAL_REQUIRED');
  // Refuse before the picker, so the owner quits Desktop (⌘Q) instead of choosing in vain.
  if (mode === 'leileios' && desktopAppRunning()) throw new Error('NATIVE_DESKTOP_STILL_RUNNING');
  let variables;
  try {
    variables = JSON.parse(execFileSync('railway', ['variable', 'list', '--project', 'fb68460c-fda4-4969-836b-577eaa29d8b1', '--environment', 'production', '--service', 'leilei-os', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000, maxBuffer: 1024 * 1024 }));
    if (!variables.NATIVE_LIVE_RELAY_AUTH_TOKEN || !variables.MCP_SERVER_URL) throw new Error();
  } catch { throw new Error('RELAY_CREDENTIALS_UNAVAILABLE'); }
  const config = path.resolve(process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude'));
  const load = async direction => {
    const [conversations, desktop, locations] = await Promise.all([
      readSwitchCatalog({ relayUrl: variables.MCP_SERVER_URL, relayToken: variables.NATIVE_LIVE_RELAY_AUTH_TOKEN }),
      listDesktopNativeSessions({ desktopSessionsDirectory: path.join(homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions'), projectsDirectory: path.join(config, 'projects'), peerDirectory: path.join(config, 'sessions') }),
      nativeSessionLocations(path.join(config, 'projects')),
    ]);
    return buildSwitchChoices(direction, conversations, desktop.sessions, { localSessionIds: new Set(locations.keys()) });
  };
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await selectAndSwitch(mode, { isTTY: true, load, ask: question => terminal.question(question), display: text => console.log(text),
      run: (direction, choice) => runLocalSwitch([direction, choice.sessionId], { conversationId: choice.conversationId }),
    });
  } finally { terminal.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) {
    console.error(/^[A-Z][A-Z_]+$/.test(error.message) ? error.message : 'NATIVE_SWITCH_FAILED'); process.exitCode = 1;
  }
}
