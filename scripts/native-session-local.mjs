import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const script = fileURLToPath(new URL('../tools/claude-bridge/scripts/native-session-switch.mjs', import.meta.url));
const archiveScript = fileURLToPath(new URL('../tools/claude-bridge/scripts/native-transcript-archive.mjs', import.meta.url));
const AUTO_APPLY_FLAG = path.join(homedir(), '.leileios', 'archive', 'AUTO_APPLY');

// After a switch back to LeileiOS Desktop has been quit: the safest moment to
// archive redundant transcripts. Plan-only unless the owner created the flag
// file. It reports and never fails the switch that already succeeded.
export function afterSwitchArchive({ execute = execFileSync, env, autoApply = existsSync(AUTO_APPLY_FLAG) }) {
  try {
    const out = execute(process.execPath, [archiveScript, ...(autoApply ? ['--apply'] : [])],
      { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10 * 60_000, maxBuffer: 1024 * 1024 });
    const { mode, results } = JSON.parse(out);
    if (!Array.isArray(results)) throw new Error();
    return results.map(r => mode === 'apply' && r.applied
      ? `已归档 ${r.archive} 个旧会话文件（${r.archiveMB} MB）→ ${r.applied}；保留 ${r.keep} 个（${r.keepMB} MB）\n`
      : `归档预演 ${r.folder}：可归档 ${r.archive} 个（${r.archiveMB} MB），保留 ${r.keep} 个（${r.keepMB} MB）\n`).join('');
  } catch (error) {
    const reason = String(error?.stderr ?? '').trim();
    return `归档${autoApply ? '' : '预演'}跳过：${/^[A-Z][A-Z_]+$/.test(reason) ? reason : 'ARCHIVE_FAILED'}\n`;
  }
}
const modes = { list: '--list', desktop: '--desktop-manual', leileios: '--restore' };

// Desktop can restart a window's session to run a scheduled wake after the switch,
// appending to the session LeileiOS now continues. Only a quit Desktop cannot.
export function desktopAppRunning({ execute = execFileSync } = {}) {
  try { return /\d/.test(execute('/usr/bin/pgrep', ['-x', 'Claude'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 })); }
  catch (error) { if (error?.status === 1) return false; throw new Error('DESKTOP_STATE_UNKNOWN'); }
}
// Hang guard only: every relay request and attachment upload inside the child
// has its own bound. A first import on a slow link spends minutes on the restore
// upload plus attachments; restore is idempotent and attachments resume on rerun.
export const NATIVE_SWITCH_CHILD_TIMEOUT_MS = 15 * 60_000;

// Only the existing authenticated switch performs writes. This local wrapper
// obtains credentials in memory; it does not start a daemon or model query.
export function runLocalSwitch(args, { execute = execFileSync, environment = process.env, print = value => process.stdout.write(value), conversationId, archive = true, desktopRunning = desktopAppRunning } = {}) {
  const [mode, id] = args;
  if (!Object.hasOwn(modes, mode) || (mode === 'list' ? args.length !== 1 : args.length !== 2 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error('Usage: native-session-local.mjs list | desktop SESSION_ID | leileios SESSION_ID');
  }
  if (conversationId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)) throw new Error('INVALID_CONVERSATION_ID');
  if (mode === 'leileios' && desktopRunning()) throw new Error('NATIVE_DESKTOP_STILL_RUNNING');
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
    print(execute(process.execPath, [script, modes[mode], ...flags], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: NATIVE_SWITCH_CHILD_TIMEOUT_MS, maxBuffer: 128 * 1024 }));
    if (mode === 'leileios' && archive) print(afterSwitchArchive({ execute, env }));
  } catch (error) {
    // The child CLI emits only public reason codes. Do not print command/env
    // objects or raw Railway errors that may include secret values.
    if (error.code === 'ETIMEDOUT') throw new Error('NATIVE_SWITCH_TIMEOUT');
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
