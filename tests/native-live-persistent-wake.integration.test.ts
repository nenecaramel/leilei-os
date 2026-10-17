import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users,conversations,nativeLiveTurnPreparations as preparations,nativeLiveRuntimeListenerLeases as leases } from "../src/database/schema.js";
import { DrizzleNativeLiveBackendRelayRepository } from "../src/domains/bridge/relay/native-live-backend-relay.js";
test("Wake requires modern persistent session; never dispatch a fork",{skip:process.env.RUN_NATIVE_LIVE_RELAY_DATABASE_TEST!=="1"},async t=>{
 const {isolatedPostgresTarget,verifyIsolatedPostgresTarget}=await import("../scripts/isolated-postgres-target.mjs");assert.ok(process.env.DATABASE_URL);await verifyIsolatedPostgresTarget(isolatedPostgresTarget(process.env.DATABASE_URL));
 const database=createDatabase(process.env.DATABASE_URL,{ssl:false}),db=database.db;const userId=crypto.randomUUID(),conversationId=crypto.randomUUID(),listenerInstanceId=crypto.randomUUID();
 t.after(async()=>{try{await db.delete(leases).where(eq(leases.userId,userId));await db.delete(conversations).where(eq(conversations.id,conversationId));await db.delete(users).where(eq(users.id,userId));}finally{await database.close();}});
 await db.insert(users).values({id:userId,email:`persistent-wake-${userId}@example.com`,displayName:"Synthetic"});await db.insert(conversations).values({id:conversationId,userId,origin:"native_live"});await db.insert(leases).values({userId,dispatchTarget:"claude_code",listenerInstanceId,leaseExpiresAt:new Date(Date.now()+60000)});
 const repository=new DrizzleNativeLiveBackendRelayRepository(db);
 for(const [capable,modern,expected] of [[false,true,null],[true,false,null],[true,true,"resume"]] as const){
  const id=crypto.randomUUID();await db.insert(preparations).values({id,userId,requestId:crypto.randomUUID(),conversationId,operation:"wake",requestHash:"a".repeat(64),runtimeMode:"fork",parentProviderSessionId:crypto.randomUUID(),parentProviderCheckpointId:crypto.randomUUID(),prompt:"synthetic",wakeContext:modern?{runtime_generation:{presentation_owner_id:crypto.randomUUID(),source_revision:null}}:{},dispatchStatus:"pending"});
  const row=await repository.reserveNext({userId,listenerInstanceId,...(capable?{persistentSessions:true}:{})});
  assert.equal(row?.runtimeMode??null,expected,"Wake may never dispatch as fork");
  const [stored]=await db.select().from(preparations).where(eq(preparations.id,id));
  if(expected===null){
   assert.equal(row,null);
   assert.equal(stored?.dispatchStatus,"rejected");
   assert.equal(stored?.dispatchErrorCode,"WAKE_REQUIRES_LIVE_SESSION");
  }else{
   assert.equal(row?.prepareId,id);
   assert.equal(stored?.runtimeMode,"resume");
   const deferred=await repository.rejectReservation({
     userId,listenerInstanceId,reservationId:id,code:"EXECUTION_START_FAILED"});
   assert.equal(deferred,"applied");
   const [waiting]=await db.select().from(preparations).where(eq(preparations.id,id));
   assert.equal(waiting?.dispatchStatus,"pending","busy Wake must remain durable");
   assert.ok(waiting?.reservationExpiresAt && waiting.reservationExpiresAt.getTime()>Date.now(),
     "a retry-after is persisted to avoid an immediate polling loop");
   assert.equal(await repository.reserveNext({userId,listenerInstanceId,persistentSessions:true}),null,
     "deferred Wake must not be reserved again before retry-after");
  }
  await db.delete(preparations).where(eq(preparations.id,id));
 }
});
