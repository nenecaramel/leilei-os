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

import {storedContentPayload} from "../src/domains/conversation/native-live-content-contract.js";
test("durable structured envelopes preserve small semantic values through storage rebounding",async()=>{
 const event={type:"tool_result" as const,payload:{structured:{schema_version:1,parts:[{type:"search_result",value:{source:"https://example.test",content:[{type:"text",text:"durable snippet"}]}},{type:"citation",value:{type:"citation",citation:{type:"web_search_result_location",url:"https://example.test",cited_text:"durable quote",encrypted_index:"real-id"}}},{type:"json",value:{outer:{inner:42}}}],truncated:false,redacted:false}}};
 const token=await authorizeNativeLiveConversationProjections({userId:"u",decisions:[{event,projection}],resolveAttachment:async()=>null});
 const projected=canonicalizeNativeLiveEvents([event],token).blocks[1];
 const stored=storedContentPayload(projected.kind,projected.payload ?? null) as any;
 assert.equal(stored.structured.compatibility_payload.parts[0].value.content[0].text,"durable snippet");
 assert.equal(stored.structured.compatibility_payload.parts[1].value.citation.cited_text,"durable quote");
 assert.equal(stored.structured.compatibility_payload.parts[2].value.outer.inner,42);
});


test("top-level provider search events project into Chat without tool-result share authority", () => {
  const event = {
    type: "search_result" as const,
    payload: {
      provenance: {
        provider: "claude_code",
        raw_type: "web_search_tool_result",
      },
      structured: {
        schema_version: 1,
        parts: [{
          type: "search_result",
          value: {
            type: "search_result",
            title: "Provider result",
            url: "https://example.test/provider",
            source: "https://example.test/provider",
            snippet: "Durable provider snippet",
          },
        }],
      },
    },
  };

  const result = canonicalizeNativeLiveEvents([event]);
  assert.equal(result.error, null);
  assert.deepEqual(
    result.blocks.map((block) => block.kind),
    ["canonical_tool_result"],
  );
  assert.equal(
    result.blocks[0]?.payload?.projection_reason,
    "provider_visible_search",
  );
  const structured =
    result.blocks[0]?.payload?.structured as any;
  assert.equal(
    structured.compatibility_payload.parts[0].type,
    "search_result",
  );
  assert.equal(
    structured.compatibility_payload.parts[0].value.snippet,
    "Durable provider snippet",
  );
});

test("provider search projection rejects nested or mixed structured content", () => {
  const searchPart = {
    type: "search_result",
    value: {
      type: "search_result",
      title: "Result",
      url: "https://example.test",
    },
  };

  const nested = canonicalizeNativeLiveEvents([{
    type: "search_result",
    payload: {
      provenance: {
        provider: "claude_code",
        raw_type: "web_search_tool_result",
        parent_agent_id: "researcher",
      },
      structured: {
        schema_version: 1,
        parts: [searchPart],
      },
    },
  }]);
  assert.deepEqual(nested.blocks, []);

  const mixed = canonicalizeNativeLiveEvents([{
    type: "search_result",
    payload: {
      provenance: {
        provider: "claude_code",
        raw_type: "web_search_tool_result",
      },
      structured: {
        schema_version: 1,
        parts: [
          searchPart,
          { type: "json", value: { secret: true } },
        ],
      },
    },
  }]);
  assert.deepEqual(mixed.blocks, []);
});
