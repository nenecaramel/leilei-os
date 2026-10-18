import assert from "node:assert/strict";
import test from "node:test";
import { createNativeLiveMacOutputAttachmentCollector } from "../src/domains/bridge/mac/native-live-mac-output-attachment-collector.js";
const id = (n:number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const descriptor = (n:number) => ({attachmentId:id(n),filename:"out.wav",mimeType:"audio/wav",sizeBytes:5,sha256:"0".repeat(64),kind:"file" as const,durationSeconds:2.5});
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return{promise,resolve};}

test("one collector shares the eight count across pending files and tool images and seals duration metadata", async () => {
  const hold=deferred();let calls=0;
  const collector=createNativeLiveMacOutputAttachmentCollector({workingDirectory:()=>"/owned",sender:{
    async sendFile(input){assert.equal(input.workingDirectory,"/owned");const n=++calls;await hold.promise;return descriptor(n);},
    async sendInlineImage(){const n=++calls;await hold.promise;return descriptor(n);},
  }});
  const uploads=Array.from({length:8},(_,i)=>i%2
    ?collector.toolImageHandler!({data:"opaque",mimeType:"image/png"},{signal:new AbortController().signal})
    :collector.sendFileHandler!({path:"out.wav",displayName:null}));
  await assert.rejects(collector.sendFileHandler!({path:"ninth.wav",displayName:null}),/at most 8/);
  await assert.rejects(collector.toolImageHandler!({data:"opaque",mimeType:"image/png"},{signal:new AbortController().signal}),/at most 8/);
  let sealed=false;const receipt=collector.seal().then(value=>{sealed=true;return value;});
  await new Promise(setImmediate);assert.equal(sealed,false);assert.equal(calls,8);
  await assert.rejects(collector.sendFileHandler!({path:"late.wav",displayName:null}),/sealed/);
  hold.resolve();await Promise.all(uploads);
  const result=await receipt;assert.equal(result.outputAttachmentIds.length,8);assert.equal(result.outputAttachmentMetadata?.length,8);
  assert.deepEqual(result.outputAttachmentMetadata?.[0],{attachment_id:id(1),duration_seconds:2.5});
  assert.deepEqual(await collector.seal(),result);
});

test("aborting an exact segment excludes a file upload that finishes later and never transfers it to its successor", async () => {
  const hold=deferred(),entered=deferred();let uploaded=0;
  const sender={async sendFile(){entered.resolve();await hold.promise;return descriptor(++uploaded);}};
  const old=createNativeLiveMacOutputAttachmentCollector({sender,workingDirectory:()=>"/old"});
  const pending=old.sendFileHandler!({path:"late.wav",displayName:null});
  const rejected=assert.rejects(pending,/abort/i);await entered.promise;old.abort();hold.resolve();await rejected;
  await assert.rejects(old.seal(),/abort/i);
  const next=createNativeLiveMacOutputAttachmentCollector({sender,workingDirectory:()=>"/next"});
  assert.deepEqual(await next.seal(),{outputAttachmentIds:[]});
});

test("ownership is rechecked after an asynchronous upload before adding any attachment receipt", async () => {
  let owner=true,checks=0;
  const collector=createNativeLiveMacOutputAttachmentCollector({workingDirectory:()=>"/owned",
    async authorize(){checks++;if(!owner)throw new Error("owner changed");},
    sender:{async sendFile(){owner=false;return descriptor(1);}},
  });
  await assert.rejects(collector.sendFileHandler!({path:"file.wav",displayName:null}),/owner changed/);
  assert.equal(checks,2);assert.deepEqual(await collector.seal(),{outputAttachmentIds:[]});
});
