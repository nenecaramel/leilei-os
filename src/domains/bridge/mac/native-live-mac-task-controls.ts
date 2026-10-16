import { setTimeout as delay } from "node:timers/promises";
import type { NativeLiveMacSessionRegistry } from "./native-live-mac-session-registry.js";
import type { NativeLiveTaskBinding } from "../runtime-interaction/native-live-task-control-repository.js";
export type NativeLiveMacTaskControl = { controlId: string; prepareId: string; payload: Record<string, unknown> };
export type NativeLiveMacTaskRelay = {
  waitTaskControl(input:{listenerInstanceId:string;bindings:NativeLiveTaskBinding[];signal:AbortSignal}):Promise<NativeLiveMacTaskControl|null>;
  completeRuntimeControl(input:{listenerInstanceId:string;reservationId:string;controlId:string;outcome:{status:"applied";receipt:Record<string,unknown>}|{status:"failed";failureCode:string}}):Promise<void>;
};
/** Control RPC only: never a model input, fork, or task replay. */
export async function executeNativeLiveMacTaskControl(registry:NativeLiveMacSessionRegistry,control:NativeLiveMacTaskControl,signal:AbortSignal):Promise<Record<string,unknown>> {
  const p=control.payload;
  if (typeof p.conversationId!=="string" || typeof p.generationId!=="string" || typeof p.providerSessionId!=="string") throw Error("Task identity is invalid.");
  const binding=registry.get(p.conversationId,p.generationId);
  const assertLive=()=>{if(signal.aborted || !binding || registry.get(p.conversationId as string,p.generationId as string)!==binding || binding.session.sessionId!==p.providerSessionId)throw Error("Task session was retired or changed identity.");};
  assertLive();const session=binding!.session;
  let receipt:Record<string,unknown>;
  if(p.action==="list"){
    if(!session.listTasks)throw Error("Task controls unavailable.");
    receipt={tasks:session.listTasks().map(task=>({...task,description:task.description?.slice(0,512)??null,summary:task.summary?.slice(0,512)??null}))};
  }else if((p.action==="output"||p.action==="stop")&&typeof p.taskId==="string"&&typeof p.handle==="string"){
    if(p.action==="output"){
      if(!session.readTaskOutput)throw Error("Task output unavailable.");
      receipt=await session.readTaskOutput(p.taskId,{handle:p.handle,signal});
    }else{
      if(!session.stopTask)throw Error("Task stop unavailable.");
      await session.stopTask(p.taskId,{handle:p.handle});receipt={accepted:true};
    }
  }else throw Error("Task control action invalid.");
  assertLive();return {generationId:p.generationId,...receipt};
}
export async function runNativeLiveMacTaskControls(input:{registry:NativeLiveMacSessionRegistry;relay:NativeLiveMacTaskRelay;listenerInstanceId:string;signal:AbortSignal}):Promise<void>{
 while(!input.signal.aborted){
  try{
    const bindings=input.registry.snapshot().flatMap(b=>b.session.sessionId?[{conversationId:b.conversationId,providerSessionId:b.session.sessionId,generationId:b.generationId}]:[]);
    if(!bindings.length){await input.registry.waitForChange(input.signal);continue;}
    const control=await input.relay.waitTaskControl({listenerInstanceId:input.listenerInstanceId,bindings,signal:input.signal});
    if(!control)continue;
    let outcome:Parameters<NativeLiveMacTaskRelay["completeRuntimeControl"]>[0]["outcome"];
    try{outcome={status:"applied",receipt:await executeNativeLiveMacTaskControl(input.registry,control,input.signal)};}
    catch{outcome={status:"failed",failureCode:"TASK_UNAVAILABLE_OR_OUTCOME_UNKNOWN"};}
    // A lost completion response never repeats the SDK command. The server leaves
    // a reserved control unknown; a later list observes actual SDK state.
    await input.relay.completeRuntimeControl({listenerInstanceId:input.listenerInstanceId,reservationId:control.prepareId,controlId:control.controlId,outcome});
  }catch{
    if(!input.signal.aborted)await delay(1000,undefined,{signal:input.signal}).catch(()=>{});
  }
 }
}
