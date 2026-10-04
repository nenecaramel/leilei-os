import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("actual Swift media descriptors, layers, layout, integrity/cache/retry and preview lifecycle", {skip: process.platform !== "darwin"}, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "leilei-media-swift-"));
  const root = "ios/LeileiOS/LeileiOS/";
  try {
    fs.copyFileSync("tests/fixtures/native-live-media-foundation.swift", path.join(temp,"Checks.swift"));
    const names = ["NativeLiveMarkdownModel", "NativeLiveRichTextProjection", "NativeLiveVisualNode", "NativeLiveVisualRendererRegistry", "NativeLiveVisualSandboxModel", "NativeLiveSVGModel", "NativeLiveStructuredToolResult", "NativeLiveCitationPresentation", "NativeLiveStructuredJSON", "NativeLiveMessagePresentation", "NativeLiveMessagePresentationProjection", "NativeLiveMediaPresentation", "NativeLiveAttachmentCache", "NativeLiveImageLoader", "NativeLiveFilePreviewLifecycle"];
    const files = names.map(n => root + "Chat/MessageSurface/" + n + ".swift").filter(fs.existsSync);
    const compiled = spawnSync("xcrun", ["swiftc", "-parse-as-library", "-module-cache-path", path.join(temp,"cache"), root + "Infrastructure/NativeLiveRuntimeModels.swift", root + "Infrastructure/API/NativeLive/NativeLiveModels.swift", root + "Infrastructure/API/NativeLive/NativeLiveInputMode.swift", ...files, path.join(temp,"Checks.swift"), "-o", path.join(temp,"check")], {encoding:"utf8", timeout:120000});
    assert.equal(compiled.status,0,compiled.stderr);
    const run = spawnSync(path.join(temp,"check"),[],{encoding:"utf8",timeout:120000});
    assert.equal(run.status,0,run.stderr);
    assert.match(run.stdout,/Media foundation PASS/);
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});

// Run the production AppModel download method over a real HTTP server and real URLSession.
test("actual Swift download-slot path honors headers, verifies bytes, retries and reuses originals", {skip:process.platform !== "darwin"}, async () => {
  const { createServer } = await import("node:http");
  const { spawn } = await import("node:child_process");
  const counts = new Map<string,number>();
  const server = createServer((request,response) => {
    const name = request.url!.slice(1);
    counts.set(name,(counts.get(name) ?? 0)+1);
    assert.equal(request.method,"GET");
    assert.equal(request.headers["x-media-slot"],"capability");
    if (name === "retry" && counts.get(name) === 1) { response.writeHead(503); response.end(); return; }
    const valid = Buffer.from("verified content");
    response.end(counts.get(name) === 1 && name === "size" ? valid.subarray(1)
      : counts.get(name) === 1 && name === "sha" ? Buffer.alloc(valid.length) : valid);
  });
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),"leilei-media-http-"));
  try {
    const source = fs.readFileSync("ios/LeileiOS/LeileiOS/App/NativeLiveAttachmentCoordination.swift","utf8");
    fs.writeFileSync(path.join(temp,"Download.swift"),source.slice(0,source.indexOf("    func uploadNativeLiveAttachment"))+"}\n");
    const root = "ios/LeileiOS/LeileiOS/";
    const compiled = spawnSync("xcrun",["swiftc","-parse-as-library","-module-cache-path",path.join(temp,"cache"),
      root+"Infrastructure/NativeLiveRuntimeModels.swift",root+"Infrastructure/API/NativeLive/NativeLiveModels.swift",root+"Infrastructure/API/NativeLive/NativeLiveInputMode.swift",
      ...["NativeLiveMessagePresentation","NativeLiveMessagePresentationProjection","NativeLiveMarkdownModel", "NativeLiveRichTextProjection", "NativeLiveVisualNode", "NativeLiveVisualRendererRegistry", "NativeLiveVisualSandboxModel", "NativeLiveSVGModel", "NativeLiveStructuredToolResult", "NativeLiveCitationPresentation", "NativeLiveStructuredJSON","NativeLiveMediaPresentation","NativeLiveAttachmentCache"].map(n=>root+"Chat/MessageSurface/"+n+".swift"),
      path.join(temp,"Download.swift"),"tests/fixtures/native-live-media-transport.swift","-o",path.join(temp,"check")],{encoding:"utf8",timeout:120000});
    assert.equal(compiled.status,0,compiled.stderr);
    const address = server.address() as {port:number};
    const ran = await new Promise<{code:number|null,stdout:string,stderr:string}>((resolve,reject) => {
      const child = spawn(path.join(temp,"check"),[`http://127.0.0.1:${address.port}`],{timeout:60_000});
      let stdout="",stderr="";
      child.stdout.on("data",data=>stdout+=data); child.stderr.on("data",data=>stderr+=data);
      child.on("error",reject); child.on("close",code=>resolve({code,stdout,stderr}));
    });
    assert.equal(ran.code,0,ran.stderr); assert.match(ran.stdout,/Media transport PASS/);
    assert.deepEqual(Object.fromEntries(counts),{valid:1,size:2,sha:2,retry:2});
  } finally {
    await new Promise<void>((resolve,reject) => server.close(error=>error?reject(error):resolve()));
    fs.rmSync(temp,{recursive:true,force:true});
  }
});

test("capped gallery entry remains interactive independent of thumbnail load and retry routes to the failed operation", () => {
  const source = fs.readFileSync("ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMediaRenderer.swift","utf8");
  const capped = source.slice(source.indexOf("if index == 3 && group.count > 4"),source.indexOf("} else if let input = group.first"));
  assert.match(capped,/Button\s*\{\s*gallery =/);
  assert.doesNotMatch(capped,/allowsHitTesting\(false\)/);
  assert.match(source,/case \.openFile: open\(\)/);
});


test("single meme webp uses a bounded sticker layout without changing ordinary image grids", () => {
  const presentation = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMediaPresentation.swift",
    "utf8",
  );
  const renderer = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMediaRenderer.swift",
    "utf8",
  );

  assert.match(
    presentation,
    /\^meme_\[0-9\]\{4,32\}\\\.webp\$/,
  );
  assert.match(
    renderer,
    /group\.count == 1[\s\S]*input\.isMemeSticker[\s\S]*stickerImage:true/,
  );
  assert.match(
    renderer,
    /private var stickerTile:[\s\S]*\.scaledToFit\(\)[\s\S]*maxWidth:220[\s\S]*maxHeight:220/,
  );
  assert.match(
    renderer,
    /NativeLiveMediaGrid\(count:group\.count\)/,
  );
});
