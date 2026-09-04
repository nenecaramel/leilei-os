import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  createSecureMetadataFetcher,
  type MetadataRequestOptions,
  type ResolvedHostAddress,
} from "../src/oauth/secure-metadata-fetch.js";

const CLIENT_ID = "https://claude.ai/oauth/mcp-oauth-client-metadata";

function address(value: string, family: 4 | 6 = value.includes(":") ? 6 : 4): ResolvedHostAddress {
  return { address: value, family };
}

class FakeResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = { "content-type": "application/json" };
}

class FakeRequest extends EventEmitter {
  timeoutMs: number | undefined;
  destroyedWith: Error | undefined;

  setTimeout(timeoutMs: number): this {
    this.timeoutMs = timeoutMs;
    return this;
  }

  destroy(error?: Error): this {
    this.destroyedWith = error;
    if (error) queueMicrotask(() => this.emit("error", error));
    return this;
  }
}

function fakeRequestFactory(body = '{"client_id":"ok"}') {
  let options: MetadataRequestOptions | undefined;
  const request = new FakeRequest();
  const response = new FakeResponse();
  const factory = (
    nextOptions: MetadataRequestOptions,
    callback: (response: FakeResponse) => void,
  ): FakeRequest => {
    options = nextOptions;
    queueMicrotask(() => {
      callback(response);
      queueMicrotask(() => {
        response.emit("data", Buffer.from(body));
        response.emit("end");
      });
    });
    return request;
  };
  return { factory, request, response, getOptions: () => options };
}

function createFetcher(
  resolveHost: (hostname: string) => Promise<readonly ResolvedHostAddress[]>,
  requestFactory = fakeRequestFactory(),
) {
  return {
    fetcher: createSecureMetadataFetcher({
      resolveHost,
      request: requestFactory.factory,
      timeoutMs: 500,
    }),
    requestFactory,
  };
}

test("rejects non-HTTPS, credentialed, queried, fragmented, and root CIMD URLs", async () => {
  const { fetcher } = createFetcher(async () => [address("93.184.216.34")]);
  for (const value of [
    "http://claude.ai/oauth/mcp-oauth-client-metadata",
    "https://user:pass@claude.ai/oauth/mcp-oauth-client-metadata",
    "https://claude.ai/oauth/mcp-oauth-client-metadata?x=1",
    "https://claude.ai/oauth/mcp-oauth-client-metadata#fragment",
    "https://claude.ai/",
  ]) {
    await assert.rejects(fetcher.fetch(value), /invalid CIMD URL/u);
  }
});

test("rejects special-use IP literals even if an injected resolver lies about the answer", async () => {
  let opened = false;
  const fetcher = createSecureMetadataFetcher({
    resolveHost: async () => [address("93.184.216.34")],
    request: () => {
      opened = true;
      throw new Error("request must not open");
    },
  });
  await assert.rejects(fetcher.fetch("https://127.0.0.1/client.json"), /special-use|unsafe/u);
  assert.equal(opened, false);
});

test("rejects every special-use DNS answer before opening an HTTPS request", async () => {
  for (const special of [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.0.0.1",
    "192.0.2.1",
    "192.31.196.1",
    "192.52.193.1",
    "192.168.1.1",
    "192.175.48.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:8.8.8.8",
    "64:ff9b::1",
    "100::1",
    "100:0:0:1::1",
    "2001:1::1",
    "2001:3::1",
    "2002::1",
    "3fff::1",
    "5f00::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
  ]) {
    let opened = false;
    const { fetcher } = createFetcher(async () => [address(special)]);
    const result = createSecureMetadataFetcher({
      resolveHost: async () => [address(special)],
      request: () => {
        opened = true;
        throw new Error("request must not open");
      },
      timeoutMs: 500,
    });
    await assert.rejects(result.fetch(CLIENT_ID), /special-use|unsafe/u);
    assert.equal(opened, false, special);
    void fetcher;
  }
});

test("fails closed when any DNS answer is special-use and rejects redirects or non-200 responses", async () => {
  const { fetcher } = createFetcher(async () => [
    address("93.184.216.34"),
    address("192.168.1.10"),
  ]);
  await assert.rejects(fetcher.fetch(CLIENT_ID), /special-use|unsafe/u);

  const redirect = fakeRequestFactory();
  redirect.response.statusCode = 302;
  const redirectFetcher = createFetcher(
    async () => [address("93.184.216.34")],
    redirect,
  ).fetcher;
  await assert.rejects(redirectFetcher.fetch(CLIENT_ID), /status 200|redirect/u);
});

test("caps the response body, requires JSON, and accepts only an object", async () => {
  const oversized = fakeRequestFactory("x".repeat(5_121));
  await assert.rejects(
    createFetcher(async () => [address("93.184.216.34")], oversized).fetcher.fetch(CLIENT_ID),
    /5 KiB|too large|size/u,
  );

  const text = fakeRequestFactory('{"client_id":"ok"}');
  text.response.headers["content-type"] = "text/plain";
  await assert.rejects(
    createFetcher(async () => [address("93.184.216.34")], text).fetcher.fetch(CLIENT_ID),
    /JSON|content-type/u,
  );

  for (const json of ["[]", "null", '"string"', "42"]) {
    const invalid = fakeRequestFactory(json);
    await assert.rejects(
      createFetcher(async () => [address("93.184.216.34")], invalid).fetcher.fetch(CLIENT_ID),
      /JSON object|object/u,
    );
  }
});

test("pins the approved address while retaining the original hostname for TLS verification", async () => {
  const requestFactory = fakeRequestFactory('{"client_id":"ok"}');
  const { fetcher } = createFetcher(
    async (hostname) => {
      assert.equal(hostname, "claude.ai");
      return [address("93.184.216.34")];
    },
    requestFactory,
  );

  assert.deepEqual(await fetcher.fetch(CLIENT_ID), { client_id: "ok" });
  const options = requestFactory.getOptions();
  assert.ok(options);
  assert.equal(options.hostname, "claude.ai");
  assert.equal(options.servername, "claude.ai");
  assert.equal(options.rejectUnauthorized, undefined);
  assert.equal(typeof options.lookup, "function");

  const pinned = await new Promise<string>((resolve, reject) => {
    options.lookup?.("claude.ai", {}, (error, result) => {
      if (error) reject(error);
      else resolve(result as ResolvedHostAddress);
    });
  });
  assert.equal(pinned, "93.184.216.34");
});

test("enforces a timeout on the metadata request", async () => {
  const requestFactory = fakeRequestFactory();
  requestFactory.factory = (options, _callback) => {
    requestFactory.request.timeoutMs = undefined;
    const request = requestFactory.request;
    request.setTimeout(options.timeoutMs ?? 500);
    queueMicrotask(() => request.emit("timeout"));
    return request;
  };
  await assert.rejects(
    createFetcher(async () => [address("93.184.216.34")], requestFactory).fetcher.fetch(CLIENT_ID),
    /timed out|timeout/u,
  );
  assert.equal(requestFactory.request.timeoutMs, 500);
});

test("enforces a timeout while resolving the metadata hostname", async () => {
  const fetcher = createSecureMetadataFetcher({
    resolveHost: async () => await new Promise<never>(() => {}),
    request: () => {
      throw new Error("request must not open");
    },
    timeoutMs: 20,
  });
  await assert.rejects(
    fetcher.fetch(CLIENT_ID),
    /DNS resolution failed/u,
  );
});
