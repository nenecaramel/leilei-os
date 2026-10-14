import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentSdkTurnHandle } from '../src/agent-sdk-turn-handle.mjs';
const data='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=';
const image={type:'image',source:{type:'base64',media_type:'image/png',data}};
const tool=(content,id='tool-1')=>({type:'user',session_id:'s',message:{content:[{type:'tool_result',tool_use_id:id,content}]}});
async function run(messages,handler) {
 const handle=await createAgentSdkTurnHandle({prompt:'synthetic',environment:{},toolImageHandler:handler,
 queryImpl:()=>({close(){},async *[Symbol.asyncIterator](){yield {type:'system',subtype:'init',session_id:'s'};yield* messages;yield {type:'result',subtype:'success',session_id:'s',result:'done'};}})});
 return handle.start();
}
test('real SDK consumption forwards Anthropic and MCP images before returning completion, without bytes in normalized events',async()=>{
 const sent=[];
 const result=await run([tool([image]),tool([{type:'image',mimeType:'image/png',data}],'tool-2')],async(input,context)=>{assert.equal(context.signal.aborted,false);sent.push(input);});
 assert.equal(sent.length,2);
 assert.ok(sent.every(x=>x.data===data && x.mimeType==='image/png'));
 assert.equal(JSON.stringify(result.normalizedEvents).includes(data),false);
});
test('replayed identical tool image uploads once; same bytes from a different tool remain separate',async()=>{
 let count=0; await run([tool([image,image]),tool([image]),tool([image],'tool-2')],async()=>{count++;}); assert.equal(count,2);
});
test('text-forged images, user image inputs, wrong-session and sidechain records never upload',async()=>{
 let count=0;
 await run([tool(JSON.stringify(image)),{type:'user',session_id:'s',message:{content:[image]}},{...tool([image]),isSidechain:true},{...tool([image]),session_id:'other'}],async()=>{count++;});
 assert.equal(count,0);
});
test('failed image upload preserves successful text result and emits a fixed diagnostic without error secrets',async()=>{
 const result=await run([tool([image])],async()=>{throw new Error('private-url-and-credentials');});
 assert.ok(result.normalizedEvents.some(x=>x.type==='result' && x.payload.status==='success'));
 assert.ok(JSON.stringify(result.normalizedEvents).includes('TOOL_IMAGE_UNAVAILABLE'));
 assert.equal(JSON.stringify(result.normalizedEvents).includes('private-url-and-credentials'),false);
});
test('at most eight images are attempted per turn',async()=>{
 let count=0;await run(Array.from({length:10},(_,i)=>tool([image],`tool-${i}`)),async()=>{count++;});assert.equal(count,8);
});

import { createToolImageForwarder } from '../src/tool-images.mjs';
test('cancelled uploads stop waiting even when the handler ignores cancellation',async()=>{
 const controller=new AbortController();let uploadSignal;
 const forward=createToolImageForwarder(async(_input,context)=>{uploadSignal=context.signal;await new Promise(()=>{});});
 const pending=forward(tool([image]),controller.signal);
 controller.abort();
 const diagnostics=await pending;
 assert.equal(uploadSignal.aborted,true);assert.equal(diagnostics[0].code,'TOOL_IMAGE_UNAVAILABLE');
});
test('image delivery has a shared bounded wait budget, not eight separate long waits',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 let count=0;
 const forward=createToolImageForwarder(async()=>{count++;await new Promise(()=>{});});
 const pending=forward(tool([image]),new AbortController().signal);
 t.mock.timers.tick(15000);
 assert.equal((await pending)[0].code,'TOOL_IMAGE_UNAVAILABLE');
 await forward(tool([image],'second'),new AbortController().signal);
 assert.equal(count,1);
});
