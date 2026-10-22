import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../../src/database/client.js';
import { users, conversations, nativeLiveRuntimeListenerLeases as leases, nativeLiveTurnPreparations as preparations,
  nativeLiveProviderSessionCleanups as cleanups } from '../../../src/database/schema.js';
import { NativeLiveBackendTurnCoordinator } from '../../../src/domains/bridge/turn/native-live-backend-turn-coordinator.js';
import { DrizzleNativeLiveBackendTurnPort } from '../../../src/domains/bridge/turn/native-live-backend-turn-repository.js';
import { DrizzleNativeLiveBackendRelayRepository } from '../../../src/domains/bridge/relay/native-live-backend-relay.js';
import { DrizzleNativeLiveRuntimeEventRepository } from '../../../src/domains/bridge/runtime-interaction/native-live-runtime-event-stream.js';
import { bindNativeLiveInput } from '../../../src/domains/bridge/relay/native-live-input-binding.js';
import * as continuationLifecycle from '../../../src/domains/conversation/native-session-continuation-repository.js';
import { attachNativeContinuation, releaseNativeContinuation, readNativeContinuationState } from '../../../src/domains/conversation/native-session-continuation-repository.js';
import { NativeLiveSilenceWakeService, silenceWakePreparationId } from '../../../src/domains/bridge/turn/native-live-silence-wake.js';
import type { NativeLiveRuntimeCommand, NativeLiveRuntimeExecutionResult } from '../../../src/domains/bridge/protocol/native-live-runtime-protocol.js';
import type { NativeLiveBackgroundPrepare, NativeLiveBackgroundSubmit } from '../../../src/domains/bridge/protocol/native-live-background-result.js';
import { readState, assertCanonical, type Database, type Snapshot } from './state.js';
import { allowed, random, type Model, type Operation } from './model.js';

type Replay = { call: ()=>Promise<unknown>; expected: unknown; input: unknown };
type Source = { command: NativeLiveRuntimeCommand; session: string; checkpoint: string; listener: string; generation:string; revision:string|null; head:string };
const semantic = (value: unknown): unknown => {
  if(value===null || typeof value!=='object')return ['applied','idempotent'].includes(String(value))?'accepted':value;
  if(Array.isArray(value))return value.map(semantic);
  return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='duplicate').map(([key,val])=>
    [key, key==='outcome' && ['created','replayed','completed','idempotent','applied','attached','already_current','releasing','cancelled'].includes(String(val))?'accepted':semantic(val)]));
};

export class Scenario {
  readonly model: Model = { owner:'leileios',turn:'idle',root:null,head:null,slot:null,touched:false,inputStarted:false,listenerCurrent:true,branchAllowed:true,lateRetained:true };
  readonly log: unknown[]=[];
  readonly port: DrizzleNativeLiveBackendTurnPort;
  readonly coordinator: NativeLiveBackendTurnCoordinator;
  readonly relay: DrizzleNativeLiveBackendRelayRepository;
  readonly events: DrizzleNativeLiveRuntimeEventRepository;
  listener:string=randomUUID(); session:string=randomUUID(); checkpoint:string=randomUUID();
  command?: NativeLiveRuntimeCommand;
  source?: Source;
  background?: { prepare: NativeLiveBackgroundPrepare & {userId:string}; submit: NativeLiveBackgroundSubmit & {userId:string}; saved: Model['background']; source:Source };
  replay?: Replay;
  lateReplay?: Replay;
  lateUser?:string;
  staleCommands: NativeLiveRuntimeCommand[]=[];
  target?: string;
  sequence=0;
  busy=new Set<string>();
  expectedParents=new Map<string,string|null>();
  completedAtStep=new Map<string,number>();
  preparationMessages=new Map<string,{user:string;reply?:string}>();
  preparationStates=new Map<string,{created:number;dispatch:'staged'|'executing'|'delivery_unknown'}>();
  consumedWakeEpochs=new Set<string>();
  prestart=new Set<string>();
  listeners=new Map<string,string>();
  backgroundPhases=new Map<string,'prepared'|'queued'|'terminal'>();
  backgroundSources=new Map<string,string>();
  beginInput?:{userId:string;conversationId:string;sessionId:string;expectedHeadMessageId:string|null;expectedRevision:string|null};
  constructor(readonly db: Database, readonly userId: string, readonly conversationId: string, readonly seed: number) {
    this.port=new DrizzleNativeLiveBackendTurnPort(db);this.coordinator=new NativeLiveBackendTurnCoordinator(this.port);
    this.relay=new DrizzleNativeLiveBackendRelayRepository(db);this.events=new DrizzleNativeLiveRuntimeEventRepository(db);
  }
  async initialize() {
    await attachNativeContinuation(this.db,{userId:this.userId,conversationId:this.conversationId,sessionId:this.session,checkpointId:this.checkpoint,
      revision:'1'.repeat(64),effectiveWorkingDirectory:'/synthetic/scenario',expectedHeadMessageId:null,expectedRevision:null,
      checkpointIds:[this.checkpoint],completedTurnCheckpointIds:[this.checkpoint]});
    assert.equal(await this.relay.renewLease({userId:this.userId,listenerInstanceId:this.listener}),'acquired');
    await this.step('send');await this.step('reserve');await this.step('success');
  }
  reservation(command=this.command!) {return {userId:this.userId,listenerInstanceId:this.listeners.get(command.prepare_id)??this.listener,reservationId:command.prepare_id};}
  admission(command=this.command!) {return {...this.reservation(command),requestId:command.request_id,conversationId:this.conversationId,
    runtimeMode:command.runtime_mode,canonicalUserMessageId:command.canonical_user_message_id,
    parentProviderSessionId:command.parent_provider_session_id,parentProviderCheckpointId:command.parent_provider_checkpoint_id!};}
  async reserve(command=this.command!) {
    this.listeners.set(command.prepare_id,this.listener);
    const state=this.preparationStates.get(command.prepare_id);if(state)state.dispatch='executing';
    await this.db.update(preparations).set({reservedBy:this.listener,reservedAt:new Date(),reservationExpiresAt:new Date(Date.now()+600_000),
      executionStartedAt:new Date(),dispatchStatus:'executing'}).where(eq(preparations.id,command.prepare_id));
  }
  result(command=this.command!, quiet=false): NativeLiveRuntimeExecutionResult {
    return {protocol_version:4,prepare_id:command.prepare_id,request_id:command.request_id,conversation_id:this.conversationId,status:'success',
      provider_session_id:command.runtime_mode==='resume'?command.parent_provider_session_id!:randomUUID(),
      provider_checkpoint_id:randomUUID(),effective_working_directory:command.expected_working_directory??'/synthetic/scenario',
      normalized_events:[{type:'text',payload:{text:quiet?'<quiet />':`synthetic seed ${this.seed}`}}]};
  }
  async replayable(input: unknown, call: ()=>Promise<unknown>) {
    const result=await call();this.replay={input,call,expected:semantic(result)};return result;
  }
  async invariant(before: Snapshot, rotate: boolean, operation: Operation, revisionRotates=false, returnedRevision?:string) {
    const after=await readState(this.db,this.userId,this.conversationId);
    assert.equal(after.row.owner,this.model.owner,'owner fence: model owner');
    assert.equal(after.row.ownerRevision!==before.row.ownerRevision,revisionRotates,`owner revision: ${operation} rotates only for an actual ownership/binding change`);
    if(returnedRevision!==undefined)assert.equal(after.row.ownerRevision,returnedRevision,'lifecycle response revision equals the authoritative row');
    assert.equal(after.row.prepareId,this.model.slot,'turn slot matches the reference model');
    assert.equal(after.row.anchor,this.model.head,'turn anchor matches the expected canonical head');
    assert.equal(after.row.generation!==before.row.generation,rotate,`generation: ${operation} rotates exactly at native-line boundaries`);
    assertCanonical(after,this.model.head,this.model.root,this.expectedParents);
    const candidates=await this.db.select({id:preparations.id,listener:preparations.reservedBy}).from(preparations).where(eq(preparations.conversationId,this.conversationId));
    let admitted=0;
    for(const {id,listener} of candidates){
      const p=await this.port.getPreparation({userId:this.userId,prepareId:id});assert.ok(p);
      const ok=await this.relay.checkExecutionAdmission({userId:this.userId,listenerInstanceId:listener??this.listener,reservationId:id,requestId:p.requestId,
        conversationId:this.conversationId,runtimeMode:p.runtimeMode,canonicalUserMessageId:p.canonicalUserMessageId,
        parentProviderSessionId:p.parentProviderSessionId,parentProviderCheckpointId:p.parentProviderCheckpointId!});
      if(ok&&p.operation!=='wake')admitted++;
      if(this.model.owner!=='leileios')assert.equal(ok,false,'owner fence: admission (including Wake)');
    }
    assert.ok(admitted<=1,`single executor: ${admitted} foreground preparations admitted`);
    return after;
  }
  async step(operation: Operation) {
    const before=await readState(this.db,this.userId,this.conversationId);
    const pending=this.model.turn!=='idle'&&this.model.turn!=='delivery_unknown'&&this.command?.operation==='send'&&this.command.runtime_mode==='resume';
    this.model.prestartPending=this.prestart.size>0;
    this.model.releaseBlocked=this.busy.size>0||[...this.backgroundPhases.values()].some(phase=>phase!=='terminal');
    this.model.backgroundAllowed=!!this.source&&this.model.owner==='leileios'&&this.source.listener===this.listener
      &&this.source.revision===before.row.ownerRevision&&this.source.head===this.model.head
      &&(this.source.generation===before.row.generation||pending)
      &&(this.busy.size===0||(this.busy.size===1&&pending))&&!(pending&&!this.model.inputStarted&&this.prestart.size>0);
    this.model.backgroundOutcome=this.background&&!this.backgroundPhases.has(this.background.prepare.receiptId)?'BACKGROUND_NOT_FOUND':operation==='background_cover'?'committed':this.background?.prepare.deferred?'queued':
      this.background&&this.model.owner==='leileios'&&this.background.saved!.generation===before.row.generation
        &&this.background.saved!.ownerRevision===before.row.ownerRevision&&this.background.saved!.head===this.model.head
        &&this.background.prepare.listenerInstanceId===this.listener&&this.busy.size===0?'committed':'stale';
    const path=new Set<string>();let cursor=before.row.head;
    while(cursor){path.add(cursor);cursor=before.messages.find(m=>m.id===cursor)!.parent;}
    const latestUser=before.messages.filter(m=>m.role==='user').at(-1);
    const directReply=latestUser?before.messages.find(m=>m.role==='assistant'&&m.status==='completed'&&m.parent===latestUser.id&&path.has(m.id)):undefined;
    const wakeBusy=directReply&&[...this.busy].some(id=>{const p=this.preparationStates.get(id)!;return p.dispatch!=='staged'||p.created>=(this.completedAtStep.get(directReply.id)??-1);});
    this.model.wakeOutcome=!directReply?'ignored:no_source':this.model.owner==='releasing'?'ignored:source_changed':this.consumedWakeEpochs.has(latestUser!.id)?'ignored:slot_not_due':wakeBusy?'ignored:foreground_active':
      this.model.owner==='leileios'?'wake_quiet':'wake_stale';
    const cell=allowed(this.model,operation);
    let outcome='',input:unknown={},rotate=false,revisionRotates=false,returnedRevision:string|undefined;
    // Capture the expected cell before any operation changes the model.
    const record:Record<string,unknown>={step:this.log.length,operation,state:structuredClone(this.model),cell:cell.state};
    this.log.push(record);
    const previousReplay=this.replay;this.replay=undefined;
    try {
      switch(operation) {
        case 'send':case 'edit':case 'retry':case 'stale_send': {
          const request={dispatch_target:'claude_code',request_id:randomUUID(),conversation_id:this.conversationId,
            operation:operation==='stale_send'?'send':operation,
            ...(operation==='send'||operation==='stale_send'?{expected_head_message_id:operation==='stale_send'?randomUUID():this.model.head,text:'synthetic input'}:
              {target_user_message_id:this.target!,...(operation==='edit'?{text:'synthetic replacement'}:{})})};input=request;
          const result=await this.coordinator.prepare(this.userId,request);
          outcome=result.ok?'prepared':result.code;
          if(result.ok){
            this.replay={input,call:()=>this.coordinator.prepare(this.userId,request),expected:semantic(result)};
            if(!this.lateReplay){this.lateReplay=this.replay;this.lateUser=result.command.canonical_user_message_id!;}
            if(this.command)this.staleCommands.push(this.command);
            this.command=result.command;this.model.slot=result.command.prepare_id;this.model.turn='prepared';
            this.model.touched=false;this.model.inputStarted=false;this.model.listenerCurrent=true;this.sequence=0;
            this.busy.add(result.command.prepare_id);this.model.busyCount=this.busy.size;
            this.preparationStates.set(result.command.prepare_id,{created:this.log.length,dispatch:'staged'});
            this.preparationMessages.set(result.command.prepare_id,{user:result.command.canonical_user_message_id!});
            const userParent=operation==='send'||operation==='stale_send'?this.model.head:this.expectedParents.get(this.target!)!;
            this.expectedParents.set(result.command.canonical_user_message_id!,userParent);
          }break;
        }
        case 'reserve':await this.reserve();this.model.turn='executing';outcome='reserved';break;
        case 'admit':case 'late_admit':case 'renew':case 'queue':case 'start': {
          const command=operation==='late_admit'?this.staleCommands.at(-1)!:this.command!;
          input={...this.admission(command),...(operation==='queue'||operation==='start'?{phase:operation==='queue'?'queued':'started'}:{})};
          const call=()=>operation==='admit'||operation==='late_admit'?this.relay.checkExecutionAdmission(input as ReturnType<Scenario['admission']>):
            operation==='renew'?this.relay.renewExecutionLease(input as ReturnType<Scenario['admission']>):
              bindNativeLiveInput(this.db,input as ReturnType<Scenario['admission']>&{phase:'queued'|'started'});
          const result=await call();outcome=result?'accepted':'refused';
          if(result){this.replay={input,call,expected:semantic(result)};
            if(operation==='start'){rotate=!this.model.inputStarted;this.model.inputStarted=true;this.model.touched=true;this.model.turn='started';
              // A queued native B may have advanced the actual producer cursor.
              this.command={...this.command!,parent_provider_checkpoint_id:(result as {parentProviderCheckpointId:string}).parentProviderCheckpointId};}}
          break;
        }
        case 'events': {
          input={...this.reservation(),events:[{sequence:++this.sequence,event:{type:'text' as const,payload:{text:'synthetic runtime'}}}]};
          const call=()=>this.events.appendBatch(input as Parameters<Scenario['events']['appendBatch']>[0]);
          assert.deepEqual(await call(),{created:1,idempotent:0},'runtime event append creates the requested sequence');outcome='events';rotate=!this.model.touched;this.model.touched=true;
          // Batch counters distinguish created/idempotent; the semantic receipt is
          // the same event sequence, checked through stable counts on repeat.
          this.replay={input,call:async()=>{assert.deepEqual(await call(),{created:0,idempotent:1},'runtime event replay retains its sequence');return 'events';},expected:'events'};break;
        }
        case 'success':case 'failure': {
          const command=this.command!;
          const resultInput=operation==='success'?this.result():{protocol_version:4 as const,prepare_id:command.prepare_id,request_id:command.request_id,
            conversation_id:this.conversationId,status:'failure' as const,error_code:'CLAUDE_PROCESS_FAILED' as const};
          input=resultInput;
          const result=await this.coordinator.finalize(this.userId,resultInput);outcome=result.ok?result.outcome:result.code;
          if(operation==='success'&&result.ok&&'assistantMessageId'in result){
            if((command.operation==='edit'||command.operation==='retry')&&this.target===this.lateUser)this.model.lateRetained=false;
            rotate=command.operation==='edit'||command.operation==='retry'||command.runtime_mode!=='resume';this.model.head=result.assistantMessageId;this.target=command.canonical_user_message_id!;this.model.branchAllowed=true;
            const committed=await readState(this.db,this.userId,this.conversationId);
            if(command.operation==='edit'||command.operation==='retry'){
              const retained=new Set(committed.messages.map(message=>message.id));
              for(const [prepareId,messages] of this.preparationMessages)if(!retained.has(messages.user)||(messages.reply!==undefined&&!retained.has(messages.reply))){this.busy.delete(prepareId);this.preparationStates.delete(prepareId);this.preparationMessages.delete(prepareId);}
              for(const [receiptId,sourceHead] of this.backgroundSources)if(!retained.has(sourceHead)){this.backgroundSources.delete(receiptId);this.backgroundPhases.delete(receiptId);this.prestart.delete(receiptId);}
            }
            assert.equal(committed.messages.find(m=>m.id===result.assistantMessageId)?.parent,command.canonical_user_message_id,'foreground reply parent is its own accepted user message');
            this.expectedParents.set(result.assistantMessageId,command.canonical_user_message_id);
            this.preparationMessages.set(command.prepare_id,{user:command.canonical_user_message_id!,reply:result.assistantMessageId});
            this.completedAtStep.set(result.assistantMessageId,this.log.length);
            let root=command.canonical_user_message_id!;while(this.expectedParents.get(root)!==null)root=this.expectedParents.get(root)!;this.model.root=root;
            this.session=result.providerSessionId;this.checkpoint=(resultInput as {provider_checkpoint_id:string}).provider_checkpoint_id;
            const row=(await readState(this.db,this.userId,this.conversationId)).row;
            this.source={command,session:this.session,checkpoint:this.checkpoint,listener:this.listener,generation:row.generation,revision:row.ownerRevision,head:result.assistantMessageId};
          }
          if(!result.ok&&result.code==='FINALIZE_CONFLICT')await this.relay.markFinalizeRejected({...this.reservation(),code:'FINALIZE_CONFLICT'});
          else await this.relay.markCompleted(this.reservation());this.model.turn='idle';this.busy.delete(command.prepare_id);this.model.busyCount=this.busy.size;
          this.replay={input,call:()=>this.coordinator.finalize(this.userId,resultInput),expected:semantic(result)};break;
        }
        case 'reject':case 'finalize_rejected':case 'unknown': {
          input={...this.reservation(),code:operation==='finalize_rejected'?'FINALIZE_CONFLICT':'INVALID_COMMAND'};
          const reservation=this.reservation();
          const call=()=>operation==='reject'?this.relay.rejectReservation({...reservation,code:'INVALID_COMMAND'}):
            operation==='finalize_rejected'?this.relay.markFinalizeRejected({...reservation,code:'FINALIZE_CONFLICT'}):this.relay.markDeliveryUnknown(reservation);
          outcome=String(await this.replayable(input,call));if(operation==='unknown')this.preparationStates.get(this.command!.prepare_id)!.dispatch='delivery_unknown';this.model.turn=operation==='unknown'?'delivery_unknown':'idle';if(operation!=='unknown'){this.busy.delete(this.command!.prepare_id);this.model.busyCount=this.busy.size;}break;
        }
        case 'begin_release': {
          if(this.model.owner!=='releasing')this.beginInput={userId:this.userId,conversationId:this.conversationId,sessionId:this.session,expectedHeadMessageId:this.model.head,expectedRevision:before.row.ownerRevision};
          assert.ok(this.beginInput);const request={...this.beginInput};input=request;
          const call=()=>continuationLifecycle.beginNativeContinuationRelease(this.db,request);
          const result=await call();
          assert.equal(result.owner,'releasing');assert.equal(result.conversationId,this.conversationId);assert.equal(result.headMessageId,this.model.head);assert.equal(result.providerSessionId,request.sessionId);assert.match(result.expectedRevision,/^[0-9a-f]{64}$/);
          outcome=result.outcome==='already_current'?'releasing':result.outcome;revisionRotates=this.model.owner!=='releasing';this.model.owner='releasing';returnedRevision=result.expectedRevision;
          this.replay={input,call,expected:semantic(result)};break;
        }
        case 'cancel_release':case 'stale_cancel_release': {
          const request={userId:this.userId,conversationId:this.conversationId,expectedRevision:operation==='stale_cancel_release'?'0'.repeat(64):before.row.ownerRevision!};input=request;
          const call=()=>continuationLifecycle.cancelNativeContinuationRelease(this.db,request);
          const result=await call();
          assert.equal(result.owner,'leileios');assert.equal(result.conversationId,this.conversationId);assert.match(result.expectedRevision,/^[0-9a-f]{64}$/);
          outcome=result.outcome==='already_current'?'cancelled':result.outcome;revisionRotates=this.model.owner==='releasing';this.model.owner='leileios';returnedRevision=result.expectedRevision;
          this.replay={input,call,expected:semantic(result)};break;
        }
        case 'probe_owner_fence': {
          // Begin correctly rejects live work. Restore only the reservation of
          // an already-rejected synthetic turn to isolate the owner predicate
          // from terminal/status fences, then restore every touched column.
          const command=this.command!;const savedModelDispatch=this.preparationStates.get(command.prepare_id)?.dispatch;const savedListener=this.listeners.get(command.prepare_id);const [saved]=await this.db.select().from(preparations).where(eq(preparations.id,command.prepare_id));assert.ok(saved);
          assert.equal(saved.status,'prepared');assert.equal(saved.dispatchStatus,'rejected');
          const [savedLease]=await this.db.select().from(leases).where(eq(leases.userId,this.userId));assert.ok(savedLease);
          input=this.admission(command);
          try {
            await this.reserve(command);
            const admitted=await this.relay.checkExecutionAdmission(this.admission(command));
            const expected=this.model.owner==='leileios';
            assert.equal(admitted,expected,'owner fence: an otherwise admissible foreground reservation cannot run while releasing/desktop');
            assert.equal(await this.relay.renewExecutionLease(this.admission(command)),expected,'owner fence: execution lease renewal');
            if(!expected)for(const phase of ['queued','started'] as const)assert.equal(await bindNativeLiveInput(this.db,{...this.admission(command),phase}),null,`owner fence: input ${phase}`);
            outcome=admitted?'accepted':'refused';
          }finally{
            await this.db.update(preparations).set({dispatchStatus:saved.dispatchStatus,reservedBy:saved.reservedBy,reservedAt:saved.reservedAt,reservationExpiresAt:saved.reservationExpiresAt,executionStartedAt:saved.executionStartedAt,updatedAt:saved.updatedAt}).where(eq(preparations.id,saved.id));
            const state=this.preparationStates.get(saved.id);if(state&&savedModelDispatch)state.dispatch=savedModelDispatch;
            await this.db.update(leases).set({leaseExpiresAt:savedLease.leaseExpiresAt,updatedAt:savedLease.updatedAt}).where(eq(leases.userId,this.userId));
            if(savedListener===undefined)this.listeners.delete(saved.id);else this.listeners.set(saved.id,savedListener);
          }break;
        }
        case 'attach':case 'release':case 'complete_release':case 'stale_complete_release': {
          const current=await readNativeContinuationState(this.db,{userId:this.userId,conversationId:this.conversationId,sessionId:this.session});
          input={userId:this.userId,conversationId:this.conversationId,sessionId:current.providerSessionId!,checkpointId:current.providerCheckpointId!,
            effectiveWorkingDirectory:current.effectiveWorkingDirectory!,revision:'2'.repeat(64),expectedHeadMessageId:this.model.head,
            expectedRevision:operation==='stale_complete_release'?'0'.repeat(64):before.row.ownerRevision,checkpointIds:[current.providerCheckpointId!],completedTurnCheckpointIds:[current.providerCheckpointId!]};
          // 'release' models the supported CLI handoff, now begin -> complete.
          // Raw direct-release refusal is covered by the cleanup DB/API tests.
          if(operation==='release' && before.row.owner==='leileios') {
            const begin=await continuationLifecycle.beginNativeContinuationRelease(this.db,{userId:this.userId,conversationId:this.conversationId,
              sessionId:current.providerSessionId!,expectedHeadMessageId:this.model.head,expectedRevision:before.row.ownerRevision});
            (input as {expectedRevision:string|null}).expectedRevision=begin.expectedRevision;
          }
          const call=()=> (operation==='attach'?attachNativeContinuation:releaseNativeContinuation)(this.db,input as Parameters<typeof attachNativeContinuation>[1]);
          const result=await call();outcome='attached';revisionRotates=result.outcome!=='already_current';this.model.owner=operation==='attach'?'leileios':'desktop';this.model.branchAllowed=false;
          this.replay={input,call,expected:semantic(result)};break;
        }
        case 'crash': {
          await this.db.update(leases).set({leaseExpiresAt:new Date(0)}).where(eq(leases.userId,this.userId));
          const old=this.listener;this.listener=randomUUID();input={expiredListener:old,newListener:this.listener};
          outcome=await this.relay.renewLease({userId:this.userId,listenerInstanceId:this.listener});this.model.listenerCurrent=false;
          if(this.model.turn==='executing'||this.model.turn==='started'){
            // The real reserve path classifies expired executing reservations as
            // unknown, retaining evidence rather than rerunning the provider.
            await this.db.update(preparations).set({reservationExpiresAt:new Date(0)}).where(eq(preparations.id,this.command!.prepare_id));
            const reserved=await this.relay.reserveNext({userId:this.userId,listenerInstanceId:this.listener,persistentSessions:true});
            assert.notEqual(reserved?.prepareId,this.command!.prepare_id,'crash: new listener must not re-dispatch the uncertain old execution');
            const [old]=await this.db.select({dispatch:preparations.dispatchStatus}).from(preparations).where(eq(preparations.id,this.command!.prepare_id));
            assert.equal(old?.dispatch,'delivery_unknown','crash: old execution is durably delivery_unknown');record.crashDispatch=old?.dispatch;
            this.model.turn='delivery_unknown';this.preparationStates.get(this.command!.prepare_id)!.dispatch='delivery_unknown';
          }break;
        }
        case 'background_prepare': {
          const source=this.source!;
          const pending=this.model.turn!=='idle'&&this.command?.operation==='send'&&this.command.runtime_mode==='resume';
          input={userId:this.userId,sourcePrepareId:source.command.prepare_id,listenerInstanceId:source.listener,generationId:randomUUID(),receiptId:randomUUID(),
            parentProviderCheckpointId:source.checkpoint,...(pending?this.model.inputStarted?{deferred:true}:{executionStart:true,deferred:true}:{})};
          const call=()=>this.relay.prepareBackgroundResult(input as NativeLiveBackgroundPrepare & {userId:string});
          const result=await call();outcome='background_prepared';
          this.backgroundPhases.set((input as NativeLiveBackgroundPrepare).receiptId,'prepared');
          this.backgroundSources.set((input as NativeLiveBackgroundPrepare).receiptId,source.head);
          if((input as NativeLiveBackgroundPrepare).executionStart)this.prestart.add((input as NativeLiveBackgroundPrepare).receiptId);
          const submit={...(input as NativeLiveBackgroundPrepare & {userId:string}),result:{...this.result(source.command),provider_session_id:source.session}};
          this.background={prepare:input as NativeLiveBackgroundPrepare & {userId:string},submit,
            source:structuredClone(source),saved:{generation:before.row.generation,head:this.model.head!,ownerRevision:before.row.ownerRevision,queued:false}};
          this.replay={input,call,expected:semantic(result)};break;
        }
        case 'background_submit':case 'background_cover': {
          const background=this.background!;
          if(operation==='background_cover'){
            assert.equal(this.model.turn,'idle','cover follows committed F');
            assert.ok(this.source&&this.source.command.prepare_id!==background.source.command.prepare_id,'cover belongs to later F');
            background.submit={...background.submit,coveringCheckpointId:this.checkpoint};
          }
          input=background.submit;
          const result=await this.relay.submitBackgroundResult(background.submit);outcome=result.outcome;
          if(!background.submit.coveringCheckpointId&&background.saved!.generation!==before.row.generation)assert.notEqual(outcome,'committed','no stale background output');
          if(this.model.owner!=='leileios')assert.notEqual(outcome,'committed','owner fence: background commit');
          if(outcome==='committed'){
            this.model.head=background.prepare.receiptId;this.expectedParents.set(this.model.head,before.row.head);
            this.source={...background.source,checkpoint:result.providerCheckpointId!,head:this.model.head,generation:before.row.generation};
            const after=await readState(this.db,this.userId,this.conversationId);
            assert.equal(after.messages.find(m=>m.id===this.model.head)?.parent,before.row.head,'canonical shape: B follows F/head');
            if(background.submit.coveringCheckpointId){
              const foreground=after.messages.find(m=>m.id===before.row.head);
              const user=after.messages.find(m=>m.id===foreground?.parent);
              assert.equal(user?.role,'user','H→U→F→B: F follows U');
              assert.equal(user?.parent,background.saved!.head,'H→U→F→B: accepted U retains H');
            }
          }
          this.prestart.delete(background.prepare.receiptId);
          this.backgroundPhases.set(background.prepare.receiptId,outcome==='queued'?'queued':'terminal');
          if(outcome==='queued')background.saved!.queued=true;
          this.replay={input,call:()=>this.relay.submitBackgroundResult(background.submit),expected:semantic(result)};
          if(outcome!=='queued')this.background=undefined;break;
        }
        case 'wake': {
          let now=new Date();const wake=new NativeLiveSilenceWakeService(this.db,()=>now);
          const schedule=await wake.readSchedule({userId:this.userId});if(!schedule){outcome='ignored:no_source';record.fire={outcome:'ignored',reason:'no_source'};break;}
          now=new Date(schedule.postTurnDueAt);input={userId:this.userId,epochId:schedule.epochId,slot:'post_turn_idle'};
          const fired=await wake.fire(input as Parameters<NativeLiveSilenceWakeService['fire']>[0]);
          record.fire=fired;
          if(this.model.owner==='releasing'){
            assert.deepEqual(fired,{outcome:'ignored',reason:'source_changed',schedule:null},'releasing Wake is refused before creating transport custody');
            const afterFire=await readState(this.db,this.userId,this.conversationId);
            assert.deepEqual(afterFire.counts,before.counts,'releasing Wake creates no preparation, pending work, event, message, checkpoint or receipt');
            assert.equal(afterFire.counts?.pendingPreparations,0,'releasing Wake cannot strand pending work and block complete/attach');
          }
          if(fired.outcome!=='queued'){outcome=`ignored:${fired.reason}`;break;}
          this.consumedWakeEpochs.add(schedule.epochId);
          const id=silenceWakePreparationId(schedule.epochId,'post_turn_idle');
          // Persistent Wake takes the existing test seam: exact resume mode.
          await this.db.update(preparations).set({runtimeMode:'resume'}).where(eq(preparations.id,id));
          const p=await this.port.getPreparation({userId:this.userId,prepareId:id});assert.ok(p);
          const command={...this.command!,prepare_id:id,request_id:p.requestId,canonical_user_message_id:null,
            operation:'wake' as const,runtime_mode:'resume' as const,parent_provider_session_id:p.parentProviderSessionId,
            parent_provider_checkpoint_id:p.parentProviderCheckpointId!,expected_working_directory:p.expectedWorkingDirectory!};
          await this.reserve(command);
          const admitted=await this.relay.checkExecutionAdmission(this.admission(command));
          assert.equal(admitted,this.model.owner==='leileios','Wake admission matches current execution owner');
          const resultInput=this.result(command,true),result=await this.coordinator.finalize(this.userId,resultInput);
          outcome=result.ok?result.outcome:result.code;
          if(result.ok&&result.outcome==='wake_quiet'&&this.source){this.source.checkpoint=(resultInput as {provider_checkpoint_id:string}).provider_checkpoint_id;this.checkpoint=this.source.checkpoint;}
          await this.relay.markCompleted(this.reservation(command));break;
        }
        case 'repeat':case 'late_retry': {
          const retry=operation==='late_retry'?this.lateReplay:previousReplay;
          assert.ok(retry);input=retry.input;this.replay=retry;
          const result=await retry.call();
          if(operation==='late_retry'&&this.model.lateRetained===false){outcome=(result as {code:string}).code;this.replay=undefined;}
          else {assert.deepEqual(semantic(result),retry.expected,'idempotency: same semantic outcome');outcome='same';}
          const after=await readState(this.db,this.userId,this.conversationId);
          assert.deepEqual(after.counts,before.counts,'idempotency: no extra message/checkpoint/event/receipt');break;
        }
      }
    } catch(error) {
      if(typeof (error as {code?:unknown}).code==='string' && (error as {code:string}).code!=='ERR_ASSERTION')outcome=(error as {code:string}).code;
      else {record.input=input;record.error=String(error);throw this.failure(error);}
    }
    record.input=input;record.outcome=outcome;
    try {
      assert.ok(cell.outcomes.includes(outcome),`refusal vocabulary: ${cell.state} / ${operation} expected ${cell.outcomes.join('|')}, got ${outcome}`);
      await this.invariant(before,rotate,operation,revisionRotates,returnedRevision);
    }catch(error){throw this.failure(error);}
  }
  failure(error: unknown) {return new Error(`SCENARIO_SEED=${this.seed} SCENARIO_STEPS=${this.log.length}\n${String(error)}\nStep log:\n${JSON.stringify(this.log,null,2)}`,{cause:error});}
  async run(steps: number) {
    const rng=random(this.seed);
    for(let n=0;n<steps;n++){
      const m=this.model;
      let operations:Operation[];
      if(m.owner==='releasing')operations=['begin_release','complete_release','cancel_release','attach','send','edit','retry','admit','renew','queue','start','wake','stale_complete_release','stale_cancel_release'];
      else if(m.owner==='desktop')operations=['attach','send','edit','retry','admit','renew','start','wake','begin_release','cancel_release'];
      else if(m.turn==='idle')operations=['send','send','edit','retry','release','begin_release','cancel_release','attach','wake'];
      else if(m.turn==='prepared')operations=['reserve','reserve','send','stale_send','release','begin_release','attach','admit'];
      else if(m.turn==='delivery_unknown')operations=['send','admit','renew','finalize_rejected','stale_send'];
      else operations=['admit','renew','events','success','success','failure','reject','finalize_rejected','unknown','send','crash','release','begin_release'];
      if(m.owner==='leileios'&&m.listenerCurrent&&(m.turn==='executing'||m.turn==='started')&&this.command?.operation==='send')operations.push('queue','start','start');
      if(this.source)operations.push('background_prepare');
      if(this.background)operations.push('background_submit','background_submit');
      if(this.replay)operations.push('repeat','repeat');
      if(this.staleCommands.length)operations.push('late_admit');
      if(this.lateReplay)operations.push('late_retry');
      await this.step(operations[Math.floor(rng()*operations.length)]!);
    }
  }
}

export async function withScenario(seed:number,run:(scenario:Scenario)=>Promise<void>) {
  const url=new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/leileios_native_session_test');
  const {isolatedPostgresTarget,verifyIsolatedPostgresTarget}=await import('../../../scripts/isolated-postgres-target.mjs');
  await verifyIsolatedPostgresTarget(isolatedPostgresTarget(url.href));
  const database=createDatabase(url.href,{ssl:false}),db=database.db;
  const [user]=await db.insert(users).values({email:`scenario-${seed}-${randomUUID()}@example.com`,displayName:'Synthetic scenario'}).returning();
  assert.ok(user,'synthetic user exists');
  try {const scenario=new Scenario(db,user.id,randomUUID(),seed);await scenario.initialize();await run(scenario);}
  finally {try {await db.delete(leases).where(eq(leases.userId,user.id));await db.delete(conversations).where(eq(conversations.userId,user.id));
    await db.delete(cleanups).where(eq(cleanups.userId,user.id));await db.delete(users).where(eq(users.id,user.id));}finally{await database.close();}}
}
