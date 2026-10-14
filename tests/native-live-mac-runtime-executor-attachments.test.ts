import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveMacRuntimeExecutor,
} from "../src/domains/bridge/mac/native-live-mac-runtime-executor.js";
import {
  command,
} from "./helpers/native-live-mac-runtime-executor-fixtures.js";

test("protocol v4 collects explicit send_file output attachment ids", async () => {
  const attachmentId =
    "66666666-6666-4666-8666-666666666666";
  const sent: unknown[] = [];
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn(
      _prompt: string,
      options: {
        sendFileHandler?: (input: {
          path: string;
          displayName: string | null;
        }) => Promise<{
          attachmentId: string;
          filename: string;
          mimeType: string;
          sizeBytes: number;
          sha256: string;
          kind: "image" | "file";
        }>;
      },
    ) {
      assert.equal(typeof options.sendFileHandler, "function");
      const attachment = await options.sendFileHandler!({
        path: "out/report.pdf",
        displayName: "report.pdf",
      });
      assert.equal(attachment.attachmentId, attachmentId);
      return {
        providerSessionId: "provider-output",
        normalizedEvents: [],
      };
    },
  };
  const sender = {
    async sendFile(input: {
      path: string;
      displayName?: string | null;
      workingDirectory: string;
    }) {
      sent.push(input);
      return {
        attachmentId,
        filename: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 321,
        sha256: "a".repeat(64),
        kind: "file" as const,
      };
    },
  };

  const result =
    await new NativeLiveMacRuntimeExecutor(
      runtime,
      "/workspace",
      null,
      sender,
    ).execute(
      command({ protocol_version: 4 }),
    );

  assert.equal(result.status, "success");
  if (result.status !== "success") {
    throw new Error("expected success");
  }
  assert.deepEqual(sent, [{
    path: "out/report.pdf",
    displayName: "report.pdf",
    workingDirectory: "/workspace",
  }]);
  assert.deepEqual(
    result.output_attachment_ids,
    [attachmentId],
  );
  assert.equal(
    result.output_attachment_metadata,
    undefined,
  );
});


test("retired protocol turns fail before runtime execution", async () => {
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn(
      _prompt: string,
      options: {
        sendFileHandler?: unknown;
      },
    ) {
      assert.equal(options.sendFileHandler, undefined);
      return {
        providerSessionId: "provider-legacy",
        normalizedEvents: [],
      };
    },
  };
  const sender = {
    async sendFile() {
      throw new Error("legacy turn must not send files");
    },
  };

  await assert.rejects(
    new NativeLiveMacRuntimeExecutor(runtime, "/directory", null, sender).execute(command({ protocol_version: 3 })),
    /Unsupported runtime protocol version/,
  );
});
test("protocol v4 preserves the disabled send_file capability", async () => {
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn(
      _prompt: string,
      options: {
        sendFileHandler?: unknown;
      },
    ) {
      assert.equal(options.sendFileHandler, undefined);
      return {
        providerSessionId: "provider-legacy",
        normalizedEvents: [],
      };
    },
  };
  const sender = {
    async sendFile() {
      throw new Error("legacy turn must not send files");
    },
  };

  const result = await new NativeLiveMacRuntimeExecutor(runtime, "/directory", null, sender).execute(command({ protocol_version: 4, output_attachments_enabled: false }));
  assert.equal(result.status, "success");
});

test('real Mac factory forwards SDK tool images through upload and returns ready attachment ids', async () => {
  const { createNativeLiveMacClaudeTransport } = await import('../src/domains/bridge/mac/native-live-mac-claude-transport.js');
  const { NativeLiveMacOutputAttachmentSender } = await import('../src/domains/bridge/mac/native-live-mac-output-attachment-sender.js');
  const { runtime } = await createNativeLiveMacClaudeTransport({}, process.cwd());
  const data='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=';
  (runtime as unknown as { queryImpl: () => unknown }).queryImpl=()=>({
    close(){},async *[Symbol.asyncIterator](){
      yield {type:'system',subtype:'init',session_id:'image-fixture'};
      yield {type:'user',session_id:'image-fixture',message:{content:[{type:'tool_result',tool_use_id:'image-tool',content:[{type:'image',mimeType:'image/png',data}]}]}};
      yield {type:'result',subtype:'success',session_id:'image-fixture',result:'done'};
    },
  });
  let slots=0, uploaded=0;
  let metadata: Parameters<import('../src/domains/bridge/mac/native-live-mac-output-attachment-sender.js').NativeLiveMacOutputAttachmentRelay['createAttachmentUploadSlot']>[0] | undefined;
  const sender=new NativeLiveMacOutputAttachmentSender({
    async createAttachmentUploadSlot(input){slots++;metadata=input;return {attachment:{attachmentId:'66666666-6666-4666-8666-666666666666',...input},upload:{url:'https://synthetic.invalid',method:'PUT',headers:{}}};},
    async completeAttachmentUpload(){assert.ok(metadata);return {attachmentId:'66666666-6666-4666-8666-666666666666',...metadata};},
  },async(_url,init)=>{uploaded++;assert.deepEqual(Buffer.from(await new Response(init?.body).arrayBuffer()),Buffer.from(data,'base64'));return new Response(null,{status:200});});
  const executor=new NativeLiveMacRuntimeExecutor(runtime,process.cwd(),null,sender);
  const result=await executor.execute(command({protocol_version:4}));
  assert.equal(result.status,'success');
  if(result.status!=='success')throw new Error('expected success');
  assert.deepEqual(result.output_attachment_ids,['66666666-6666-4666-8666-666666666666']);
  assert.equal(slots,1);assert.equal(uploaded,1);
  assert.equal(JSON.stringify(result.normalized_events).includes(data),false);
  const disabled=await executor.execute(command({protocol_version:4,output_attachments_enabled:false}));
  assert.equal(disabled.status,'success');assert.equal(slots,1);
});

test('tool images share the send_file limit and failed turns never publish their images',async()=>{
 const descriptor={attachmentId:'66666666-6666-4666-8666-666666666666',filename:'tool.png',mimeType:'image/png',sizeBytes:1,sha256:'a'.repeat(64),kind:'image' as const};
 let count=0,fail=false;
 const sender={async sendFile(){count++;return {...descriptor,attachmentId:String(count)};},async sendInlineImage(){count++;return {...descriptor,attachmentId:String(count)};}};
 const runtime={async sendNew(){throw new Error('unused');},async fork(){throw new Error('unused');},async executeTurn(_prompt:string,options:{sendFileHandler?:(input:{path:string;displayName:null})=>Promise<unknown>;toolImageHandler?:(input:{data:string;mimeType:string},context:{signal:AbortSignal})=>Promise<unknown>}){
   await options.sendFileHandler!({path:'synthetic',displayName:null});
   for(let i=0;i<7;i++)await options.toolImageHandler!({data:'synthetic',mimeType:'image/png'},{signal:new AbortController().signal});
   await assert.rejects(options.toolImageHandler!({data:'synthetic',mimeType:'image/png'},{signal:new AbortController().signal}),/at most 8/);
   if(fail)throw new Error('synthetic runtime failure');
   return {providerSessionId:'s',normalizedEvents:[]};
 }};
 const executor=new NativeLiveMacRuntimeExecutor(runtime,process.cwd(),null,sender);
 const result=await executor.execute(command({protocol_version:4}));assert.equal(result.status,'success');
 if(result.status!=='success')throw new Error('expected success');assert.equal(result.output_attachment_ids?.length,8);assert.equal(count,8);
 fail=true;const failed=await executor.execute(command({protocol_version:4}));assert.equal(failed.status,'failure');assert.equal('output_attachment_ids' in failed,false);
});
