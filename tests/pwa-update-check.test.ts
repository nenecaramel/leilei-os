import assert from "node:assert/strict";
import test from "node:test";
import {
  PWA_UPDATE_THROTTLE_MS,
  createPwaUpdateChecker,
} from "../web/src/pwa/pwa-update-check.js";

type FakeRegistration = {
  installing: object | null;
  update: () => Promise<void>;
};

function createRegistration(): FakeRegistration & { updates: number } {
  let updates = 0;
  return {
    installing: null,
    update: async () => {
      updates += 1;
    },
    get updates() {
      return updates;
    },
  };
}

function response(status: number): Response {
  return { status } as Response;
}

test("eligible update checks probe the SW without cache and then update once", async () => {
  const registration = createRegistration();
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const checker = createPwaUpdateChecker({
    registration,
    swUrl: "/sw.js",
    now: () => 0,
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return response(200);
    },
  });

  await checker.check();

  assert.equal(registration.updates, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "/sw.js");
  assert.equal(requests[0]?.init?.cache, "no-store");
  assert.deepEqual(requests[0]?.init?.headers, {
    "cache-control": "no-cache",
    cache: "no-store",
  });
});

test("offline checks perform neither the SW probe nor registration update", async () => {
  const registration = createRegistration();
  let requests = 0;
  const checker = createPwaUpdateChecker({
    registration,
    swUrl: "/sw.js",
    isOnline: () => false,
    fetchImpl: async () => {
      requests += 1;
      return response(200);
    },
  });

  await checker.check();

  assert.equal(requests, 0);
  assert.equal(registration.updates, 0);
});

test("an installing service worker defers the update check", async () => {
  const registration = createRegistration();
  registration.installing = {};
  let requests = 0;
  const checker = createPwaUpdateChecker({
    registration,
    swUrl: "/sw.js",
    fetchImpl: async () => {
      requests += 1;
      return response(200);
    },
  });

  await checker.check();

  assert.equal(requests, 0);
  assert.equal(registration.updates, 0);
});

test("a non-200 SW probe never calls registration.update", async () => {
  const registration = createRegistration();
  const checker = createPwaUpdateChecker({
    registration,
    swUrl: "/sw.js",
    fetchImpl: async () => response(304),
  });

  await checker.check();

  assert.equal(registration.updates, 0);
});

test("a rejected SW probe is contained and can be retried after throttling", async () => {
  const registration = createRegistration();
  let now = 0;
  let requests = 0;
  const checker = createPwaUpdateChecker({
    registration,
    swUrl: "/sw.js",
    now: () => now,
    fetchImpl: async () => {
      requests += 1;
      if (requests === 1) throw new Error("network unavailable");
      return response(200);
    },
  });

  await checker.check();
  now = PWA_UPDATE_THROTTLE_MS;
  await checker.check();

  assert.equal(requests, 2);
  assert.equal(registration.updates, 1);
});

test("duplicate foreground checks inside the throttle window share one operation", async () => {
  const registration = createRegistration();
  let resolveProbe!: (value: Response) => void;
  const probe = new Promise<Response>((resolve) => {
    resolveProbe = resolve;
  });
  let requests = 0;
  const checker = createPwaUpdateChecker({
    registration,
    swUrl: "/sw.js",
    fetchImpl: async () => {
      requests += 1;
      return probe;
    },
  });

  const first = checker.check();
  const second = checker.check();
  resolveProbe(response(200));
  await Promise.all([first, second]);

  assert.equal(requests, 1);
  assert.equal(registration.updates, 1);
});

test("a foreground check after the throttle window can run again", async () => {
  const registration = createRegistration();
  let now = 0;
  let requests = 0;
  const checker = createPwaUpdateChecker({
    registration,
    swUrl: "/sw.js",
    now: () => now,
    fetchImpl: async () => {
      requests += 1;
      return response(200);
    },
  });

  await checker.check();
  now += PWA_UPDATE_THROTTLE_MS - 1;
  await checker.check();
  now += 1;
  await checker.check();

  assert.equal(requests, 2);
  assert.equal(registration.updates, 2);
});

test("missing registration is a safe no-op", async () => {
  let requests = 0;
  const checker = createPwaUpdateChecker({
    registration: undefined,
    swUrl: "/sw.js",
    fetchImpl: async () => {
      requests += 1;
      return response(200);
    },
  });

  await checker.check();

  assert.equal(requests, 0);
});
