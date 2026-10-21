import { durableCheckpointPrefix } from './provider-checkpoint-prefix.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Read-only salvage after verified writer closure. No success is inferred from
 * visible text alone: require an exact input, ancestry and native end_turn. */
export function verifyCompletedNativeTurn({entries,sessionId,inputId,parentCheckpointId}) {
 if(![sessionId,inputId].every(v=>typeof v==='string'&&uuid.test(v)) || !(parentCheckpointId===null||uuid.test(parentCheckpointId??''))
   || !Array.isArray(entries) || entries.length>100000)return null;
 try {
  if(Buffer.byteLength(JSON.stringify(entries))>64*1024*1024)return null;
  const cleanStop=e=>e.type==='system'&&e.subtype==='stop_hook_summary'&&e.preventedContinuation===false&&(!e.hookErrors||Array.isArray(e.hookErrors)&&e.hookErrors.length===0);
  // The CLI can append a prompt_snapshot after a completed reply (and before
  // its Stop summary). It is metadata, never evidence of completion itself.
  const trailer=e=>cleanStop(e)||(e.type==='attachment'&&(e.attachment?.type==='prompt_snapshot'
    ||e.attachment?.type==='hook_success'&&e.attachment.hookEvent==='Stop'&&e.attachment.exitCode===0));
  const carriers=entries.filter(e=>e&&!e.isSidechain&&['user','assistant','system','attachment'].includes(e.type)&&typeof e.uuid==='string'&&Object.hasOwn(e,'parentUuid'));
  const ids=new Set();for(const e of carriers){if(ids.has(e.uuid)||!uuid.test(e.uuid)||(e.sessionId&&e.sessionId!==sessionId))return null;ids.add(e.uuid);}
  const last=carriers.at(-1);
  // A trailing hook/summary may be incomplete or blocked; do not guess through it.
  // Select only a final end_turn assistant when no further input is present.
  const final=carriers.findLast(e=>['user','assistant'].includes(e.type)&&!e.isMeta&&!e.isCompactSummary);
  if(!final||final.type!=='assistant'||final.isApiErrorMessage===true||!Array.isArray(final.message?.content)
    ||final.message.content.some(b=>b?.type==='tool_use'))return null;
  const verified=durableCheckpointPrefix(entries,last.uuid);
  if(!verified.ancestry.has(final.uuid)||!verified.ancestry.has(inputId)||(parentCheckpointId!==null&&!verified.ancestry.has(parentCheckpointId)))return null;
  const input=carriers.find(e=>e.uuid===inputId);
  if(input?.type!=='user'||input.isMeta||input.isCompactSummary)return null;
  const byId=new Map(carriers.map(e=>[e.uuid,e]));
  for(let at=input.parentUuid;at!==parentCheckpointId;){const e=byId.get(at);if(!e||!trailer(e))return null;at=e.parentUuid;}
  const chain=carriers.filter(e=>verified.ancestry.has(e.uuid));
  const start=chain.findIndex(e=>e.uuid===inputId),end=chain.findIndex(e=>e.uuid===final.uuid);
  if(start<0||end<=start)return null;
  const turnIds=new Set(chain.slice(start+1,end+1).map(e=>e.uuid));
  // The shared checkpoint projector also proves unique parallel tool results
  // hanging off a current-turn call outside the final ancestor chain.
  const turn=verified.prefix.filter(e=>turnIds.has(e.uuid)||(e.type==='user'&&turnIds.has(e.parentUuid)
    &&Array.isArray(e.message?.content)&&e.message.content.length&&e.message.content.every(b=>b?.type==='tool_result')));
  if(turn.some(e=>e.type==='user'&&!e.isMeta&&(!Array.isArray(e.message?.content)||!e.message.content.length||!e.message.content.every(b=>b?.type==='tool_result'))))return null;
  const trailing=chain.slice(end+1);
  if(trailing.some(e=>!trailer(e))||!(final.message.stop_reason==='end_turn'||final.message.stop_reason===null&&trailing.some(cleanStop)))return null;
  const calls=new Set();
  for(const e of turn){for(const b of Array.isArray(e.message?.content)?e.message.content:[]){
   if(e.type==='assistant'&&b?.type==='tool_use'){if(typeof b.id!=='string'||calls.has(b.id))return null;calls.add(b.id);}
   if(e.type==='user'&&b?.type==='tool_result'){if(!calls.delete(b.tool_use_id))return null;}
  }}
  if(calls.size)return null;
  const events=turn.filter(e=>['assistant','user'].includes(e.type)).map(e=>({...e,session_id:sessionId}));
  if(Buffer.byteLength(JSON.stringify(events))>2*1024*1024||!events.some(e=>e.type==='assistant'&&e.message?.content?.some(b=>b?.type==='text'&&typeof b.text==='string'&&b.text.length)))return null;
  return {providerCheckpointId:final.uuid,events};
 }catch{return null;}
}
