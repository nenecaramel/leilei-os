import assert from "node:assert/strict";
import test from "node:test";
import { createAuth0CodeExchange } from "../src/oauth/upstream-client.js";

const input = {
  code: "upstream-code",
  clientId: "upstream-client",
  redirectUri: "https://mcp.example.test/oauth/callback",
  codeVerifier: "v".repeat(43),
  resource: "https://mcp.example.test/mcp",
  audience: "https://mcp.example.test/mcp",
};

test("exchanges an upstream code over a bounded POST without client secrets or redirects", async () => {
  let request: RequestInit | undefined;
  const exchange = createAuth0CodeExchange({
    tokenEndpoint: "https://issuer.example.test/oauth/token",
    fetch: async (_url, init) => {
      request = init;
      return new Response(JSON.stringify({ access_token: "auth0-access-token", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.deepEqual(await exchange(input), { accessToken: "auth0-access-token", expiresIn: 3600 });
  assert.equal(request?.method, "POST");
  assert.equal(request?.redirect, "error");
  assert.equal((request?.headers as Record<string, string>)["content-type"], "application/x-www-form-urlencoded");
  const body = new URLSearchParams(request?.body as string);
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("client_id"), "upstream-client");
  assert.equal(body.get("code"), "upstream-code");
  assert.equal(body.get("resource"), input.resource);
  assert.equal(body.get("audience"), input.audience);
  assert.equal(body.has("client_secret"), false);
});
test("fails closed on upstream non-200 and malformed token responses", async () => {
  const non200 = createAuth0CodeExchange({
    tokenEndpoint: "https://issuer.example.test/oauth/token",
    fetch: async () => new Response("private upstream detail", { status: 401 }),
  });
  await assert.rejects(non200(input), /upstream token exchange failed/u);

  const malformed = createAuth0CodeExchange({
    tokenEndpoint: "https://issuer.example.test/oauth/token",
    fetch: async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
  });
  await assert.rejects(malformed(input), /upstream token response is invalid/u);
});

test("preserves actual upstream expiry and rotating refresh credential", async () => {
  const exchange = createAuth0CodeExchange({
    tokenEndpoint: "https://issuer.example.test/oauth/token",
    fetch: async () => Response.json({ access_token: "synthetic-access", token_type: "Bearer", expires_in: 7200, refresh_token: "synthetic-refresh" }),
  });
  assert.deepEqual(await exchange(input), { accessToken: "synthetic-access", expiresIn: 7200, refreshToken: "synthetic-refresh" });
});

test("rejects missing, invalid expiry and excessive upstream response without exposing bodies", async () => {
  for (const payload of [ { access_token: "private" }, { access_token: "private", expires_in: 0 }, { access_token: "private", expires_in: 1.5 }, { access_token: "private", expires_in: 1, token_type: "MAC" } ]) {
    const exchange = createAuth0CodeExchange({ tokenEndpoint: "https://issuer.example.test/oauth/token", fetch: async () => Response.json(payload) });
    await assert.rejects(exchange(input), { message: "upstream token response is invalid" });
  }
  const exchange = createAuth0CodeExchange({ tokenEndpoint: "https://issuer.example.test/oauth/token", fetch: async () => new Response("x".repeat(65537)) });
  await assert.rejects(exchange(input), { message: "upstream token response is invalid" });
});

test("refresh uses bounded POST and never retries ambiguous network failure", async () => {
  const { createAuth0RefreshExchange, UpstreamTokenError } = await import("../src/oauth/upstream-client.js");
  let calls = 0;
  const exchange = createAuth0RefreshExchange({ tokenEndpoint: "https://issuer.example.test/oauth/token", fetch: async (_url, init) => {
    calls++; const body = new URLSearchParams(init?.body as string);
    assert.equal(body.get("grant_type"), "refresh_token"); assert.equal(body.get("refresh_token"), "synthetic-refresh");
    assert.equal(body.get("client_id"), "upstream-client"); assert.equal(body.has("client_secret"), false);
    assert.equal(init?.redirect, "error"); throw new Error("private connection detail");
  } });
  await assert.rejects(exchange({ refreshToken: "synthetic-refresh", clientId: "upstream-client", resource: input.resource, audience: input.audience }), e => e instanceof UpstreamTokenError && e.retryable && !e.message.includes("private"));
  assert.equal(calls, 1);
});

test("refresh timeout aborts the one request", async () => {
  const { createAuth0RefreshExchange, UpstreamTokenError } = await import("../src/oauth/upstream-client.js");
  const exchange = createAuth0RefreshExchange({ tokenEndpoint: "https://issuer.example.test/oauth/token", timeoutMs: 5,
    fetch: async (_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); }),
  });
  await assert.rejects(exchange({ refreshToken: "synthetic-refresh", clientId: "upstream-client", resource: input.resource, audience: input.audience }), e => e instanceof UpstreamTokenError && e.retryable);
});

test("only explicit invalid_grant is terminal; configuration/rate limit/body failures remain retryable", async () => {
  const { createAuth0RefreshExchange, UpstreamTokenError } = await import("../src/oauth/upstream-client.js");
  for (const [status, payload, retryable] of [ [400, { error: "invalid_grant" }, false], [400, { error: "invalid_client" }, true], [429, {}, true], [503, {}, true], [200, { private: "malformed" }, true] ] as const) {
    const exchange = createAuth0RefreshExchange({ tokenEndpoint: "https://issuer.example.test/oauth/token", fetch: async () => Response.json(payload, { status }) });
    await assert.rejects(exchange({ refreshToken: "synthetic", clientId: "upstream", resource: input.resource, audience: input.audience }), e => e instanceof UpstreamTokenError && e.retryable === retryable && !e.message.includes("malformed"));
  }
});
