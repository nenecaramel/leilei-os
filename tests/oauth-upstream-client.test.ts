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
      return new Response(JSON.stringify({ access_token: "auth0-access-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.deepEqual(await exchange(input), { accessToken: "auth0-access-token" });
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
