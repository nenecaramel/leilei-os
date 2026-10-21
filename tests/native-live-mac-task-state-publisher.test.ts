import assert from 'node:assert/strict';
import test from 'node:test';
import {NativeLiveMacTaskStatePublisher} from '../src/domains/bridge/mac/native-live-mac-task-state-publisher.js';
const owner=(n:number)=>({prepareId:String(n),providerSessionId:'session',generationId:'generation'});
const task=(id:string)=>({taskId:id,handle:id,active:true,taskType:'bash',description:'synthetic',ambient:false});
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};}
test('post-foreground membership and completion publish without another result',async()=>{
 const sent:any[]=[];const p=new NativeLiveMacTaskStatePublisher({publish:async v=>{sent.push(v);},isLive:()=>true});
 p.observe(owner(1),[task('a')]);await p.settle();p.observe(owner(1),[]);await p.settle();
 assert.deepEqual(sent.map(s=>s.tasks.map((t:any)=>t.task_id)),[['a'],[]]);assert.equal(sent[1].snapshotSequence,2);p.close();
});
test('same task keeps its original turn source while new tasks use the new source',async()=>{
 const sent:any[]=[];const p=new NativeLiveMacTaskStatePublisher({publish:async v=>{sent.push(v);},isLive:()=>true});
 p.observe(owner(1),[task('a')]);await p.settle();p.observe(owner(2),[task('a'),task('b')]);await p.settle();p.observe(owner(2),[]);await p.settle();
 assert.deepEqual(sent.filter(s=>s.prepareId==='1').map(s=>s.tasks.map((t:any)=>t.task_id)),[['a'],[]]);
 assert.deepEqual(sent.filter(s=>s.prepareId==='2').map(s=>s.tasks.map((t:any)=>t.task_id)),[['b'],[]]);p.close();
});
test('coalescing preserves a pending snapshot identity then publishes latest membership',async()=>{
 const gate=deferred(),sent:any[]=[];const p=new NativeLiveMacTaskStatePublisher({publish:async v=>{sent.push(v);if(sent.length===1)await gate.promise;},isLive:()=>true});
 p.observe(owner(1),[task('a')]);await Promise.resolve();p.observe(owner(1),[task('a'),task('b')]);p.observe(owner(1),[]);gate.resolve();await p.settle();
 assert.deepEqual(sent.map(s=>s.tasks.map((t:any)=>t.task_id)),[['a'],[]]);p.close();
});
test('retirement fences queued snapshots and never waits for network in the SDK callback',async()=>{
 const gate=deferred(),sent:any[]=[];let live=true;const p=new NativeLiveMacTaskStatePublisher({publish:async v=>{sent.push(v);await gate.promise;},isLive:()=>live});
 p.observe(owner(1),[task('a')]);await Promise.resolve();p.observe(owner(1),[]);live=false;p.close();gate.resolve();await p.settle();assert.equal(sent.length,1);
});
test('failed metadata delivery is bounded and does not reject observation',async()=>{
 let attempts=0;const p=new NativeLiveMacTaskStatePublisher({publish:async()=>{attempts++;throw Error('offline');},isLive:()=>true});
 p.observe(owner(1),[task('a')]);await p.settle();assert.equal(attempts,1);p.observe(owner(1),[]);await p.settle();assert.equal(attempts,2);p.close();
});
test('reappearing tasks on a completed source never reset snapshot sequence',async()=>{
 const sent:any[]=[];const p=new NativeLiveMacTaskStatePublisher({publish:async v=>{sent.push(v);},isLive:()=>true});
 p.observe(owner(1),[task('a')]);await p.settle();p.observe(owner(1),[]);await p.settle();p.observe(owner(1),[task('b')]);await p.settle();
 assert.ok(sent[2].snapshotSequence>sent[1].snapshotSequence);p.close();
});
test('oversize live membership never publishes an incomplete replacement snapshot',async()=>{
 const sent:any[]=[];const p=new NativeLiveMacTaskStatePublisher({publish:async v=>{sent.push(v);},isLive:()=>true});
 p.observe(owner(1),[task('a')]);await p.settle();p.observe(owner(1),Array.from({length:65},(_,n)=>task(String(n))));await p.settle();assert.equal(sent.length,1);p.close();
});
