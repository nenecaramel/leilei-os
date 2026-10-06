import assert from "node:assert/strict";
import test from "node:test";
import { NativeLiveProviderSessionStoreService } from "../src/domains/bridge/provider-session/native-live-provider-session-store.js";

test("SessionStore accepts provider session and subpath without a product identity", async () => {
  const reads: unknown[] = [];
  const repository = { async load(input: unknown) { reads.push(input); return [{ type: "user", text: "durable" }]; } };
  const service = new NativeLiveProviderSessionStoreService(repository as never);
  assert.deepEqual(await service.load({ userId: "tenant-a", key: { sessionId: "sdk-session", subpath: "subagents/a" } }), [{ type: "user", text: "durable" }]);
  assert.deepEqual(reads, [{ userId: "tenant-a", key: { sessionId: "sdk-session", subpath: "subagents/a" } }]);
});
