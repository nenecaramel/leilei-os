import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createNativeSessionDrainServer, requestNativeSessionDrain } from '../src/native-session-daemon-drain.mjs';
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
test('private local daemon drain correlates session and returns metadata only',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'drain-ipc-'));t.after(()=>rm(root,{recursive:true,force:true}));
 assert.equal(await requestNativeSessionDrain({recoveryDirectory:root,conversationId:A,providerSessionId:B}),null);
 const calls=[];const close=await createNativeSessionDrainServer({recoveryDirectory:root,drain:async(c,s)=>{calls.push([c,s]);return {ready:true,writer:'closed',tasks:[]};}});t.after(close);
 assert.equal((await stat(path.join(root,'daemon-control','handoff.sock'))).mode&0o777,0o600);
 const report=await requestNativeSessionDrain({recoveryDirectory:root,conversationId:A,providerSessionId:B});assert.equal(report.ready,true);assert.deepEqual(calls,[[A,B]]);
 await assert.rejects(createNativeSessionDrainServer({recoveryDirectory:root,drain:async()=>{}}),/already exists/);
});
test('unknown drain and handler failure never claim a released writer',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'drain-ipc-'));t.after(()=>rm(root,{recursive:true,force:true}));
 let fail=false;const close=await createNativeSessionDrainServer({recoveryDirectory:root,drain:async()=>{if(fail)throw new Error('PRIVATE');return {ready:false,writer:'unknown',tasks:[{id:'task-a',status:'unknown'}]};}});t.after(close);
 assert.equal((await requestNativeSessionDrain({recoveryDirectory:root,conversationId:A,providerSessionId:B})).ready,false);
 fail=true;await assert.rejects(requestNativeSessionDrain({recoveryDirectory:root,conversationId:A,providerSessionId:B}),e=>e.code==='NATIVE_DAEMON_DRAIN_UNCONFIRMED'&&!e.message.includes('PRIVATE'));
});
