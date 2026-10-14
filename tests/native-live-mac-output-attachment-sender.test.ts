import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  NativeLiveMacOutputAttachmentSender,
} from "../src/domains/bridge/mac/native-live-mac-output-attachment-sender.js";

test("send_file uploads the exact explicit workspace file", async (t) => {
  const root = await mkdtemp(
    join(tmpdir(), "leileios-send-file-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  await mkdir(join(workspace, "out"), { recursive: true });
  const filePath = join(workspace, "out", "report.pdf");
  const bytes = Buffer.from("%PDF-test");
  await writeFile(filePath, bytes);

  let declared:
    | {
        filename: string;
        mimeType: string;
        sizeBytes: number;
        sha256: string;
        kind: "image" | "file";
      }
    | null = null;
  let uploaded: Buffer | null = null;
  const attachmentId =
    "66666666-6666-4666-8666-666666666666";

  const relay = {
    async createAttachmentUploadSlot(input: {
      filename: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      kind: "image" | "file";
    }) {
      declared = input;
      return {
        attachment: {
          attachmentId,
          ...input,
        },
        upload: {
          url: "https://bucket.example/upload",
          method: "PUT" as const,
          headers: {
            "content-type": input.mimeType,
            "x-amz-meta-sha256": input.sha256,
          },
        },
      };
    },
    async completeAttachmentUpload() {
      assert.ok(declared);
      return {
        attachmentId,
        ...declared,
      };
    },
  };

  const sender = new NativeLiveMacOutputAttachmentSender(
    relay,
    async (url, init) => {
      assert.equal(
        url,
        "https://bucket.example/upload",
      );
      assert.equal(init?.method, "PUT");
      assert.equal(
        new Headers(init?.headers).get("content-type"),
        "application/pdf",
      );
      uploaded = Buffer.from(
        await new Response(init?.body).arrayBuffer(),
      );
      return new Response(null, { status: 200 });
    },
  );

  const attachment = await sender.sendFile({
    path: "out/report.pdf",
    displayName: "result.pdf",
    workingDirectory: workspace,
  });

  assert.equal(attachment.attachmentId, attachmentId);
  assert.deepEqual(uploaded, bytes);
  assert.ok(declared);
  assert.equal(declared.filename, "result.pdf");
  assert.equal(declared.mimeType, "application/pdf");
  assert.equal(declared.kind, "file");
  assert.equal(declared.sizeBytes, bytes.length);
  assert.match(declared.sha256, /^[0-9a-f]{64}$/u);
});

test("send_file rejects working directory escape including symlinks", async (t) => {
  const root = await mkdtemp(
    join(tmpdir(), "leileios-send-file-escape-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  const outside = join(root, "secret.txt");
  await writeFile(outside, "private");
  await symlink(outside, join(workspace, "linked.txt"));

  let relayCalls = 0;
  const relay = {
    async createAttachmentUploadSlot() {
      relayCalls += 1;
      throw new Error("must not upload");
    },
    async completeAttachmentUpload() {
      relayCalls += 1;
      throw new Error("must not complete");
    },
  };
  const sender = new NativeLiveMacOutputAttachmentSender(
    relay,
  );

  await assert.rejects(
    () => sender.sendFile({
      path: "../secret.txt",
      workingDirectory: workspace,
    }),
    /active working directory/u,
  );
  await assert.rejects(
    () => sender.sendFile({
      path: "linked.txt",
      workingDirectory: workspace,
    }),
    /active working directory/u,
  );
  assert.equal(relayCalls, 0);
});

test("ordinary files enforce the configured size limit before creating any upload", async t => {
  const workspace = await mkdtemp(join(tmpdir(), "leileios-file-size-"));
  t.after(() => rm(workspace, {recursive: true, force: true}));
  let calls = 0;
  const sender = new NativeLiveMacOutputAttachmentSender({
    async createAttachmentUploadSlot() {calls++; throw new Error("unused");},
    async completeAttachmentUpload() {throw new Error("unused");},
  }, fetch, 10);
  for (const size of [0, 11]) {
    const path = join(workspace, `${size}.webp`);
    await writeFile(path, Buffer.alloc(size));
    await assert.rejects(sender.sendFile({path, workingDirectory: workspace}), /limit/);
  }
  assert.equal(calls, 0);
});

test('tool image uploads original bytes through the existing private attachment relay', async () => {
  const data='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=';
  let declared: Parameters<import('../src/domains/bridge/mac/native-live-mac-output-attachment-sender.js').NativeLiveMacOutputAttachmentRelay['createAttachmentUploadSlot']>[0] | undefined;
  let uploaded: Buffer | undefined;
  const sender=new NativeLiveMacOutputAttachmentSender({
    async createAttachmentUploadSlot(input) { declared=input;return {attachment:{attachmentId:'a',...input},upload:{url:'https://synthetic.invalid',method:'PUT',headers:{}}}; },
    async completeAttachmentUpload() { assert.ok(declared);return {attachmentId:'a',...declared}; },
  },async(_url,init)=>{uploaded=Buffer.from(await new Response(init?.body).arrayBuffer());return new Response(null,{status:200});});
  const result=await sender.sendInlineImage({data,mimeType:'image/png'});
  assert.deepEqual(uploaded,Buffer.from(data,'base64'));
  assert.equal(result.kind,'image');assert.equal(result.mimeType,'image/png');
  assert.match(result.filename,/\.png$/);assert.equal(result.sizeBytes,Buffer.from(data,'base64').length);
});

test('invalid, oversized, non-image and cancelled tool data never creates upload slots',async()=>{
  let slots=0;
  const sender=new NativeLiveMacOutputAttachmentSender({
    async createAttachmentUploadSlot(){slots++;throw new Error('not expected');},
    async completeAttachmentUpload(){throw new Error('not expected');},
  },fetch,16);
  for(const input of [{data:'not base64!',mimeType:'image/png'},{data:Buffer.alloc(17).toString('base64'),mimeType:'image/png'},{data:'AAAA',mimeType:'text/html'},{data:'AAAA',mimeType:'image/svg+xml'},{data:'AAAA',mimeType:'image/png'}]) await assert.rejects(sender.sendInlineImage(input));
  await assert.rejects(sender.sendInlineImage({data:'AAAA',mimeType:'image/png',signal:AbortSignal.abort()}));
  assert.equal(slots,0);
});

test('large tool image base64 is validated without regex stack overflow',async()=>{
  const bytes=Buffer.alloc(10*1024*1024);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  let metadata: Parameters<import('../src/domains/bridge/mac/native-live-mac-output-attachment-sender.js').NativeLiveMacOutputAttachmentRelay['createAttachmentUploadSlot']>[0] | undefined;
  const sender=new NativeLiveMacOutputAttachmentSender({
    async createAttachmentUploadSlot(input){metadata=input;return {attachment:{attachmentId:'large',...input},upload:{url:'https://synthetic.invalid',method:'PUT',headers:{}}};},
    async completeAttachmentUpload(){assert.ok(metadata);return {attachmentId:'large',...metadata};},
  },async()=>new Response(null,{status:200}));
  assert.equal((await sender.sendInlineImage({data:bytes.toString('base64'),mimeType:'image/png'})).sizeBytes,bytes.length);
});

test('a late upload completion cannot succeed after cancellation',async()=>{
 const data='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=';
 const controller=new AbortController();let release!:()=>void;let started!:()=>void;
 const completeStarted=new Promise<void>(resolve=>{started=resolve;});const barrier=new Promise<void>(resolve=>{release=resolve;});
 let metadata: Parameters<import('../src/domains/bridge/mac/native-live-mac-output-attachment-sender.js').NativeLiveMacOutputAttachmentRelay['createAttachmentUploadSlot']>[0] | undefined;
 const sender=new NativeLiveMacOutputAttachmentSender({
   async createAttachmentUploadSlot(input){metadata=input;return {attachment:{attachmentId:'late',...input},upload:{url:'https://synthetic.invalid',method:'PUT',headers:{}}};},
   async completeAttachmentUpload(){started();await barrier;assert.ok(metadata);return {attachmentId:'late',...metadata};},
 },async()=>new Response(null,{status:200}));
 const pending=sender.sendInlineImage({data,mimeType:'image/png',signal:controller.signal});
 const rejected=assert.rejects(pending);await completeStarted;controller.abort();release();await rejected;
});
