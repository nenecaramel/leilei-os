import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveConversationHeadWaitService,
} from "../src/domains/bridge/relay/native-live-conversation-head-wait.js";

const userId = "11111111-1111-4111-8111-111111111111";
const conversationId = "33333333-3333-4333-8333-333333333333";
const firstHead = "44444444-4444-4444-8444-444444444444";
const secondHead = "55555555-5555-4555-8555-555555555555";

function fakeDb(heads: Array<string | null | undefined>) {
  let index = 0;
  return {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                async limit() {
                  const head = heads[
                    Math.min(index, heads.length - 1)
                  ];
                  index += 1;
                  return head === undefined
                    ? []
                    : [{ currentHeadMessageId: head }];
                },
              };
            },
          };
        },
      };
    },
  };
}

test("conversation head wait returns immediately when the head already changed", async () => {
  let starts = 0;
  const service = new NativeLiveConversationHeadWaitService(
    fakeDb([secondHead]) as never,
    {
      async start() { starts += 1; },
      async release() {},
      version() { return 0; },
      async waitForChange() {
        throw new Error("must not wait");
      },
    } as never,
  );

  assert.deepEqual(
    await service.wait({
      userId,
      conversationId,
      afterHeadMessageId: firstHead,
      timeoutMs: 25_000,
    }),
    {
      outcome: "changed",
      currentHeadMessageId: secondHead,
    },
  );
  assert.equal(starts, 0);
});

test("conversation head wait closes the missed-notify race with a second read", async () => {
  let waits = 0;
  let releases = 0;
  const service = new NativeLiveConversationHeadWaitService(
    fakeDb([firstHead, secondHead]) as never,
    {
      async start() {},
      async release() { releases += 1; },
      version() { return 7; },
      async waitForChange() {
        waits += 1;
        return { outcome: "ready" as const, version: 8 };
      },
    } as never,
  );

  assert.deepEqual(
    await service.wait({
      userId,
      conversationId,
      afterHeadMessageId: firstHead,
      timeoutMs: 25_000,
    }),
    {
      outcome: "changed",
      currentHeadMessageId: secondHead,
    },
  );
  assert.equal(waits, 0);
  assert.equal(releases, 1);
});

test("conversation head wait ignores unrelated user wakes and keeps the bounded wait", async () => {
  let waits = 0;
  const service = new NativeLiveConversationHeadWaitService(
    fakeDb([firstHead, firstHead, firstHead, secondHead]) as never,
    {
      async start() {},
      async release() {},
      version() { return waits; },
      async waitForChange() {
        waits += 1;
        return { outcome: "ready" as const, version: waits };
      },
    } as never,
  );

  assert.deepEqual(
    await service.wait({
      userId,
      conversationId,
      afterHeadMessageId: firstHead,
      timeoutMs: 25_000,
    }),
    {
      outcome: "changed",
      currentHeadMessageId: secondHead,
    },
  );
  assert.equal(waits, 2);
});

test("conversation head wait returns null for a missing or inactive conversation", async () => {
  const service = new NativeLiveConversationHeadWaitService(
    fakeDb([undefined]) as never,
    {
      async start() {},
      async release() {},
      version() { return 0; },
      async waitForChange() {
        throw new Error("must not wait");
      },
    } as never,
  );

  assert.equal(
    await service.wait({
      userId,
      conversationId,
      afterHeadMessageId: null,
      timeoutMs: 25_000,
    }),
    null,
  );
});
