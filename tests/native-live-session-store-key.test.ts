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


test("SessionStore accepts a legitimate Claude entry above the retired 6.5mb ceiling", async () => {
  const writes: unknown[] = [];
  const repository = {
    async append(input: unknown) {
      writes.push(input);
    },
  };
  const service = new NativeLiveProviderSessionStoreService(
    repository as never,
  );
  const entry = {
    type: "assistant",
    payload: "x".repeat(9_000_000),
  };

  await service.append({
    userId: "tenant-a",
    key: { sessionId: "sdk-session" },
    appendBatchId: "11111111-1111-4111-8111-111111111111",
    entries: [entry],
  });

  assert.equal(writes.length, 1);
  const write = writes[0] as {
    entries: Array<{ payload: string }>;
  };
  assert.equal(write.entries[0]?.payload.length, 9_000_000);
});
