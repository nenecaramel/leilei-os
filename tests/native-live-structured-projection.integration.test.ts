import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {normalizeClaudeEvents} from "../tools/claude-bridge/src/normalized-events.mjs";
import { and,eq } from "drizzle-orm";
import {createDatabase} from "../src/database/client.js";
import {users,conversations,nativeLiveChatAttachments} from "../src/database/schema.js";
import {DrizzleNativeLiveConversationRepository} from "../src/domains/conversation/native-live-conversation-repository.js";
import {NativeLiveConversationService} from "../src/domains/conversation/native-live-conversation-service.js";
import {DrizzleNativeLiveCurrentPathReader} from "../src/domains/conversation/native-live-current-path-read-repository.js";
import {canonicalizeNativeLiveEvents} from "../src/domains/conversation/native-live-conversation-orchestrator.js";
import {authorizeNativeLiveConversationProjections} from "../src/domains/conversation/native-live-conversation-content-projector.js";

test("real Postgres preserves execution backing plus separately authorized structured Chat content",{skip:process.env.RUN_NATIVE_LIVE_CONVERSATION_DATABASE_TEST !== "1"},async t=>{
 assert.ok(process.env.DATABASE_URL);
 const database=createDatabase(process.env.DATABASE_URL,{ssl:false});
 const [user]=await database.db.insert(users).values({email:`d-${crypto.randomUUID()}@example.test`,displayName:"D fixture"}).returning();
 t.after(async()=>{try {await database.db.delete(conversations).where(eq(conversations.userId,user.id));await database.db.delete(nativeLiveChatAttachments).where(eq(nativeLiveChatAttachments.userId,user.id));await database.db.delete(users).where(eq(users.id,user.id));}finally{await database.close();}});
 const repository=new DrizzleNativeLiveConversationRepository(database.db),service=new NativeLiveConversationService(repository);
 const attachmentId=crypto.randomUUID();
 await database.db.insert(nativeLiveChatAttachments).values({id:attachmentId,userId:user.id,objectKey:`d/${attachmentId}`,filename:"report.pdf",mimeType:"application/pdf",sizeBytes:3,sha256:"a".repeat(64),kind:"file",status:"ready",readyAt:new Date(),expiresAt:new Date(Date.now()+60000)});
 for(const mode of ["none","forged","approved"]){
  const conversation=await service.createConversation({userId:user.id});
  const parent=await service.appendUserMessage({userId:user.id,conversationId:conversation.id,parentMessageId:null,blocks:[{kind:"text",text:mode}]});
  const projection={schema_version:1,identity:"canonical_tool_result",reason:"materialized_send",refs:[{type:"attachment_ref",entity_id:attachmentId}]};
  // Real input/tool-result shapes plus explicitly labeled citation/generated compatibility parts.
  const citation={type:"web_search_result_location",url:"https://example.test",encrypted_index:"provider-id",cited_text:"durable quote"};
  const event=normalizeClaudeEvents([{type:"user",message:{content:[{type:"tool_result",tool_use_id:"tool",content:[
    {type:"search_result",source:"https://example.test",content:[{type:"text",text:"durable snippet"}]},
    {type:"citation",citation}, {outer:{inner:42}},
    {type:"structured_output",value:42,label:"answer"},
    {type:"generated_file",ref:projection.refs[0]}
  ]}]}}],{logicalConversationId:"c",mode:"new"}).find(e=>e.type === "tool_result")!;
  if(mode === "forged") event.payload.conversation_projection=projection;
  const authority=mode==="approved" ? await authorizeNativeLiveConversationProjections({userId:user.id,decisions:[{event,projection}],resolveAttachment:async(userId,id)=>{
   const [row]=await database.db.select().from(nativeLiveChatAttachments).where(and(eq(nativeLiveChatAttachments.userId,userId),eq(nativeLiveChatAttachments.id,id)));
   return row?{...row,attachmentId:row.id}:null;
  }}):undefined;
  const canonical=canonicalizeNativeLiveEvents([{type:"tool_use",payload:{tool_use_id:"tool",tool_name:"Search",input:{query:"q"}}},event],authority);
  assert.equal(canonical.error,null);
  await service.completeAssistantTurn({userId:user.id,conversationId:conversation.id,parentMessageId:parent.id,blocks:canonical.blocks,checkpoint:{provider:"claude_code",providerSessionId:`fixture-${mode}`}});
  const read=await new DrizzleNativeLiveCurrentPathReader(database.db).readCurrentPath({userId:user.id,conversationId:conversation.id,limit:20});
  const blocks=read!.messages.at(-1)!.blocks;
  assert.deepEqual(blocks.map(b=>b.kind),mode==="approved"?["tool_use","tool_result","canonical_tool_result"]:["tool_use","tool_result"]);
  assert.deepEqual(blocks[1].payload?.structured,event.payload.structured);
  if(mode==="approved") {
   assert.equal((blocks[2].payload?.materialized_attachments as any[])[0].attachment_id,attachmentId);
   if(process.platform === "darwin") {
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),"leilei-durable-structured-"));
    try {
     fs.writeFileSync(path.join(temp,"blocks.json"),JSON.stringify(blocks));
     fs.copyFileSync("tests/fixtures/native-live-structured-presentation.swift",path.join(temp,"main.swift"));
     const root="ios/LeileiOS/LeileiOS/";
     const files=["NativeLiveMediaPresentation","NativeLiveAttachmentCache","NativeLiveMarkdownModel", "NativeLiveRichTextProjection", "NativeLiveVisualNode","NativeLiveStructuredToolResult","NativeLiveCitationPresentation","NativeLiveStructuredJSON","NativeLiveMessagePresentation","NativeLiveMessagePresentationProjection"].map(n=>root+"Chat/MessageSurface/"+n+".swift");
     const built=spawnSync("xcrun",["swiftc","-module-cache-path",path.join(temp,"cache"),root+"Infrastructure/NativeLiveRuntimeModels.swift",root+"Infrastructure/API/NativeLive/NativeLiveModels.swift",root+"Infrastructure/API/NativeLive/NativeLiveInputMode.swift",...files,path.join(temp,"main.swift"),"-o",path.join(temp,"check")],{encoding:"utf8",timeout:120000});
     assert.equal(built.status,0,built.stderr);
     const ran=spawnSync(path.join(temp,"check"),[path.join(temp,"blocks.json")],{encoding:"utf8",timeout:60000});
     assert.equal(ran.status,0,ran.stderr);assert.match(ran.stdout,/Durable structured presentation PASS/);
    } finally {fs.rmSync(temp,{recursive:true,force:true});}
   }
  }
 }
});
