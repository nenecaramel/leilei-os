import assert from "node:assert/strict";
import test from "node:test";
import { NativeLiveMacRuntimeExecutor } from "../src/domains/bridge/mac/native-live-mac-runtime-executor.js";
import { command } from "./helpers/native-live-mac-runtime-executor-fixtures.js";

const descriptor={attachmentId:"33333333-3333-4333-8333-333333333333",filename:"meme_0001.webp",mimeType:"image/webp",sizeBytes:42,sha256:"a".repeat(64),kind:"image" as const};
const unused=async()=>{throw new Error("unused");};

test("meme output shares eight slots with files and private photos, including concurrency",async()=>{
  let sends=0;
  const output=async()=>({...descriptor,attachmentId:`00000000-0000-4000-8000-${String(++sends).padStart(12,"0")}`});
  const memeSender={async sendMeme(input:{memeId:string}){assert.equal(input.memeId,"meme_0001");return output();}};
  const album={savePhoto:unused,async searchPhotos(){return [];},viewPhoto:unused,async sendPhoto(){return {photo:{} as never,attachment:await output()};}};
  const runtime={sendNew:unused,resume:unused,fork:unused,async executeTurn(_prompt:string,options:any){
    for(let i=0;i<5;i++)await options.sendFileHandler({path:"x",displayName:null});
    for(let i=0;i<2;i++)await options.albumHandlers.sendPhoto({photoId:"photo"});
    const pending=await Promise.allSettled([options.memeHandlers.sendMeme({memeId:"meme_0001"}),options.sendFileHandler({path:"x",displayName:null}),options.albumHandlers.sendPhoto({photoId:"photo"})]);
    assert.deepEqual(pending.map(x=>x.status),["fulfilled","rejected","rejected"]);
    await assert.rejects(options.memeHandlers.sendMeme({memeId:"meme_0001"}),/8-file/);
    return {providerSessionId:"provider-limit",normalizedEvents:[]};
  }};
  const result=await new NativeLiveMacRuntimeExecutor(runtime,"/workspace",null,{sendFile:output},null,album,memeSender).execute(command({protocol_version:4}));
  assert.equal(result.status,"success");if(result.status!=="success")throw new Error(JSON.stringify(result));
  assert.equal(sends,8);assert.equal(result.output_attachment_ids?.length,8);
});

test("failed meme sends release quota and ordinary turns have no meme output",async()=>{
  let calls=0;
  const memes={async sendMeme(){if(++calls===1)throw new Error("unavailable");return descriptor;}};
  const runtime={sendNew:unused,resume:unused,fork:unused,async executeTurn(_prompt:string,options:any){
    await assert.rejects(options.memeHandlers.sendMeme({memeId:"meme_0001"}));
    for(let i=0;i<8;i++)await options.memeHandlers.sendMeme({memeId:"meme_0001"});
    await assert.rejects(options.memeHandlers.sendMeme({memeId:"meme_0001"}),/8-file/);
    return {providerSessionId:"provider",normalizedEvents:[]};
  }};
  const result=await new NativeLiveMacRuntimeExecutor(runtime,"/workspace",null,null,null,null,memes).execute(command({protocol_version:4}));
  assert.equal(result.status,"success");if(result.status!=="success")throw new Error(JSON.stringify(result));assert.equal(result.output_attachment_ids?.length,8);
  const normal={...runtime,async executeTurn(){return {providerSessionId:"ordinary",normalizedEvents:[]};}};
  const ordinary=await new NativeLiveMacRuntimeExecutor(normal,"/workspace",null,null,null,null,memes).execute(command({protocol_version:4}));
  assert.equal(ordinary.status,"success");if(ordinary.status!=="success")throw new Error();assert.equal(ordinary.output_attachment_ids,undefined);assert.equal(calls,9);
});
