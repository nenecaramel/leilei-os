import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  consumeNativeLiveMacMemeGitHubConfig,
  NativeLiveMacMemeSender,
  NativeLiveMemeSendError,
} from "../src/domains/bridge/mac/native-live-mac-meme-sender.js";
import { NativeLiveMacOutputAttachmentSender } from "../src/domains/bridge/mac/native-live-mac-output-attachment-sender.js";

// Real one-pixel static WebP fixture, not JSON/base64 CLI output.
const webp=Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
const id="33333333-3333-4333-8333-333333333333";
const descriptor={attachmentId:id,filename:"meme_0001.webp",mimeType:"image/webp",sizeBytes:webp.length,sha256:createHash("sha256").update(webp).digest("hex"),kind:"image" as const};

test("fixed authenticated GitHub API bytes enter the existing output attachment upload/complete path",async()=>{
  let uploaded=false;
  let request:{url:string;init?:RequestInit}|null=null;
  const relay={async createAttachmentUploadSlot(input:unknown){assert.deepEqual(input,{filename:"meme_0001.webp",mimeType:"image/webp",sizeBytes:42,sha256:descriptor.sha256,kind:"image"});return {attachment:descriptor,upload:{url:"https://bucket.example/upload",method:"PUT" as const,headers:{"content-type":"image/webp"}}};},async completeAttachmentUpload(input:unknown){assert.equal(uploaded,true);assert.deepEqual(input,{attachmentId:id});return descriptor;}};
  const attachments=new NativeLiveMacOutputAttachmentSender(relay,async(url,init)=>{assert.equal(String(url),"https://bucket.example/upload");assert.deepEqual(Buffer.from(init?.body as Uint8Array),webp);uploaded=true;return new Response(null,{status:200});});
  const sender=new NativeLiveMacMemeSender(
    attachments,
    {githubToken:"dedicated-meme-token"},
    async(url,init)=>{
      request={url:String(url),init};
      return new Response(new Uint8Array(webp),{
        status:200,
        headers:{"content-length":String(webp.length),"content-type":"image/webp"},
      });
    },
  );
  const result=await sender.sendMeme({memeId:"meme_0001"});
  assert.deepEqual(result,descriptor);
  assert.equal(request?.url,"https://api.github.com/repos/nenecaramel/leileios-album/contents/memes/meme_0001.webp?ref=main");
  assert.equal(new Headers(request?.init?.headers).get("authorization"),"Bearer dedicated-meme-token");
  assert.equal(new Headers(request?.init?.headers).get("accept"),"application/vnd.github.raw+json");
});

for(const memeId of ["meme_1","../meme_0001","meme_0001/../../secret","meme_0001?ref=evil","meme_x","meme_0001.webp","","meme_0001\n","meme_"+"1".repeat(100)]){
  test(`invalid meme id rejected before gh: ${JSON.stringify(memeId)}`,async()=>{
    let calls=0;
    const sender=new NativeLiveMacMemeSender({async sendBytes(){throw new Error("must not upload");}},{githubToken:"token"},async()=>{calls++;return new Response(new Uint8Array(webp),{status:200});});
    await assert.rejects(sender.sendMeme({memeId}));assert.equal(calls,0);
  });
}

test("GitHub API auth and transport failures are classified safely",async()=>{
  const cases=[
    {token:null,response:null,throws:null,code:"MEME_GITHUB_AUTH_MISSING"},
    {token:"token",response:new Response(null,{status:401}),throws:null,code:"MEME_GITHUB_AUTH_FAILED"},
    {token:"token",response:new Response(null,{status:403}),throws:null,code:"MEME_GITHUB_AUTH_FAILED"},
    {token:"token",response:new Response(null,{status:404}),throws:null,code:"MEME_NOT_FOUND"},
    {token:"token",response:new Response(null,{status:500}),throws:null,code:"MEME_GITHUB_FETCH_FAILED"},
    {token:"token",response:null,throws:new Error("network /secret/path"),code:"MEME_GITHUB_FETCH_FAILED"},
  ] as const;
  for(const item of cases){
    const sender=new NativeLiveMacMemeSender(
      {async sendBytes(){throw new Error("must not upload");}},
      {githubToken:item.token},
      async()=>{if(item.throws)throw item.throws;return item.response!;},
    );
    await assert.rejects(sender.sendMeme({memeId:"meme_0001"}),error=>{
      assert.ok(error instanceof NativeLiveMemeSendError);
      assert.equal(error.code,item.code);
      assert.equal(String(error).includes("secret/path"),false);
      return true;
    });
  }
});

for(const bytes of [Buffer.alloc(0),Buffer.from('{"content":"base64"}'),Buffer.from("not webp"),Buffer.concat([webp,Buffer.alloc(20*1024*1024)])]){
  test(`invalid source bytes report MEME_SOURCE_INVALID: ${bytes.length}`,async()=>{
    let uploads=0;
    const sender=new NativeLiveMacMemeSender({async sendBytes(){uploads++;throw new Error("unused");}},{githubToken:"token"},async()=>new Response(new Uint8Array(bytes),{status:200}));
    await assert.rejects(sender.sendMeme({memeId:"meme_0001"}),error=>{
      assert.ok(error instanceof NativeLiveMemeSendError);
      assert.equal(error.code,"MEME_SOURCE_INVALID");
      return true;
    });
    assert.equal(uploads,0);
  });
}

test("attachment failure and image metadata mismatch report MEME_ATTACHMENT_FAILED safely",async()=>{
  for(const response of [new Error("signed-url PRIVATE_TOKEN"),{...descriptor,mimeType:"application/json"},{...descriptor,kind:"file" as const},{...descriptor,sizeBytes:1},{...descriptor,sha256:"a".repeat(64)}]){
    const sender=new NativeLiveMacMemeSender({async sendBytes(){if(response instanceof Error)throw response;return response;}},{githubToken:"token"},async()=>new Response(new Uint8Array(webp),{status:200}));
    await assert.rejects(sender.sendMeme({memeId:"meme_0001"}),error=>{
      assert.ok(error instanceof NativeLiveMemeSendError);
      assert.equal(error.code,"MEME_ATTACHMENT_FAILED");
      assert.equal(String(error).includes("PRIVATE_TOKEN"),false);
      return true;
    });
  }
});

test("meme bytes complete the existing sender before runtime emits output_attachment_ids",async()=>{
  const {NativeLiveMacRuntimeExecutor}=await import("../src/domains/bridge/mac/native-live-mac-runtime-executor.js");
  const {command}=await import("./helpers/native-live-mac-runtime-executor-fixtures.js");
  let complete=false;
  const relay={async createAttachmentUploadSlot(){return {attachment:descriptor,upload:{url:"https://bucket.example/upload",method:"PUT" as const,headers:{}}};},async completeAttachmentUpload(){complete=true;return descriptor;}};
  const attachments=new NativeLiveMacOutputAttachmentSender(relay,async()=>new Response(null,{status:200}));
  const sender=new NativeLiveMacMemeSender(attachments,{githubToken:"token"},async()=>new Response(new Uint8Array(webp),{status:200}));
  const unused=async()=>{throw new Error("unused");};
  const runtime={sendNew:unused,resume:unused,fork:unused,async executeTurn(_prompt:string,options:{memeHandlers?:{sendMeme(input:{memeId:string}):Promise<unknown>}}){
    await options.memeHandlers!.sendMeme({memeId:"meme_0001"});assert.equal(complete,true);
    return {providerSessionId:"provider-meme",normalizedEvents:[]};
  }};
  const result=await new NativeLiveMacRuntimeExecutor(runtime,"/workspace",null,attachments,null,null,sender).execute(command({protocol_version:4}));
  assert.equal(result.status,"success");if(result.status!=="success")throw new Error(JSON.stringify(result));assert.deepEqual(result.output_attachment_ids,[id]);
});

test("bytes entrypoint enforces the sender's configured limit without creating an upload",async()=>{
  let calls=0;
  const sender=new NativeLiveMacOutputAttachmentSender({async createAttachmentUploadSlot(){calls++;throw new Error("unused");},async completeAttachmentUpload(){throw new Error("unused");}},fetch,10);
  for(const bytes of [Buffer.alloc(0),Buffer.alloc(11)])await assert.rejects(sender.sendBytes({bytes,filename:"meme.webp"}),/limit/);
  assert.equal(calls,0);
});

test("daemon consumes meme GitHub secrets before Claude runtime inheritance",()=>{
  const environment:NodeJS.ProcessEnv={
    PATH:"/usr/bin",
    LEILEI_MEME_GITHUB_TOKEN:" secret-token ",
    LEILEI_MEME_GH_PATH:" /opt/homebrew/bin/gh ",
  };
  const config=consumeNativeLiveMacMemeGitHubConfig(environment);
  assert.deepEqual(config,{
    githubToken:"secret-token",
  });
  assert.equal(environment.LEILEI_MEME_GITHUB_TOKEN,undefined);
  assert.equal(environment.LEILEI_MEME_GH_PATH,undefined);
  assert.equal(environment.PATH,"/usr/bin");
});
