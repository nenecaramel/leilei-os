import assert from "node:assert/strict";
import test from "node:test";
import {normalizeClaudeEvents} from "../src/normalized-events.mjs";

// Shapes checked against installed Agent SDK 0.3.286 and Anthropic 0.128.0 Beta declarations.
// Input/tool-result parts below are compatibility contract fixtures, NOT universal assistant output.
const citation={type:"web_search_result_location",encrypted_index:"sdk-index",url:"https://example.test/source",title:"Source",cited_text:"provider quote"};
const contractParts=[{type:"search_result",title:"Search",source:"https://example.test/source",content:[{type:"text",text:"provider snippet"}]},
 {type:"citation",...citation},{type:"generated_file",path:"report.pdf",mime_type:"application/pdf"},
 {type:"resource_link",uri:"ui://reference",name:"Resource"},{type:"future_content",answer:42}];
test("SDK assistant text citations and result-level structured_output retain independent truth",()=>{
 const events=normalizeClaudeEvents([{type:"assistant",message:{content:[{type:"text",text:"Answer",citations:[citation]}]}},{type:"result",subtype:"success",result:"Answer",structured_output:{answer:42}}],{logicalConversationId:"c",mode:"new"});
 assert.deepEqual(events[0].payload.citations.payload,[citation]);
 assert.deepEqual(events.at(-1).payload.structured_output.payload,{answer:42});
 assert.ok(events.every(e=>!e.payload.conversation_projection));
});
test("tool-result compatibility fixtures retain ordered search/citation/generated/resource/future parts without projection",()=>{
 // citation is a normalized compatibility part; Anthropic web citations are text relations.
 const parts=[contractParts[0],{type:"citation",citation},...contractParts.slice(2)];
 const events=normalizeClaudeEvents([{type:"user",message:{content:[{type:"tool_result",tool_use_id:"t",content:parts,conversation_projection:{schema_version:1,identity:"canonical_tool_result",reason:"explicit_share",refs:[]}}]}}],{logicalConversationId:"c",mode:"new"});
 const result=events.find(e=>e.type==="tool_result");
 assert.deepEqual(result.payload.structured.parts.map(p=>p.type),["search_result","citation","generated_file","resource_link","unsupported"]);
 assert.equal(result.payload.structured.parts[3].capability,"reference_only");
 assert.equal(result.payload.structured.parts[4].raw_type,"future_content");
 assert.equal(result.payload.conversation_projection,undefined);
});
