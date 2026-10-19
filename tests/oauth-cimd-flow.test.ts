import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import express from "express";
import test from "node:test";
import { createOAuthAuthorizationServer } from "../src/oauth/oauth-authorization-server.js";
import type { ResolvedClient } from "../src/oauth/client-registry.js";

const CLIENT_ID = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const REDIRECT_URI = "https://claude.ai/oauth/callback";
const RESOURCE = "https://mcp.example.test/mcp";
const ISSUER = "https://mcp.example.test";
const VERIFIER = "a".repeat(43);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

const client: ResolvedClient = {
  client_id: CLIENT_ID,
  client_name: "Claude",
  redirect_uris: [REDIRECT_URI],
  token_endpoint_auth_method: "none",
  grant_types: ["authorization_code"],
  response_types: ["code"],
};

async function withServer(
  configure: (calls: { verifiedTokens: string[]; exchangedCodes: string[] }) => ReturnType<typeof createOAuthAuthorizationServer>,
  callback: (baseUrl: string, calls: { verifiedTokens: string[]; exchangedCodes: string[] }) => Promise<void>,
): Promise<void> {
  const calls = { verifiedTokens: [], exchangedCodes: [] };
  const app = express();
  app.use(configure(calls));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await callback(`http://127.0.0.1:${address.port}`, calls);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function buildRouter(calls: { verifiedTokens: string[]; exchangedCodes: string[] }) {
  return createOAuthAuthorizationServer({
    now: () => 1_700_000_000_000,
    issuer: ISSUER,
    resource: RESOURCE,
    audience: RESOURCE,
    requiredScope: "mcp:access",
    upstreamAuthorizationEndpoint: "https://issuer.example.test/authorize",
    upstreamTokenEndpoint: "https://issuer.example.test/oauth/token",
    upstreamClientId: "upstream-client",
    upstreamRedirectUri: "https://mcp.example.test/oauth/callback",
    registry: {
      async resolve(clientId) {
        return clientId === CLIENT_ID ? client : undefined;
      },
    },
    verifyAccessToken: async (token) => {
      calls.verifiedTokens.push(token);
      return {
        subject: "allowed-subject",
        issuer: "https://issuer.example.test/",
        audience: [RESOURCE],
        scopes: ["mcp:access"],
      };
    },
    allowedSubject: "allowed-subject",
    exchangeUpstreamCode: async ({ code }) => {
      calls.exchangedCodes.push(code);
      return { accessToken: "auth0-access-token", expiresIn: 3600 };
    },
  });
}

function authorizationUrl(baseUrl: string, overrides: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "mcp:access",
    resource: RESOURCE,
    audience: RESOURCE,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "client-state",
    ...overrides,
  });
  return `${baseUrl}/oauth/authorize?${params}`;
}

test("performs CIMD authorization, Auth0 exchange, and one-time PKCE-bound token redemption", async () => {
  await withServer(buildRouter, async (baseUrl, calls) => {
    const authorize = await fetch(authorizationUrl(baseUrl));
    assert.equal(authorize.status, 200);
    const consent = await authorize.text();
    const transaction = consent.match(/name="transaction" value="([^"]+)"/u)?.[1];
    const csrfToken = consent.match(/name="csrf_token" value="([^"]+)"/u)?.[1];
    const consentCookie = authorize.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(transaction);
    assert.ok(csrfToken);
    assert.ok(consentCookie);
    assert.match(consent, /Claude/u);
    assert.match(consent, /claude\.ai/u);

    const approved = await fetch(`${baseUrl}/oauth/consent`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: consentCookie },
      body: new URLSearchParams({ transaction, csrf_token: csrfToken, decision: "approve" }),
    });
    assert.equal(approved.status, 302);
    const upstream = new URL(approved.headers.get("location") ?? "");
    assert.equal(upstream.origin, "https://issuer.example.test");
    assert.equal(upstream.searchParams.get("client_id"), "upstream-client");
    assert.equal(upstream.searchParams.get("code_challenge_method"), "S256");
    const upstreamState = upstream.searchParams.get("state");
    assert.ok(upstreamState);

    const callbackResponse = await fetch(
      `${baseUrl}/oauth/callback?${new URLSearchParams({ code: "upstream-code", state: upstreamState })}`,
      { redirect: "manual" },
    );
    assert.equal(callbackResponse.status, 302);
    assert.deepEqual(calls.exchangedCodes, ["upstream-code"]);
    assert.deepEqual(calls.verifiedTokens, ["auth0-access-token"]);
    const clientRedirect = new URL(callbackResponse.headers.get("location") ?? "");
    assert.equal(clientRedirect.origin, "https://claude.ai");
    assert.equal(clientRedirect.pathname, "/oauth/callback");
    assert.equal(clientRedirect.searchParams.get("state"), "client-state");
    assert.equal(clientRedirect.searchParams.get("iss"), ISSUER);
    const code = clientRedirect.searchParams.get("code");
    assert.ok(code);

    const token = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: VERIFIER,
        resource: RESOURCE,
        audience: RESOURCE,
      }),
    });
    assert.equal(token.status, 200);
    assert.deepEqual(await token.json(), {
      access_token: "auth0-access-token",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "mcp:access",
      resource: RESOURCE,
      audience: RESOURCE,
    });

    const replay = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: CLIENT_ID, code, redirect_uri: REDIRECT_URI, code_verifier: VERIFIER }),
    });
    assert.equal(replay.status, 400);
    assert.equal((await replay.json()).error, "invalid_grant");
  });
});

test("rejects unsafe authorization parameters and all shared-secret client authentication", async () => {
  await withServer(buildRouter, async (baseUrl) => {
    for (const overrides of [
      { response_type: "token" },
      { code_challenge_method: "plain" },
      { code_challenge: "weak" },
      { resource: "https://other.example/mcp" },
      { audience: "https://other.example/mcp" },
      { scope: "openid" },
      { redirect_uri: "https://attacker.example/callback" },
    ]) {
      const response = await fetch(authorizationUrl(baseUrl, overrides));
      assert.equal(response.status, 400, JSON.stringify(overrides));
      assert.equal((await response.json()).error, "invalid_request");
    }

    const unknownClient = await fetch(authorizationUrl(baseUrl, { client_id: "https://other.example/client.json" }));
    assert.equal(unknownClient.status, 400);
    assert.equal((await unknownClient.json()).error, "invalid_client");

    const withHeader = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { authorization: "Basic dGVzdDpzZWNyZXQ=", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: CLIENT_ID, code: "x", code_verifier: VERIFIER }),
    });
    assert.equal(withHeader.status, 400);
    assert.equal((await withHeader.json()).error, "invalid_client");

    const withSecret = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: CLIENT_ID, code: "x", client_secret: "secret", code_verifier: VERIFIER }),
    });
    assert.equal(withSecret.status, 400);
    assert.equal((await withSecret.json()).error, "invalid_client");
  });
});

test("rejects wrong code verifier and state mismatch without issuing a code", async () => {
  await withServer(buildRouter, async (baseUrl, calls) => {
    const authorize = await fetch(authorizationUrl(baseUrl));
    const consent = await authorize.text();
    const transaction = consent.match(/name="transaction" value="([^"]+)"/u)?.[1];
    const csrfToken = consent.match(/name="csrf_token" value="([^"]+)"/u)?.[1];
    const consentCookie = authorize.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(transaction);
    assert.ok(csrfToken);
    assert.ok(consentCookie);
    const approved = await fetch(`${baseUrl}/oauth/consent`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: consentCookie },
      body: new URLSearchParams({ transaction, csrf_token: csrfToken, decision: "approve" }),
    });
    const upstreamState = new URL(approved.headers.get("location") ?? "").searchParams.get("state");
    assert.ok(upstreamState);
    const badState = await fetch(`${baseUrl}/oauth/callback?code=upstream-code&state=wrong`, { redirect: "manual" });
    assert.equal(badState.status, 400);
    assert.deepEqual(calls.exchangedCodes, []);

    const callbackResponse = await fetch(`${baseUrl}/oauth/callback?code=upstream-code&state=${encodeURIComponent(upstreamState)}`, { redirect: "manual" });
    const code = new URL(callbackResponse.headers.get("location") ?? "").searchParams.get("code");
    assert.ok(code);
    const wrongVerifier = "b".repeat(43);
    const token = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: CLIENT_ID, code, redirect_uri: REDIRECT_URI, code_verifier: wrongVerifier }),
    });
    assert.equal(token.status, 400);
    assert.equal((await token.json()).error, "invalid_grant");
  });
});

test("renders an OAuth denial without exposing upstream error details", async () => {
  await withServer(buildRouter, async (baseUrl) => {
    const authorize = await fetch(authorizationUrl(baseUrl));
    const consent = await authorize.text();
    const transaction = consent.match(/name="transaction" value="([^"]+)"/u)?.[1];
    const csrfToken = consent.match(/name="csrf_token" value="([^"]+)"/u)?.[1];
    const consentCookie = authorize.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(transaction);
    assert.ok(csrfToken);
    assert.ok(consentCookie);
    const denied = await fetch(`${baseUrl}/oauth/consent`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: consentCookie },
      body: new URLSearchParams({ transaction, csrf_token: csrfToken, decision: "deny" }),
    });
    assert.equal(denied.status, 302);
    const location = new URL(denied.headers.get("location") ?? "");
    assert.equal(location.origin, "https://claude.ai");
    assert.equal(location.searchParams.get("error"), "access_denied");
    assert.equal(location.searchParams.get("state"), "client-state");
  });
});

test("requires the consent cookie and CSRF token before starting upstream login", async () => {
  await withServer(buildRouter, async (baseUrl, calls) => {
    const authorize = await fetch(authorizationUrl(baseUrl));
    const consent = await authorize.text();
    const transaction = consent.match(/name="transaction" value="([^"]+)"/u)?.[1];
    const csrfToken = consent.match(/name="csrf_token" value="([^"]+)"/u)?.[1];
    assert.ok(transaction);
    assert.ok(csrfToken);

    const missingCookie = await fetch(`${baseUrl}/oauth/consent`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ transaction, csrf_token: csrfToken, decision: "approve" }),
    });
    assert.equal(missingCookie.status, 400);
    assert.deepEqual(calls.exchangedCodes, []);
  });
});
