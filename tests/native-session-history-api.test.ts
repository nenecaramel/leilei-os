import { projectNativeHistory } from "../tools/claude-bridge/src/native-session-history.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createNativeLiveProviderSessionStoreInternalRouter } from "../src/web-api/native-live-provider-session-store-internal-router.js";
import { withServer, userId, conversationId } from "./helpers/native-live-http-relay-fixtures.js";
const sid = "00000000-0000-4000-8000-000000000031";
const cp = "00000000-0000-4000-8000-000000000032";
const revision = "a".repeat(64);
const entries = [{ type: "user", uuid: conversationId, parentUuid: null, message: { content: "PRIVATE_PROMPT" } }, { type: "assistant", uuid: cp, parentUuid: conversationId, message: { content: "PRIVATE_CONTENT" } }];
const body = () => ({ conversationId, expectedHeadMessageId: null, expectedRevision: null, effectiveWorkingDirectory: "/synthetic", projection: projectNativeHistory({ sessionId: sid, revision, entries }, cp), nativeSnapshot: { sessionId: sid, revision, entries } });
async function server(restore: any, run: (url: string) => Promise<void>, authenticated = true) {
  await withServer(app => {
    if (authenticated) app.use((request, _response, next) => { request.mcpUserId = userId; next(); });
    app.use("/store", createNativeLiveProviderSessionStoreInternalRouter({ providerSessionStoreService: {} as any, restoreNativeHistory: restore } as any));
  }, run);
}
test("legacy full-history endpoints are retired and cannot reach old writers", async () => {
  let called = 0;
  const forbidden = async () => { called++; throw new Error("OLD_WRITER_CALLED"); };
  await withServer(app => {
    app.use((request, _response, next) => { request.mcpUserId = userId; next(); });
    app.use("/store", createNativeLiveProviderSessionStoreInternalRouter({
      providerSessionStoreService: {} as any,
      restoreNativeHistory: forbidden,
      readNativeHistoryState: forbidden,
      releaseNativeHistory: forbidden,
      nativeHistoryAsset: forbidden,
      stageNativeHistoryAssets: forbidden,
    } as any));
  }, async url => {
    for (const name of ["restore", "state", "release", "asset", "asset-stage"]) {
      const response = await fetch(url + "/store/native-history/" + name, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body()),
      });
      assert.equal(response.status, 410, name);
      const text = await response.text();
      assert.equal(JSON.parse(text).error.code, "NATIVE_FULL_HISTORY_RETIRED");
      assert.doesNotMatch(text, /PRIVATE_PROMPT|PRIVATE_CONTENT|OLD_WRITER_CALLED/);
    }
    assert.equal(called, 0);
  });
  await server(forbidden, async url => {
    for (const name of ["restore", "state", "release", "asset", "asset-stage"]) {
      const response = await fetch(url + "/store/native-history/" + name, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body()),
      });
      assert.equal(response.status, 401, name);
    }
  }, false);
});

test("native-history-assets transport rejects copies but leaves regular SessionStore append working", async () => {
  let calls = 0;
  await withServer(app => {
    app.use((request, _response, next) => { request.mcpUserId = userId; next(); });
    app.use("/store", createNativeLiveProviderSessionStoreInternalRouter({
      providerSessionStoreService: {
        append: async () => { calls++; },
      } as any,
    }));
  }, async url => {
    const send = async (subpath: string) => fetch(url + "/store/append", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: { session_id: sid, subpath },
        append_batch_id: cp, entries: [{ type: "assistant" }] }),
    });
    const blocked = await send("native-history-assets/" + revision);
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).error.code, "LEGACY_ASSET_WRITE_DISABLED");
    assert.equal(calls, 0, "old JSONB image copy must never reach the writer");
    assert.equal((await send("")).status, 200);
    assert.equal(calls, 1, "ordinary provider transcript append remains available");
  });
});

test("referenced-sessions endpoint binds the authenticated owner and takes no input", async () => {
  await withServer(app => {
    app.use((request, _response, next) => { request.mcpUserId = userId; next(); });
    app.use("/store", createNativeLiveProviderSessionStoreInternalRouter({ providerSessionStoreService: {} as any,
      listReferencedNativeSessions: async (input: any) => { assert.deepEqual(input, { userId }); return { sessionIds: [sid] }; } } as any));
  }, async url => {
    const send = (body: any) => fetch(url + "/store/native-history/referenced-sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const ok = await send({});
    assert.equal(ok.status, 200);
    assert.deepEqual((await ok.json()).data, { sessionIds: [sid] });
    assert.equal((await send({ userId: sid })).status, 400);
  });
});

test('continuation endpoints accept only authenticated metadata, never a history payload or spoofed owner', async () => {
  const value = { conversationId, sessionId: sid, checkpointId: cp, revision, effectiveWorkingDirectory: '/synthetic',
    expectedHeadMessageId: null, expectedRevision: null, checkpointIds: [cp], completedTurnCheckpointIds: [cp] };
  let calls = 0;
  await withServer(app => {
    app.use((request, _response, next) => { request.mcpUserId = userId; next(); });
    app.use('/store', createNativeLiveProviderSessionStoreInternalRouter({ providerSessionStoreService: {} as any,
      attachNativeContinuation: async input => { calls++; assert.equal(input.userId, userId); return { outcome: 'attached', owner: 'leileios', conversationId, providerSessionId: sid, providerCheckpointId: cp, headMessageId: null, inserted: 0 }; },
    }));
  }, async url => {
    const send = (body: unknown) => fetch(url + '/store/native-history/continuation-attach', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await send(value)).status, 200);
    for (const invalid of [{ ...value, projection: body().projection }, { ...value, userId: sid }, { ...value, nativeSnapshot: entries },
      { ...value, expectedHeadMessageId: undefined }, { ...value, checkpointIds: [] }, { ...value, completedTurnCheckpointIds: [sid] }]) assert.equal((await send(invalid)).status, 400);
    assert.equal(calls, 1);
  });
  await withServer(app => app.use('/store', createNativeLiveProviderSessionStoreInternalRouter({ providerSessionStoreService: {} as any })), async url => {
    assert.equal((await fetch(url + '/store/native-history/continuation-state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conversationId, sessionId: sid }) })).status, 401);
  });
});


test("retired full-history HTTP handlers carry no production dependency wiring", async () => {
  for (const path of ["src/web-api/native-live-provider-session-store-internal-router.ts", "src/app/create-app.ts", "src/app/process-runtime.ts"]) {
    const source = await readFile(new URL("../" + path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\b(?:restoreNativeHistory|readNativeHistoryState|releaseNativeHistory|nativeHistoryAsset|stageNativeHistoryAssets)\b/, path);
    assert.doesNotMatch(source, /function nativeHistory(?:Restore|State|Release|Asset|AssetStage)Handler\b/, path);
  }
});

test('failed native continuation recovery accepts only authenticated UUID metadata on attach',async()=>{
 const value={conversationId,sessionId:sid,checkpointId:cp,revision,effectiveWorkingDirectory:'/synthetic',expectedHeadMessageId:null,expectedRevision:null,checkpointIds:[cp],completedTurnCheckpointIds:[cp],recoveredFailedTurnId:conversationId};let calls=0;
 await withServer(app=>{app.use((request,_response,next)=>{request.mcpUserId=userId;next();});app.use('/store',createNativeLiveProviderSessionStoreInternalRouter({providerSessionStoreService:{} as any,attachNativeContinuation:async input=>{calls++;assert.equal(input.recoveredFailedTurnId,conversationId);assert.equal(input.userId,userId);return {outcome:'attached',owner:'leileios',conversationId,providerSessionId:sid,providerCheckpointId:cp,headMessageId:null,inserted:0};}}));},async url=>{
  const send=(route:string,body:unknown)=>fetch(url+'/store/native-history/'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await send('continuation-attach',value)).status,200);
  assert.equal((await send('continuation-attach',{...value,recoveredFailedTurnId:'invalid'})).status,400);
  assert.equal((await send('continuation-attach',{...value,owner:'leileios'})).status,400);
  assert.equal((await send('continuation-release',value)).status,400);assert.equal(calls,1);
 });
});
