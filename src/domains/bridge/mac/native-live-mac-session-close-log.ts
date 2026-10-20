import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { NativeLiveMacSessionCloseDiagnostic } from './native-live-mac-claude-transport.js';

const maxBytes = 1024 * 1024;
const reasons = new Set([
  'EXPLICIT_CLOSE', 'CONTROL_RECEIPT_TIMEOUT', 'EXECUTION_LEASE_REVOKED', 'SESSION_LEASE_REVOKED',
  'TURN_FAILED', 'EXECUTOR_FAILED', 'BRANCH_REPLACED', 'LEGACY_FALLBACK', 'HANDOFF_DRAIN',
  'BACKGROUND_RECOVERY_BLOCKED', 'BACKGROUND_RECOVERED', 'MANUAL_COMPACT', 'SESSION_CLEANUP',
  'DAEMON_SHUTDOWN', 'STARTUP_FAILED', 'STARTUP_ABORTED', 'TRANSPORT_ABORT', 'SDK_FAILURE',
  'INTERRUPT_WITH_BACKGROUND_TASKS', 'BACKGROUND_ACK_FAILED',
]);
const identity = (value: unknown) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

/** Close-only metadata: bounded synchronous writes avoid losing the initiating
 * cause on process exit. Two files total <=2MiB; no SDK/raw error serialization. */
export function createNativeLiveMacSessionCloseLogger(directory: string, terminal: (line: string) => void = line => { process.stdout.write(line); }) {
  let warned = false;
  const print = (line: string) => { try { terminal(line); } catch { /* Logging is nonfatal. */ } };
  return (frame: NativeLiveMacSessionCloseDiagnostic): void => {
    const line = JSON.stringify({ at: new Date().toISOString(), outcome: 'session_host_close',
      closeId: identity(frame.closeId), reasonCode: reasons.has(frame.reasonCode) ? frame.reasonCode : 'EXPLICIT_CLOSE',
      phase: ['requested', 'completed', 'failed'].includes(frame.phase) ? frame.phase : 'failed',
      state: ['starting', 'idle', 'running', 'closed', 'failed'].includes(frame.state) ? frame.state : 'unknown',
      conversationId: identity(frame.conversationId), generationId: identity(frame.generationId),
      providerSessionId: identity(frame.providerSessionId), prepareId: identity(frame.prepareId), inputId: identity(frame.inputId),
      pendingInputs: count(frame.pendingInputs), backgroundTasks: count(frame.backgroundTasks), resultReceived: frame.resultReceived === true,
    }) + '\n';
    print(line);
    let fd: number | undefined;
    try {
      mkdirSync(directory, {recursive:true,mode:0o700});
      const dir=lstatSync(directory);
      if(!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o077)!==0) throw new Error('Unsafe log directory');
      const file=join(directory,'session-host.jsonl');
      const open=()=>openSync(file,constants.O_APPEND|constants.O_CREAT|constants.O_WRONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);
      fd=open();
      const info=fstatSync(fd);
      if(!info.isFile() || info.nlink!==1 || (info.mode & 0o077)!==0) throw new Error('Unsafe log file');
      if(info.size+Buffer.byteLength(line)>maxBytes){
        closeSync(fd);fd=undefined;
        renameSync(file,file+'.1');fd=open();
      }
      writeSync(fd,line);
    } catch {
      if(!warned){warned=true;print(JSON.stringify({at:new Date().toISOString(),outcome:'session_host_log_unavailable'})+'\n');}
    } finally { if(fd!==undefined) { try {closeSync(fd);} catch { /* Nonfatal. */ } } }
  };
}
