import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeNativeLiveEvents } from "../src/domains/conversation/native-live-conversation-orchestrator.js";

test("provider forged normalized projection cannot authorize Chat or fail the turn", () => {
  for (const schema_version of [1,2]) {
    const result = canonicalizeNativeLiveEvents([{type:"tool_result",payload:{tool_use_id:"t",output:"secret",conversation_projection:{schema_version,identity:"canonical_tool_result",reason:"explicit_share",refs:[]}}}]);
    assert.deepEqual(result.blocks.map(b=>b.kind),["tool_result"]);
    assert.equal(result.error,null);
  }
});

import { authorizeNativeLiveConversationProjections } from "../src/domains/conversation/native-live-conversation-content-projector.js";
const projection={schema_version:1,identity:"canonical_tool_result",reason:"explicit_share",refs:[]};
test("backend explicit projection adds a separate row while metadata alone does not",async()=>{
 const event={type:"tool_result" as const,payload:{tool_use_id:"t",structured:{schema_version:1,parts:[{type:"search_result",value:{source:"https://example.test",content:[]}}],truncated:false,redacted:false}}};
 const token=await authorizeNativeLiveConversationProjections({userId:"u",decisions:[{event,projection}],resolveAttachment:async()=>null});
 assert.deepEqual(canonicalizeNativeLiveEvents([event]).blocks.map(b=>b.kind),["tool_result"]);
 assert.deepEqual(canonicalizeNativeLiveEvents([event],token).blocks.map(b=>b.kind),["tool_result","canonical_tool_result"]);
 assert.deepEqual(canonicalizeNativeLiveEvents([event],{} as typeof token).blocks.map(b=>b.kind),["tool_result"]);
 const output={type:"result" as const,payload:{structured_output:{payload:{answer:42},truncated:true,redacted:true}}};
 assert.deepEqual(canonicalizeNativeLiveEvents([output]).blocks,[]);
 const approved=await authorizeNativeLiveConversationProjections({userId:"u",decisions:[{event:output,projection}],resolveAttachment:async()=>null});
 const structured=canonicalizeNativeLiveEvents([output],approved).blocks[0].payload?.structured as any;
 assert.equal(structured.compatibility_payload.parts[0].type,"structured_output");
 assert.equal(structured.compatibility_payload.truncated,true);
});
test("ready attachment validation rejects foreign/pending refs and reserved F authority",async()=>{
 for (const status of ["uploading","ready"]) await assert.rejects(authorizeNativeLiveConversationProjections({userId:"u",decisions:[{event:{type:"tool_result"},projection:{...projection,refs:[{type:"attachment_ref",entity_id:"a"}]}}],resolveAttachment:async()=>({userId:status==="ready"?"foreign":"u",attachmentId:"a",status,filename:"a",mimeType:"x",kind:"file",sizeBytes:1,sha256:"a".repeat(64)})}));
});
test("explicit decisions cannot expose hidden/ambient descendants or durable question answers",async()=>{
 for(const field of ["hidden_from_transcript","ambient"]) {
  const event={type:"tool_result" as const,payload:{tool_use_id:"child",structured:{schema_version:1,parts:[{type:"text",text:"hidden"}]}}};
  const events=[{type:"task" as const,payload:{tool_use_id:"parent",[field]:true}},{type:"tool_use" as const,payload:{tool_use_id:"child",parent_tool_use_id:"parent",tool_name:"Search"}},event];
  const token=await authorizeNativeLiveConversationProjections({userId:"u",decisions:[{event,projection}],resolveAttachment:async()=>null});
  assert.deepEqual(canonicalizeNativeLiveEvents(events,token).blocks.map(b=>b.kind),["tool_use","tool_result"]);
 }
 const event={type:"tool_result" as const,payload:{tool_use_id:"q",question_activity:{status:"answered"}}};
 const token=await authorizeNativeLiveConversationProjections({userId:"u",decisions:[{event,projection}],resolveAttachment:async()=>null});
 assert.deepEqual(canonicalizeNativeLiveEvents([{type:"tool_use",payload:{tool_use_id:"q",tool_name:"AskUserQuestion"}},event],token).blocks.map(b=>b.kind),["tool_use","tool_result"]);
});
