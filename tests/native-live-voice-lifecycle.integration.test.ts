import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, conversations, nativeLiveProviderSessionCleanups, nativeLiveBackgroundModelJobs } from "../src/database/schema.js";
import { NativeLiveBackendTurnCoordinator } from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import { DrizzleNativeLiveBackendTurnPort } from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";
import { NativeLiveConversationService } from "../src/domains/conversation/native-live-conversation-service.js";
import { DefaultNativeLiveMindRuntime } from "../src/domains/runtime/mind/native-live-mind-runtime.js";
import { NativeLiveMindLoopService } from "../src/domains/runtime/mind/native-live-mind-loop-service.js";

test("canonical voice survives retry, keyboard edit becomes text, and idempotency distinguishes voice", {skip:process.env.RUN_NATIVE_LIVE_TURN_DATABASE_TEST !== "1"}, async t => {
  assert.ok(process.env.DATABASE_URL);
  const database=createDatabase(process.env.DATABASE_URL,{ssl:false});
  const [user]=await database.db.insert(users).values({email:`voice-${crypto.randomUUID()}@example.com`,displayName:"Voice regression"}).returning();
  t.after(async()=>{try{await database.db.delete(nativeLiveBackgroundModelJobs).where(eq(nativeLiveBackgroundModelJobs.userId,user.id));await database.db.delete(nativeLiveProviderSessionCleanups).where(eq(nativeLiveProviderSessionCleanups.userId,user.id));await database.db.delete(conversations).where(eq(conversations.userId,user.id));await database.db.delete(users).where(eq(users.id,user.id));}finally{await database.close();}});
  const service=new NativeLiveConversationService(new DrizzleNativeLiveConversationRepository(database.db));
  const conversation=await service.createConversation({userId:user.id,title:"Voice regression"});
  const port=new DrizzleNativeLiveBackendTurnPort(database.db);
  const coordinator=new NativeLiveBackendTurnCoordinator(port,()=>crypto.randomUUID());
  const request={dispatch_target:"claude_code" as const,operation:"send" as const,request_id:crypto.randomUUID(),conversation_id:conversation.id,expected_head_message_id:null,text:"我今天好累"};
  const voice=await coordinator.prepare(user.id,{...request,input_mode:"voice"});
  assert.ok(voice.ok); if(!voice.ok)throw new Error("voice prepare failed");
  assert.equal(voice.command.prompt,"我今天好累");
  const replay=await coordinator.prepare(user.id,{...request,input_mode:"voice"});
  assert.ok(replay.ok);if(replay.ok)assert.equal(replay.outcome,"replayed");
  const conflict=await coordinator.prepare(user.id,request);
  assert.deepEqual(conflict,{ok:false,code:"REQUEST_CONFLICT",requestId:request.request_id,operation:"send",conversationId:conversation.id});
  const mind=new DefaultNativeLiveMindRuntime(new NativeLiveMindLoopService({async list(){return []},async append(){},async transition(){},async saveContextManifest(){}},{assemblyVersion:"voice-test",promptContractVersion:"voice-test",ruleVersion:"test",processVersion:"test",breathLimit:3,maxContextItems:16,maxContextChars:8000}),{subjectId:"G"});
  async function readPrompt(id:string){
    const current=await service.getConversation({userId:user.id,conversationId:conversation.id});assert.ok(current);
    const message=current.messages.find(m=>m.id===id);assert.ok(message);
    const prompt=await mind.prepareUserTurn({userId:user.id,conversation:current,userMessage:message,userText:message.blocks[0].text!,surfaceHeadMessageId:message.parentMessageId});
    return {message,prompt};
  }
  const original=await readPrompt(voice.command.canonical_user_message_id);
  assert.deepEqual(original.message.blocks[0].payload,{input_mode:"voice"});
  assert.match(original.prompt,/<user_message input_mode="voice">\[voice\] /);
  async function finalize(command:typeof voice.command){
    const result=await coordinator.finalize(user.id,{protocol_version:4,prepare_id:command.prepare_id,request_id:command.request_id,conversation_id:conversation.id,status:"success",provider_session_id:command.runtime_mode === "resume" ? command.parent_provider_session_id! : `voice-test-${crypto.randomUUID()}`,provider_checkpoint_id:crypto.randomUUID(),normalized_events:[{type:"text",payload:{text:"answer"}},{type:"result",payload:{status:"success",final_text:"answer"}}]});assert.ok(result.ok);
  }
  await finalize(voice.command);
  const retry=await coordinator.prepare(user.id,{dispatch_target:"claude_code",operation:"retry",request_id:crypto.randomUUID(),conversation_id:conversation.id,target_user_message_id:voice.command.canonical_user_message_id});
  assert.ok(retry.ok);if(!retry.ok)throw new Error("retry failed");
  assert.equal(retry.command.canonical_user_message_id,voice.command.canonical_user_message_id);
  assert.match((await readPrompt(retry.command.canonical_user_message_id)).prompt,/<user_message input_mode="voice">\[voice\] /);
  await finalize(retry.command);
  const edit=await coordinator.prepare(user.id,{dispatch_target:"claude_code",operation:"edit",request_id:crypto.randomUUID(),conversation_id:conversation.id,target_user_message_id:voice.command.canonical_user_message_id,text:"键盘编辑"});
  assert.ok(edit.ok);if(!edit.ok)throw new Error("edit failed");
  const edited=await readPrompt(edit.command.canonical_user_message_id);
  assert.equal(edited.message.blocks[0].payload,null);
  assert.match(edited.prompt,/<user_message>/);
  assert.doesNotMatch(edited.prompt,/input_mode=/);
  assert.doesNotMatch(edited.prompt,/\[voice\]/);
});
