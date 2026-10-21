import { verifyCompletedNativeTurn } from './completed-turn-proof.mjs';
import { ClaudeEventNormalizer } from './normalized-events.mjs';

/** Rebuild only an already proved, stopped writer's completed turn. */
export function recoverCompletedNativeTurn(input) {
 const proof=verifyCompletedNativeTurn(input);if(!proof)return null;
 try {
  const normalizer=new ClaudeEventNormalizer({logicalConversationId:input.sessionId,mode:'resume',parentProviderSessionId:input.sessionId});
  const normalizedEvents=proof.events.flatMap(e=>normalizer.normalize(e));
  if(!normalizedEvents.some(e=>e.type==='text'))return null;
  return {providerCheckpointId:proof.providerCheckpointId,result:{providerSessionId:input.sessionId,inputId:input.inputId,
   result:{type:'result',subtype:'success',session_id:input.sessionId,user_message_uuid:input.inputId,recovered_from_native:true},events:proof.events,normalizedEvents}};
 }catch{return null;}
}
