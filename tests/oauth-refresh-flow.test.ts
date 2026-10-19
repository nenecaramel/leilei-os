import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createOAuthAuthorizationServer, type OAuthAuthorizationServerOptions } from "../src/oauth/oauth-authorization-server.js";
import { createRefreshTokenEnvelope } from "../src/oauth/refresh-token-envelope.js";
import { createPkceChallenge } from "../src/oauth/oauth-code-store.js";
import { UpstreamTokenError } from "../src/oauth/upstream-client.js";
import type { ResolvedClient } from "../src/oauth/client-registry.js";

const issuer = "https://mcp.example.test", resource = `${issuer}/mcp`;
const clientId = "https://claude.ai/oauth/mcp-oauth-client-metadata", redirect = "https://claude.ai/oauth/callback";
const scope = "mcp:access offline_access", verifier = "a".repeat(43), key = Buffer.alloc(32, 7).toString("base64url");
const client: ResolvedClient = { client_id: clientId, client_name: "Claude", redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] };
function setup(overrides: Partial<OAuthAuthorizationServerOptions> = {}) {
  let clock = 1_800_000_000_000;
  const refreshInputs: string[] = [];
  const options: OAuthAuthorizationServerOptions = {
    issuer, resource, audience: resource, requiredScope: "mcp:access", now: () => clock,
    upstreamAuthorizationEndpoint: "https://auth.example.test/authorize", upstreamTokenEndpoint: "https://auth.example.test/oauth/token",
    upstreamClientId: "upstream-app", upstreamRedirectUri: `${issuer}/oauth/callback`, refreshTokenKey: key,
    registry: { async resolve(id) { return [clientId, "other-client"].includes(id) ? { ...client, client_id: id } : undefined; } },
    allowedSubject: "owner", verifyAccessToken: async () => ({ subject: "owner", issuer: "https://auth.example.test/", audience: [resource], scopes: ["mcp:access"] }),
    exchangeUpstreamCode: async () => ({ accessToken: "synthetic-initial", refreshToken: "upstream-0", expiresIn: 7200 }),
    exchangeUpstreamRefresh: async ({ refreshToken }) => {
      refreshInputs.push(refreshToken);
      if (refreshToken !== `upstream-${refreshInputs.length - 1}`) throw new UpstreamTokenError(false);
      return { accessToken: "synthetic-renewed", refreshToken: `upstream-${refreshInputs.length}`, expiresIn: 1800 };
    }, ...overrides,
  };
  return { options, refreshInputs, advance(ms: number) { clock += ms; } };
}
async function serve(options: OAuthAuthorizationServerOptions, run: (base: string) => Promise<void>) {
  const app = express(); app.use(createOAuthAuthorizationServer(options));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(r => server.once("listening", r));
  const address = server.address(); assert.ok(address && typeof address === "object");
  try { await run(`http://127.0.0.1:${address.port}`); } finally { await new Promise<void>((r, j) => server.close(e => e ? j(e) : r())); }
}
async function post(base: string, path: string, data: Record<string, string>, cookie?: string) {
  return fetch(base + path, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) }, body: new URLSearchParams(data) });
}
async function authorize(base: string, requestedScope = scope) {
  const params = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirect, scope: requestedScope, resource, code_challenge: createPkceChallenge(verifier), code_challenge_method: "S256" });
  const page = await fetch(`${base}/oauth/authorize?${params}`, { redirect: "manual" });
  assert.equal(page.status, 200); const html = await page.text();
  const transaction = /name="transaction" value="([^"]+)"/u.exec(html)![1]!;
  const csrf = /name="csrf_token" value="([^"]+)"/u.exec(html)![1]!;
  const consent = await post(base, "/oauth/consent", { transaction, csrf_token: csrf, decision: "approve" }, page.headers.get("set-cookie")!.split(";")[0]);
  assert.equal(consent.status, 302);
  const upstream = new URL(consent.headers.get("location")!);
  assert.equal(upstream.searchParams.get("scope"), requestedScope);
  const callback = await fetch(`${base}/oauth/callback?${new URLSearchParams({ state: upstream.searchParams.get("state")!, code: "synthetic-code" })}`, { redirect: "manual" });
  assert.equal(callback.status, 302);
  const code = new URL(callback.headers.get("location")!).searchParams.get("code"); assert.ok(code);
  return code;
}
async function redeem(base: string, code: string) {
  return post(base, "/oauth/token", { grant_type: "authorization_code", client_id: clientId, code, redirect_uri: redirect, code_verifier: verifier });
}
async function refresh(base: string, token: string, extra: Record<string, string> = {}) {
  return post(base, "/oauth/token", { grant_type: "refresh_token", client_id: clientId, refresh_token: token, ...extra });
}

test("offline consent, actual remaining expiry, rotation and renewal survive server restart", async () => {
  const s = setup(); let credential = "";
  await serve(s.options, async base => {
    const metadata = await (await fetch(base + "/.well-known/oauth-authorization-server")).json();
    assert.ok(metadata.grant_types_supported.includes("refresh_token")); assert.ok(metadata.scopes_supported.includes("offline_access"));
    const code = await authorize(base); s.advance(12_000);
    const first = await redeem(base, code); assert.equal(first.status, 200); const body = await first.json();
    assert.equal(body.expires_in, 7188); credential = body.refresh_token;
    assert.ok(credential && !credential.includes("upstream-0"));
    assert.equal((await redeem(base, code)).status, 400);
  });
  s.advance(8_000_000);
  await serve(s.options, async base => {
    const renewed = await refresh(base, credential); assert.equal(renewed.status, 200);
    const next = await renewed.json(); assert.equal(next.access_token, "synthetic-renewed"); assert.equal(next.expires_in, 1800);
    assert.notEqual(next.refresh_token, credential); assert.deepEqual(s.refreshInputs, ["upstream-0"]);
    assert.equal((await refresh(base, credential)).status, 400, "upstream rejects replay of an already-rotated credential");
  });
});

test("wrong client, binding changes, tamper, expiry and key replacement cannot reach upstream", async () => {
  const s = setup();
  await serve(s.options, async base => {
    const token = (await (await redeem(base, await authorize(base))).json()).refresh_token;
    for (const extra of [{ client_id: "other-client" }, { resource: "https://elsewhere.test" }, { audience: "other" }, { scope: "mcp:access admin" }]) {
      assert.equal((await refresh(base, token, extra)).status, 400);
    }
    assert.equal((await refresh(base, "A" + token.slice(1))).status, 400);
    s.advance(30 * 86400_000);
    assert.equal((await refresh(base, token)).status, 400);
    assert.deepEqual(s.refreshInputs, []);
  });
  const envelope = createRefreshTokenEnvelope({ key, issuer });
  const sealed = envelope.seal({ clientId, subject: "owner", resource, audience: resource, scope, upstreamToken: "synthetic", expiresAt: Date.now() + 60_000 });
  assert.throws(() => createRefreshTokenEnvelope({ key: Buffer.alloc(32, 8).toString("base64url"), issuer }).open(sealed));
  assert.throws(() => createRefreshTokenEnvelope({ key, issuer: "https://other.test" }).open(sealed));
});

test("absolute refresh expiry does not extend across rotations", async () => {
  const s = setup();
  await serve(s.options, async base => {
    const token = (await (await redeem(base, await authorize(base))).json()).refresh_token;
    s.advance(29 * 86400_000);
    const rotated = (await (await refresh(base, token)).json()).refresh_token;
    s.advance(86400_000);
    assert.equal((await refresh(base, rotated)).status, 400); assert.equal(s.refreshInputs.length, 1);
  });
});

for (const mode of ["transient", "revoked", "unrotated", "missing", "wrong-subject"]) test(`refresh fails closed without leaking upstream detail: ${mode}`, async () => {
  let calls = 0;
  const s = setup({ exchangeUpstreamRefresh: async () => {
    calls++;
    if (mode === "transient" || mode === "revoked") throw new UpstreamTokenError(mode === "transient");
    return { accessToken: "synthetic-renewed", expiresIn: 1800, ...(mode === "missing" ? {} : { refreshToken: mode === "unrotated" ? "upstream-0" : "upstream-1" }) };
  }, verifyAccessToken: async token => ({ subject: mode === "wrong-subject" && token === "synthetic-renewed" ? "other" : "owner", issuer: "https://auth.example.test/", audience: [resource], scopes: ["mcp:access"] }) });
  await serve(s.options, async base => {
    const token = (await (await redeem(base, await authorize(base))).json()).refresh_token;
    const response = await refresh(base, token); const temporary = ["transient", "unrotated", "missing"].includes(mode);
    assert.equal(response.status, temporary ? 503 : 400);
    assert.deepEqual(await response.json(), { error: temporary ? "temporarily_unavailable" : "invalid_grant" }); assert.equal(calls, 1);
  });
});

test("access-only clients remain compatible and no refresh is advertised without a key", async () => {
  const s = setup({ refreshTokenKey: undefined });
  await serve(s.options, async base => {
    const metadata = await (await fetch(base + "/.well-known/oauth-authorization-server")).json(); assert.deepEqual(metadata.grant_types_supported, ["authorization_code"]);
    const first = await redeem(base, await authorize(base, "mcp:access")); assert.equal(first.status, 200);
    assert.equal((await first.json()).refresh_token, undefined);
    assert.equal((await refresh(base, "synthetic")).status, 400);
  });
});

test("private_key_jwt refresh cannot bypass client assertion authentication", async () => {
  const s = setup({ registry: { async resolve() { return { ...client, token_endpoint_auth_method: "private_key_jwt", token_endpoint_auth_signing_alg: "RS256", jwks_uri: "https://client.example.test/jwks.json" }; } } });
  const sealed = createRefreshTokenEnvelope({ key, issuer, now: s.options.now }).seal({ clientId, subject: "owner", resource, audience: resource, scope, upstreamToken: "synthetic", expiresAt: s.options.now!() + 60_000 });
  await serve(s.options, async base => {
    const response = await refresh(base, sealed); assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_client" }); assert.deepEqual(s.refreshInputs, []);
  });
});

test("concurrent replay is decided by upstream rotation and never retried locally", async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(r => { entered = r; });
  const held = new Promise<void>(r => { release = r; }); let calls = 0;
  const s = setup({ exchangeUpstreamRefresh: async () => {
    calls++; if (calls > 1) throw new UpstreamTokenError(false);
    entered(); await held; return { accessToken: "synthetic-new", refreshToken: "upstream-1", expiresIn: 1800 };
  } });
  await serve(s.options, async base => {
    const token = (await (await redeem(base, await authorize(base))).json()).refresh_token;
    const first = refresh(base, token); await started;
    const duplicate = await refresh(base, token); assert.equal(duplicate.status, 400);
    release(); assert.equal((await first).status, 200); assert.equal(calls, 2);
  });
});

test("expired access code and missing offline grant do not yield unusable credentials", async () => {
  const s = setup();
  await serve(s.options, async base => {
    const code = await authorize(base); s.advance(61_000); assert.equal((await redeem(base, code)).status, 400);
  });
  const missing = setup({ exchangeUpstreamCode: async () => ({ accessToken: "synthetic", expiresIn: 7200 }) });
  await serve(missing.options, async base => { await assert.rejects(authorize(base), /AssertionError|falsy/u); });
});

test("authenticated private_key_jwt refresh rotates and rejects assertion replay", async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const { SignJWT } = await import("jose");
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const s = setup({ registry: { async resolve() { return { ...client, token_endpoint_auth_method: "private_key_jwt", token_endpoint_auth_signing_alg: "RS256", jwks_uri: "https://client.example.test/jwks.json" }; } },
    fetchJwks: async () => ({ keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "synthetic-key", alg: "RS256", use: "sig" }] }),
  });
  const sealed = createRefreshTokenEnvelope({ key, issuer, now: s.options.now }).seal({ clientId, subject: "owner", resource, audience: resource, scope, upstreamToken: "upstream-0", expiresAt: s.options.now!() + 60_000 });
  const seconds = Math.floor(s.options.now!() / 1000);
  const assertion = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "synthetic-key" }).setIssuer(clientId).setSubject(clientId).setAudience(`${issuer}/oauth/token`).setIssuedAt(seconds).setExpirationTime(seconds + 60).setJti("refresh-once").sign(keys.privateKey);
  await serve(s.options, async base => {
    const extra = { client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: assertion };
    const first = await refresh(base, sealed, extra); assert.equal(first.status, 200);
    const next = (await first.json()).refresh_token;
    const replay = await refresh(base, next, extra); assert.equal(replay.status, 400);
    assert.deepEqual(await replay.json(), { error: "invalid_client" }); assert.equal(s.refreshInputs.length, 1);
  });
});

test("temporary access-token verification failure preserves the refresh grant", async () => {
  const { AccessTokenError } = await import("../src/auth/jwt-verifier.js");
  const s = setup({ verifyAccessToken: async token => {
    if (token === "synthetic-renewed") throw new AccessTokenError("private JWKS detail", "invalid_token", "jwks_unavailable");
    return { subject: "owner", issuer: "https://auth.example.test/", audience: [resource], scopes: ["mcp:access"] };
  } });
  await serve(s.options, async base => {
    const token = (await (await redeem(base, await authorize(base))).json()).refresh_token;
    const response = await refresh(base, token); assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "temporarily_unavailable" });
  });
});

test("trusted CIMD metadata outage is unavailable rather than invalid client", async () => {
  const { createClientRegistry } = await import("../src/oauth/client-registry.js");
  const s = setup({ registry: createClientRegistry({ staticClients: [], trustedClientMetadataUrls: [clientId], fetchMetadata: async () => { throw new Error("private DNS failure"); } }) });
  const token = createRefreshTokenEnvelope({ key, issuer, now: s.options.now }).seal({ clientId, subject: "owner", resource, audience: resource, scope, upstreamToken: "synthetic", expiresAt: s.options.now!() + 60_000 });
  await serve(s.options, async base => {
    const response = await refresh(base, token); assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "temporarily_unavailable" }); assert.deepEqual(s.refreshInputs, []);
  });
});

test("valid private-key assertion with client JWKS outage returns unavailable", async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const { SignJWT } = await import("jose");
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const s = setup({ registry: { async resolve() { return { ...client, token_endpoint_auth_method: "private_key_jwt", token_endpoint_auth_signing_alg: "RS256", jwks_uri: "https://client.example.test/jwks.json" }; } },
    fetchJwks: async () => { throw new Error("private network failure"); },
  });
  const sealed = createRefreshTokenEnvelope({ key, issuer, now: s.options.now }).seal({ clientId, subject: "owner", resource, audience: resource, scope, upstreamToken: "upstream-0", expiresAt: s.options.now!() + 60_000 });
  const seconds = Math.floor(s.options.now!() / 1000);
  const assertion = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "synthetic-key" }).setIssuer(clientId).setSubject(clientId).setAudience(`${issuer}/oauth/token`).setIssuedAt(seconds).setExpirationTime(seconds + 60).setJti("refresh-once").sign(keys.privateKey);
  await serve(s.options, async base => {
    const extra = { client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: assertion };
    const first = await refresh(base, sealed, extra); assert.equal(first.status, 503);
    assert.deepEqual(await first.json(), { error: "temporarily_unavailable" }); assert.deepEqual(s.refreshInputs, []);
  });
});
