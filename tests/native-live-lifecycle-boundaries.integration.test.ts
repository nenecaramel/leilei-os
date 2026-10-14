import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, conversations, nativeLiveTurnPreparations, nativeLiveRuntimeEvents, nativeLiveProviderSessionCleanups } from "../src/database/schema.js";
import { NativeLiveBackendTurnCoordinator } from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import { DrizzleNativeLiveBackendTurnPort } from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";
import { DrizzleNativeLiveCurrentPathReader } from "../src/domains/conversation/native-live-current-path-read-repository.js";
import fs from "node:fs";
import { nativeLiveTurnResponseData } from "../src/web-api/native-live/turns.js";
const enabled = process.env.RUN_NATIVE_LIVE_TURN_DATABASE_TEST === "1";

test("real prepare exposes detached Send/Edit users and failure evidence survives operational retention", { skip:!enabled }, async t => {
  const database = createDatabase(process.env.DATABASE_URL!,{ssl:false});
  const [user] = await database.db.insert(users).values({email:`boundaries-${crypto.randomUUID()}@example.com`,displayName:"Boundaries"}).returning();
  t.after(async()=>{ await database.db.delete(conversations).where(eq(conversations.userId,user.id)); await database.db.delete(nativeLiveProviderSessionCleanups).where(eq(nativeLiveProviderSessionCleanups.userId,user.id)); await database.db.delete(users).where(eq(users.id,user.id)); await database.close(); });
  const repository = new DrizzleNativeLiveConversationRepository(database.db);
  const port = new DrizzleNativeLiveBackendTurnPort(database.db);
  const coordinator = new NativeLiveBackendTurnCoordinator(port);
  const reader = new DrizzleNativeLiveCurrentPathReader(database.db);
  const fixtures: unknown[] = [];
  for (const outcome of ["failure","success"] as const) for (const operation of ["send","edit","retry"] as const) {
    const conversation = await repository.createConversation({userId:user.id,title:operation});
    const earlierUser = await repository.appendUserMessage({userId:user.id,conversationId:conversation.id,parentMessageId:null});
    await repository.appendContentBlock({userId:user.id,conversationId:conversation.id,messageId:earlierUser.id,ordinal:0,block:{kind:"text",text:"Earlier"}});
    const earlierAnswer = await repository.appendAssistantMessage({userId:user.id,conversationId:conversation.id,parentMessageId:earlierUser.id});
    await repository.appendContentBlock({userId:user.id,conversationId:conversation.id,messageId:earlierAnswer.id,ordinal:0,block:{kind:"text",text:"Earlier answer"}});
    await repository.bindProviderCheckpoint({userId:user.id,conversationId:conversation.id,canonicalMessageId:earlierAnswer.id,checkpoint:{provider:"claude_code",providerSessionId:`earlier-${conversation.id}`,effectiveWorkingDirectory:null}});
    const parent = await repository.appendUserMessage({userId:user.id,conversationId:conversation.id,parentMessageId:earlierAnswer.id});
    await repository.appendContentBlock({userId:user.id,conversationId:conversation.id,messageId:parent.id,ordinal:0,block:{kind:"text",text:"Original"}});
    const oldAnswer = await repository.appendAssistantMessage({userId:user.id,conversationId:conversation.id,parentMessageId:parent.id});
    await repository.appendContentBlock({userId:user.id,conversationId:conversation.id,messageId:oldAnswer.id,ordinal:0,block:{kind:"text",text:"Old answer"}});
    await repository.bindProviderCheckpoint({userId:user.id,conversationId:conversation.id,canonicalMessageId:oldAnswer.id,checkpoint:{provider:"claude_code",providerSessionId:`session-${conversation.id}`,effectiveWorkingDirectory:null}});
    await repository.setCurrentHead({userId:user.id,conversationId:conversation.id,messageId:oldAnswer.id});
    const result = await coordinator.prepare(user.id,{dispatch_target:"claude_code",request_id:crypto.randomUUID(),operation,conversation_id:conversation.id,...(operation === "send" ? {expected_head_message_id:oldAnswer.id,text:"New send"} : operation === "edit" ? {target_user_message_id:parent.id,text:"Edited"} : {target_user_message_id:parent.id})});
    assert.ok(result.ok,JSON.stringify(result)); if (!result.ok) throw Error("prepare");
    const command = result.command;
    const current = await reader.readCurrentPath({userId:user.id,conversationId:conversation.id,limit:100});
    assert.equal(current?.currentHeadMessageId,oldAnswer.id,"prepare does not advance canonical head");
    if (operation !== "retry") assert.ok(!current?.messages.some(m=>m.id===command.canonical_user_message_id),"prepared Send/Edit user is really absent from current path");
    const active = await port.readActiveTurn({userId:user.id,conversationId:conversation.id});
    assert.ok(active);
    const preparedUser = active.preparedUserMessage;
    assert.equal(preparedUser?.id,command.canonical_user_message_id,"owner-scoped active read exposes real detached user");
    assert.equal(active.replacementTargetUserMessageId,operation === "edit" ? parent.id : operation === "retry" ? parent.id : null);
    assert.equal(await port.readTurn({userId:crypto.randomUUID(),prepareId:command.prepare_id}),null);
    await database.db.insert(nativeLiveRuntimeEvents).values([
      {userId:user.id,prepareId:command.prepare_id,sequence:1,eventType:"partial_text",payload:{delta:"Partial answer"}},
      {userId:user.id,prepareId:command.prepare_id,sequence:2,eventType:"tool_use",payload:{tool_use_id:"tool",tool_name:"Read",input:{path:"a.ts"}}},
      {userId:user.id,prepareId:command.prepare_id,sequence:3,eventType:"tool_result",payload:{tool_use_id:"tool",output:"contents"}},
    ]);
    if (outcome === "success") {
      const finalized = await coordinator.finalize(user.id,{protocol_version:command.protocol_version,prepare_id:command.prepare_id,request_id:command.request_id,conversation_id:command.conversation_id,status:"success",provider_session_id:command.runtime_mode === "resume" ? command.parent_provider_session_id! : `final-${conversation.id}`,provider_checkpoint_id:crypto.randomUUID(),normalized_events:[{type:"text",payload:{text:"Partial answer"}},{type:"result",payload:{status:"success",final_text:"Partial answer"}}]});
      assert.ok(finalized.ok,JSON.stringify(finalized));
      const canonical = await reader.readCurrentPath({userId:user.id,conversationId:conversation.id,limit:100});
      fixtures.push({operation,before:current,active:nativeLiveTurnResponseData(active),canonical});
      continue;
    }
    const failed = await coordinator.finalize(user.id,{protocol_version:command.protocol_version,prepare_id:command.prepare_id,request_id:command.request_id,conversation_id:command.conversation_id,status:"failure",error_code:"CLAUDE_PROCESS_FAILED"});
    assert.equal(failed.ok,false); if (failed.ok) throw Error("expected failure"); assert.equal(failed.code,"CLAUDE_PROCESS_FAILED",JSON.stringify(failed));
    const failureRead = await port.readTurn({userId:user.id,prepareId:command.prepare_id});
    assert.equal(failureRead?.canonicalStatus,"finalized_failure");
    assert.equal(failureRead?.assistantMessage,null,"failure does not forge a canonical assistant");
    const path = await reader.readCurrentPath({userId:user.id,conversationId:conversation.id,limit:100});
    const evidence = path?.failedTurn;
    assert.ok(evidence);
    assert.equal(evidence.prepareId,command.prepare_id,"failed turn has a durable current-path overlay");
    assert.ok(evidence.events.some(e=>e.event.type==="partial_text"));
    assert.ok(evidence.events.some(e=>e.event.type==="tool_use"));
    assert.equal(await reader.readCurrentPath({userId:crypto.randomUUID(),conversationId:conversation.id,limit:100}),null,"foreign owner cannot read failure");
    assert.deepEqual((await reader.readCurrentPath({userId:user.id,conversationId:conversation.id,limit:1}))?.failedTurn,evidence,"pagination preserves exact failure lineage");
    await database.db.delete(nativeLiveTurnPreparations).where(eq(nativeLiveTurnPreparations.id,command.prepare_id));
    const reopened = await reader.readCurrentPath({userId:user.id,conversationId:conversation.id,limit:100});
    assert.deepEqual(reopened?.failedTurn,evidence,"failure body and execution evidence survive all operational retention");
    fixtures.push({operation,before:current,active:nativeLiveTurnResponseData(active),failed:path,reopened});
    if (operation === "retry") {
      const prepareSend = async () => {
        const prepared = await coordinator.prepare(user.id,{dispatch_target:"claude_code",request_id:crypto.randomUUID(),operation:"send",conversation_id:conversation.id,expected_head_message_id:oldAnswer.id,text:"Next"});
        assert.ok(prepared.ok,JSON.stringify(prepared)); if (!prepared.ok) throw Error("prepare"); return prepared.command;
      };
      const older = await prepareSend();
      assert.equal((await reader.readCurrentPath({userId:user.id,conversationId:conversation.id,limit:100}))?.failedTurn,null,"new preparation clears old durable failure atomically");
      const newer = await prepareSend();
      const fail = (c:typeof newer) => coordinator.finalize(user.id,{protocol_version:c.protocol_version,prepare_id:c.prepare_id,request_id:c.request_id,conversation_id:c.conversation_id,status:"failure",error_code:"CLAUDE_PROCESS_FAILED"});
      await fail(older);
      assert.equal((await reader.readCurrentPath({userId:user.id,conversationId:conversation.id,limit:100}))?.failedTurn,null,"late older failure cannot reclaim newer preparation ownership");
      await fail(newer);
      assert.equal((await reader.readCurrentPath({userId:user.id,conversationId:conversation.id,limit:100}))?.failedTurn?.prepareId,newer.prepare_id);
      const changedHead = await prepareSend();
      await fail(newer);
      assert.equal((await reader.readCurrentPath({userId:user.id,conversationId:conversation.id,limit:100}))?.failedTurn,null,"idempotent older finalization cannot revive cleared overlay");
      await repository.setCurrentHead({userId:user.id,conversationId:conversation.id,messageId:earlierAnswer.id});
      await fail(changedHead);
      assert.equal((await reader.readCurrentPath({userId:user.id,conversationId:conversation.id,limit:100}))?.failedTurn,null,"failure cannot attach itself to a changed canonical head");
    }
  }
  if (process.env.LIFECYCLE_BOUNDARY_FIXTURES) fs.writeFileSync(process.env.LIFECYCLE_BOUNDARY_FIXTURES,JSON.stringify(fixtures));
});
