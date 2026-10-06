import assert from "node:assert/strict";
import test from "node:test";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { readTurn } from "../src/domains/bridge/turn/turn-repository/reads.js";
import type { TurnRepositoryContext } from "../src/domains/bridge/turn/turn-repository/types.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";

const owner = "owner", conversationId = "conversation", userId = "detached-user", assistantId = "final-assistant";
const date = new Date("2026-10-04T00:00:00Z");
for (const terminal of [false,true]) test(`turn read targets only exact ${terminal ? "user and terminal assistant" : "detached prepared user"} without a conversation scan`, async t => {
  t.mock.method(DrizzleNativeLiveConversationRepository.prototype,"getConversation",async()=>{ throw Error("full conversation read forbidden on wait hot path"); });
  const messages = [
    {id:userId,conversationId,parentMessageId:"old-head",role:"user",status:"completed",createdAt:date,completedAt:date},
    ...(terminal ? [{id:assistantId,conversationId,parentMessageId:userId,role:"assistant",status:"completed",createdAt:date,completedAt:date}] : []),
  ];
  const blocks = messages.flatMap(m=>[
    {id:m.id+":0",messageId:m.id,ordinal:0,kind:"text",rawType:"text",text:m.id,payload:null,createdAt:date},
    {id:m.id+":1",messageId:m.id,ordinal:1,kind:"tool_use",rawType:"tool_use",text:null,payload:{tool_use_id:"tool",input:{path:"a"}},createdAt:date},
  ]);
  const queries: Array<{table:string;where?:SQL;joins:SQL[]}> = [];
  const preparation = {id:"prepare",createdAt:date,requestId:"request",conversationId,operation:"send",canonicalUserMessageId:userId,replacementTargetUserMessageId:null,assistantMessageId:terminal ? assistantId:null,expectedWorkingDirectory:null,executionSelection:null,canonicalStatus:terminal ? "finalized_success":"prepared",dispatchStatus:terminal ? "completed":"executing",failureCode:null,runtimeMetadata:null};
  const results: Record<string,unknown[]> = {native_live_turn_preparations:[preparation],native_live_semantic_scoring_requests:[],conversation_messages:messages,conversation_content_blocks:blocks};
  const db = {select:()=>({from:(table:Parameters<typeof getTableName>[0])=>{
    const query = {table:getTableName(table),joins:[] as SQL[],where:undefined as SQL|undefined}; queries.push(query);
    const builder = {
      where:(condition:SQL)=>{ query.where=condition;return builder; },
      innerJoin:(_table:unknown,condition:SQL)=>{ query.joins.push(condition);return builder; },
      orderBy:(..._args:unknown[])=>builder,
      limit:(_limit:number)=>builder,
      then:(resolve:(value:unknown[])=>unknown,reject:(error:unknown)=>unknown)=>Promise.resolve(results[query.table] ?? []).then(resolve,reject),
    };return builder;
  }})};
  const result = await readTurn.call({db} as unknown as TurnRepositoryContext,{userId:owner,prepareId:"prepare"});
  assert.equal(result?.preparedUserMessage?.id,userId);
  assert.equal(result?.preparedUserMessage?.parentMessageId,"old-head");
  assert.equal(result?.assistantMessage?.id,terminal ? assistantId:undefined);
  assert.equal(result?.preparedUserMessage?.blocks[1]?.payload?.tool_use_id,"tool");
  assert.deepEqual(result?.preparedUserMessage?.blocks.map(b=>b.ordinal),[0,1]);
  assert.equal(result?.preparedUserMessage?.createdAt,date.toISOString());
  assert.equal(queries.length,4,"preparation + semantic + bounded messages + bounded blocks");
  const dialect = new PgDialect();
  for (const table of ["conversation_messages","conversation_content_blocks"]) {
    const query = queries.find(q=>q.table===table)!;
    assert.ok(query?.where);
    const compiled = dialect.sqlToQuery(query.where);
    assert.ok(compiled.params.includes(owner),`${table} is owner scoped`);
    assert.ok(compiled.params.includes(userId),`${table} targets prepared user`);
    assert.equal(compiled.params.includes(assistantId),terminal,`${table} only targets assistant when terminal`);
    assert.match(compiled.sql,new RegExp(`"${table}"\\."${table === "conversation_messages" ? "id":"message_id"}" in \\(`));
    if (table === "conversation_messages") {
      assert.ok(compiled.params.includes(conversationId));
      assert.ok(compiled.params.includes("native_live"),"preserve native conversation scope");
    }
  }
});
