import type { RequestHandler } from "express";
import type { NativeLiveRelayInternalDependencies } from "./dependencies.js";
import { requireInternalUser, parseReservationId, exactRecord, isUuid, sendInvalid } from "./http.js";
import { sendRuntimeControlError } from "./controls.js";
export function waitTaskControlHandler(dependencies: NativeLiveRelayInternalDependencies): RequestHandler {
  return async (request,response) => {
    const userId=requireInternalUser(response,request.mcpUserId); if (!userId) return;
    const body=exactRecord(request.body,["listener_instance_id","bindings"]);
    if (!body || !isUuid(body.listener_instance_id) || !Array.isArray(body.bindings) || body.bindings.length>4 || !body.bindings.length) { sendInvalid(response);return; }
    const bindings: {conversationId:string;providerSessionId:string;generationId:string}[]=[];
    for (const value of body.bindings) {
      const b=exactRecord(value,["conversationId","providerSessionId","generationId"]);
      if (!b || !isUuid(b.conversationId) || !isUuid(b.generationId) || typeof b.providerSessionId!=="string" || !b.providerSessionId.length || b.providerSessionId.length>1024) {sendInvalid(response);return;}
      bindings.push({conversationId:b.conversationId,providerSessionId:b.providerSessionId,generationId:b.generationId});
    }
    const controller=new AbortController(), close=()=>controller.abort(); response.once("close",close);
    try {
      if (!dependencies.runtimeControlService?.waitTaskForListener) {response.status(503).json({success:false});return;}
      const data=await dependencies.runtimeControlService.waitTaskForListener({userId,listenerInstanceId:body.listener_instance_id,bindings,timeoutMs:25_000,signal:controller.signal});
      if (!controller.signal.aborted) response.json({success:true,data});
    } catch(error) { if (!controller.signal.aborted) sendRuntimeControlError(response,error); }
    finally {response.off("close",close);}
  };
}
export function taskAdmissionHandler(dependencies: NativeLiveRelayInternalDependencies): RequestHandler {
 return async(request,response)=>{
  const userId=requireInternalUser(response,request.mcpUserId);if(!userId)return;
  const prepareId=parseReservationId(request.params.reservationId),body=exactRecord(request.body,["listener_instance_id","provider_session_id"]);
  if(!prepareId||!body||!isUuid(body.listener_instance_id)||typeof body.provider_session_id!=="string"||!body.provider_session_id.length||body.provider_session_id.length>1024){sendInvalid(response);return;}
  try{const admitted=await dependencies.runtimeControlService?.checkTaskAdmission?.({userId,prepareId,listenerInstanceId:body.listener_instance_id,providerSessionId:body.provider_session_id});response.json({success:true,data:{admitted:admitted===true}});}
  catch{response.status(503).json({success:false,error:{code:"TASK_ADMISSION_UNAVAILABLE"}});}
 };
}
