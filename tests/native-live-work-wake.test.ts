import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  NativeLiveHttpWakeSignal,
  NativeLiveWorkWakeBroker,
} from "../src/domains/bridge/native-live-work-wake.js";

type FakeClientState = {
  listenCalls: number;
  endCalls: number;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createBroker(idleReleaseMs = 5) {
  const clients: FakeClientState[] = [];
  const broker = new NativeLiveWorkWakeBroker(
    "postgres://wake-test.invalid/db",
    {
      idleReleaseMs,
      createClient: () => {
        const state: FakeClientState = {
          listenCalls: 0,
          endCalls: 0,
        };
        clients.push(state);
        return {
          async listen() {
            state.listenCalls += 1;
          },
          async end() {
            state.endCalls += 1;
          },
        };
      },
    },
  );
  return { broker, clients };
}

test("wake broker releases LISTEN after the final lease and reopens on demand", async () => {
  const { broker, clients } = createBroker();

  await broker.start();
  await broker.start();
  assert.equal(clients.length, 1);
  assert.equal(clients[0]?.listenCalls, 1);

  await broker.release();
  await delay(10);
  assert.equal(
    clients[0]?.endCalls,
    0,
    "one remaining lease must keep the listener alive",
  );

  await broker.release();
  await delay(10);
  assert.equal(clients[0]?.endCalls, 1);

  await broker.start();
  assert.equal(clients.length, 2);
  assert.equal(clients[1]?.listenCalls, 1);

  await broker.release();
  await delay(10);
  assert.equal(clients[1]?.endCalls, 1);

  await broker.close();
});

test("wake broker keeps LISTEN alive while an active waiter still exists", async () => {
  const { broker, clients } = createBroker();

  await broker.start();
  const waiting = broker.waitForChange({
    userId: "11111111-1111-4111-8111-111111111111",
    afterVersion: 0,
    timeoutMs: 20,
  });

  await broker.release();
  await delay(10);
  assert.equal(clients[0]?.endCalls, 0);

  assert.deepEqual(await waiting, {
    outcome: "timeout",
    version: 0,
  });

  await delay(10);
  assert.equal(clients[0]?.endCalls, 1);

  await broker.close();
});

test("wake broker reuses a listener when the next lease arrives inside the idle grace", async () => {
  const { broker, clients } = createBroker(25);

  await broker.start();
  await broker.release();
  await delay(5);

  await broker.start();
  assert.equal(clients.length, 1);
  assert.equal(clients[0]?.endCalls, 0);

  await broker.release();
  await delay(35);
  assert.equal(clients[0]?.endCalls, 1);

  await broker.close();
});


test("durable work availability includes pending Mind semantic grouping requests", () => {
  const source = readFileSync(
    new URL("../src/domains/bridge/native-live-work-wake.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /FROM runtime_mind_semantic_grouping_requests AS grouping[\s\S]*grouping\.status = 'pending'[\s\S]*grouping\.status = 'reserved'/,
  );
});

test("external wake signal posts only a bounded readiness hint", async () => {
  const requests: Array<{
    url: string;
    init: RequestInit;
  }> = [];
  const signal = new NativeLiveHttpWakeSignal(
    "https://wake.example/",
    "wake-token-that-is-long-enough-for-tests",
    (async (url, init) => {
      requests.push({
        url: String(url),
        init: init ?? {},
      });
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  );

  await signal.notify({ kind: "foreground" });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://wake.example/wake");
  assert.equal(requests[0]?.init.method, "POST");
  assert.equal(
    (requests[0]?.init.headers as Record<string, string>)
      .authorization,
    "Bearer wake-token-that-is-long-enough-for-tests",
  );
  assert.deepEqual(
    JSON.parse(String(requests[0]?.init.body)),
    { kind: "foreground" },
  );
});

test("external wake signal reads broker listener presence", async () => {
  const signal = new NativeLiveHttpWakeSignal(
    "https://wake.example",
    "wake-token-that-is-long-enough-for-tests",
    (async (url) => {
      assert.equal(
        String(url),
        "https://wake.example/presence",
      );
      return new Response(
        JSON.stringify({ online: true }),
        { status: 200 },
      );
    }) as typeof fetch,
  );

  assert.equal(await signal.isListenerOnline(), true);
});
