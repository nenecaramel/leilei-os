import { projectNativeHistory } from "../tools/claude-bridge/src/native-session-history.mjs";
import assert from "node:assert/strict";
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
const post = (url: string, value: any) => fetch(url + "/store/native-history/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
test("native history internal restore binds authenticated owner and returns no transcript", async () => {
  await server(async (input: any) => {
    assert.equal(input.userId, userId);
    assert.deepEqual(input.nativeSnapshot, body().nativeSnapshot);
    return { outcome: "restored", conversationId, headMessageId: cp, inserted: 2 };
  }, async url => {
    const response = await post(url, body()); assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const text = await response.text(); assert.doesNotMatch(text, /PRIVATE_CONTENT|nativeSnapshot/);
    assert.equal(JSON.parse(text).data.inserted, 2);
  });
});
test("native history rejects unauthenticated, missing snapshot and spoofed owner requests without writes", async () => {
  const deny = async () => assert.fail("invalid restore must not reach writer");
  await server(deny, async url => assert.equal((await post(url, body())).status, 401), false);
  await server(deny, async url => {
    const noSnapshot: any = body(); delete noSnapshot.nativeSnapshot;
    assert.equal((await post(url, noSnapshot)).status, 400);
    assert.equal((await post(url, { ...body(), userId: sid })).status, 400);
  });
});
test("native history surfaces busy/stale conflict without leaking database errors", async () => {
  for (const code of ["NATIVE_CONVERSATION_BUSY", "STALE_NATIVE_PROJECTION"]) await server(async () => { throw Object.assign(new Error("PRIVATE_SQL"), { code }); }, async url => {
    const response = await post(url, body()); assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, code);
  });
  await server(async () => { throw new Error("PRIVATE_SQL"); }, async url => {
    const response = await post(url, body()); assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /PRIVATE_SQL/);
  });
});

test("Desktop release endpoint binds owner and accepts only exact handoff evidence", async () => {
  let calls = 0;
  await withServer(app => {
    app.use((request, _response, next) => { request.mcpUserId = userId; next(); });
    app.use('/store', createNativeLiveProviderSessionStoreInternalRouter({ providerSessionStoreService: {} as any,
      releaseNativeHistory: async input => {
        calls++; assert.equal(input.userId, userId);
        assert.equal(input.expectedCheckpointId, cp);
        return { owner: 'desktop', conversationId, providerSessionId: sid, providerCheckpointId: cp, headMessageId: cp };
      } } as any));
  }, async url => {
    const send = (value: any) => fetch(url + '/store/native-history/release', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
    const input = { conversationId, sessionId: sid, expectedHeadMessageId: cp, expectedRevision: revision, expectedCheckpointId: cp };
    assert.equal((await send(input)).status, 200);
    assert.equal((await send({ ...input, userId: sid })).status, 400);
    assert.equal((await send({ ...input, expectedRevision: 'bad' })).status, 400);
    assert.equal(calls, 1);
  });
});
