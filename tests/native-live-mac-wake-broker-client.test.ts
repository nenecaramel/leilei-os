import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveMacWakeBrokerClient,
} from "../src/domains/bridge/native-live-mac-wake-broker-client.js";

test("Mac wake broker client snapshots and waits with a durable cursor", async () => {
  const requests: Array<{
    url: string;
    init: RequestInit;
  }> = [];
  let waitCall = 0;
  const client = new NativeLiveMacWakeBrokerClient(
    "https://wake.example/",
    "wake-token-that-is-long-enough-for-tests",
    (async (url, init) => {
      requests.push({
        url: String(url),
        init: init ?? {},
      });
      if (String(url).endsWith("/state")) {
        return new Response(
          JSON.stringify({
            generation: "generation-a",
            version: 4,
          }),
          { status: 200 },
        );
      }
      waitCall += 1;
      return new Response(
        JSON.stringify({
          outcome: waitCall === 1 ? "ready" : "reset",
          generation:
            waitCall === 1
              ? "generation-a"
              : "generation-b",
          version: waitCall === 1 ? 5 : 0,
        }),
        { status: 200 },
      );
    }) as typeof fetch,
  );

  const cursor = await client.snapshot();
  assert.deepEqual(cursor, {
    generation: "generation-a",
    version: 4,
  });

  const ready = await client.wait({ cursor });
  assert.deepEqual(ready, {
    outcome: "ready",
    cursor: {
      generation: "generation-a",
      version: 5,
    },
  });

  const reset = await client.wait({
    cursor: ready.cursor,
  });
  assert.deepEqual(reset, {
    outcome: "reset",
    cursor: {
      generation: "generation-b",
      version: 0,
    },
  });

  assert.equal(requests.length, 3);
  assert.equal(
    (requests[0]?.init.headers as Record<string, string>)
      .authorization,
    "Bearer wake-token-that-is-long-enough-for-tests",
  );
  assert.deepEqual(
    JSON.parse(String(requests[1]?.init.body)),
    {
      generation: "generation-a",
      after_version: 4,
      timeout_ms: 25_000,
    },
  );
});

test("Mac wake broker client fails closed on malformed responses", async () => {
  const client = new NativeLiveMacWakeBrokerClient(
    "https://wake.example",
    "wake-token-that-is-long-enough-for-tests",
    (async () =>
      new Response(
        JSON.stringify({
          generation: "",
          version: -1,
        }),
        { status: 200 },
      )) as typeof fetch,
  );

  await assert.rejects(
    () => client.snapshot(),
    /invalid cursor/u,
  );
});
