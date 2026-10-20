export type Turn = 'idle' | 'prepared' | 'executing' | 'started' | 'delivery_unknown';
export type Operation = 'send' | 'edit' | 'retry' | 'stale_send' | 'reserve' | 'admit' | 'renew' |
  'queue' | 'start' | 'events' | 'success' | 'failure' | 'reject' | 'finalize_rejected' | 'unknown' |
  'attach' | 'release' | 'crash' | 'background_prepare' | 'background_submit' | 'background_cover' | 'wake' | 'repeat' | 'late_admit' | 'late_retry';
export type Model = {
  owner: 'leileios' | 'desktop'; turn: Turn; root: string|null; head: string | null; slot: string | null;
  wakeOutcome?:string; lateRetained?: boolean; branchAllowed?: boolean; backgroundAllowed?: boolean; backgroundOutcome?: string; prestartPending?: boolean; busyCount?: number; touched: boolean; inputStarted: boolean; listenerCurrent: boolean;
  background?: { generation: string; head: string; ownerRevision: string | null; queued: boolean };
};
type Cell = { state: string; operation: readonly Operation[]; when: (m: Model) => boolean; outcomes: readonly string[] };
const busy = (m: Model) => (m.busyCount??0)>0;
const executable = (m: Model) => m.owner === 'leileios' && m.listenerCurrent && (m.turn === 'executing' || m.turn === 'started');
// Ordered cells are the executable audit §3 table. Refusals are explicit;
// there is no catch-all "any failure is fine" branch.
export const transitions: readonly Cell[] = [
  { state: 'desktop', operation: ['send','edit','retry','stale_send'], when: m=>m.owner==='desktop', outcomes:['SESSION_OWNED_BY_DESKTOP'] },
  { state: 'before continuation floor', operation:['edit','retry'], when:m=>m.branchAllowed===false, outcomes:['BRANCH_POINT_INVALID'] },
  { state: 'leileios / stale head', operation:['stale_send'], when:()=>true, outcomes:['STALE_HEAD'] },
  { state: 'leileios / any turn (supersedes slot)', operation:['send','edit','retry'], when:()=>true, outcomes:['prepared'] },
  { state: 'prepared', operation:['reserve'], when:m=>m.turn==='prepared', outcomes:['reserved'] },
  { state: 'pre-start background receipt unsettled', operation:['start'], when:m=>m.prestartPending===true&&!m.inputStarted, outcomes:['refused'] },
  { state: 'executable reservation', operation:['admit','renew','queue','start'], when:executable, outcomes:['accepted'] },
  { state: 'fenced reservation', operation:['admit','renew','queue','start','late_admit'], when:()=>true, outcomes:['refused'] },
  { state: 'live current listener', operation:['events'], when:m=>m.listenerCurrent, outcomes:['events'] },
  { state: 'old listener', operation:['events'], when:()=>true, outcomes:['RESERVATION_CONFLICT'] },
  { state: 'unsettled pre-start background custody', operation:['success'], when:m=>m.prestartPending===true, outcomes:['FINALIZE_CONFLICT'] },
  { state: 'reserved / current slot', operation:['success'], when:m=>m.listenerCurrent, outcomes:['completed'] },
  { state: 'reserved failure', operation:['failure'], when:()=>true, outcomes:['CLAUDE_PROCESS_FAILED'] },
  { state: 'reserved rejection', operation:['reject','finalize_rejected'], when:()=>true, outcomes:['applied'] },
  { state: 'reserved uncertain delivery', operation:['unknown'], when:()=>true, outcomes:['applied'] },
  { state: 'busy', operation:['attach','release'], when:busy, outcomes:['NATIVE_CONVERSATION_BUSY'] },
  { state: 'idle', operation:['attach','release'], when:()=>true, outcomes:['attached'] },
  { state: 'listener expired', operation:['crash'], when:()=>true, outcomes:['acquired'] },
  { state: 'background producer usable', operation:['background_prepare'], when:m=>m.backgroundAllowed===true, outcomes:['background_prepared'] },
  { state: 'background producer fenced', operation:['background_prepare'], when:()=>true, outcomes:['BACKGROUND_CONFLICT'] },
  ...(['committed','queued','stale'] as const).map(outcome=>({ state:`background ${outcome}`, operation:['background_submit','background_cover'] as const, when:(m:Model)=>m.backgroundOutcome===outcome, outcomes:[outcome] })),
  ...(['ignored:no_source','ignored:slot_not_due','ignored:foreground_active','wake_quiet','wake_stale'] as const).map(outcome=>({ state:`silence ${outcome}`,operation:['wake'] as const,when:(m:Model)=>m.wakeOutcome===outcome,outcomes:[outcome] })),
  { state: 'purged request / desktop', operation:['late_retry'], when:m=>m.lateRetained===false&&m.owner==='desktop', outcomes:['SESSION_OWNED_BY_DESKTOP'] },
  { state: 'purged request / stale head', operation:['late_retry'], when:m=>m.lateRetained===false, outcomes:['STALE_HEAD'] },
  { state: 'previous successful operation', operation:['repeat','late_retry'], when:()=>true, outcomes:['same'] },
];
export function allowed(model: Model, operation: Operation) {
  const cell=transitions.find(c=>c.operation.includes(operation)&&c.when(model));
  if(!cell) throw Error(`missing transition cell: ${JSON.stringify(model)} / ${operation}`);
  return cell;
}
export function random(seed: number) {
  let state=seed>>>0;
  return ()=>{ state=(state+0x6d2b79f5)>>>0;let x=state;x=Math.imul(x^(x>>>15),x|1);x^=x+Math.imul(x^(x>>>7),x|61);return ((x^(x>>>14))>>>0)/4294967296; };
}
