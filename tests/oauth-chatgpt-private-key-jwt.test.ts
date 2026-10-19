const TEST_NOW = Date.now();
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import express from "express";
import test from "node:test";
import {
  createClientRegistry,
  type ResolvedClient,
} from "../src/oauth/client-registry.js";
import {
  createClientAssertionVerifier,
  createJwksKeyCache,
} from "../src/oauth/client-assertion-authentication.js";
import { createOAuthAuthorizationServer } from "../src/oauth/oauth-authorization-server.js";
import {
  CHATGPT_CIMD_METADATA,
  CHATGPT_CLIENT_ID,
  CHATGPT_JWKS,
  CHATGPT_JWKS_URI,
  CHATGPT_KID,
  CHATGPT_PRIVATE_KEY,
  CHATGPT_REDIRECT_URI,
  CHATGPT_TOKEN_ENDPOINT,
  ROTATED_CHATGPT_JWKS,
  WRONG_PRIVATE_KEY,
  createChatGptAssertion,
} from "./fixtures/chatgpt-cimd.js";

const OTHER_CLIENT_ID = "https://other.example/client.json";
const OTHER_REDIRECT_URI = "https://other.example/callback";
const RESOURCE = "https://mcp.example.test/mcp";
const ISSUER = "https://mcp.example.test";
const NOW_SECONDS = 1_700_000_000;
const VERIFIER = "v".repeat(43);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

const otherClient: ResolvedClient = {
  client_id: OTHER_CLIENT_ID,
  client_name: "Other",
  redirect_uris: [OTHER_REDIRECT_URI],
  token_endpoint_auth_method: "private_key_jwt",
  token_endpoint_auth_signing_alg: "RS256",
  jwks_uri: CHATGPT_JWKS_URI,
  grant_types: ["authorization_code"],
  response_types: ["code"],
};

type Calls = {
  exchangedCodes: string[];
  jwksUris: string[];
};

async function withServer(callback: (baseUrl: string, calls: Calls) => Promise<void>): Promise<void> {
  const calls: Calls = { exchangedCodes: [], jwksUris: [] };
  const app = express();
  const registry = createClientRegistry({
    staticClients: [CHATGPT_CIMD_METADATA, {
      client_id: otherClient.client_id,
      client_name: otherClient.client_name,
      redirect_uris: [...otherClient.redirect_uris],
      token_endpoint_auth_method: otherClient.token_endpoint_auth_method,
      token_endpoint_auth_signing_alg: otherClient.token_endpoint_auth_signing_alg,
      jwks_uri: otherClient.jwks_uri,
      grant_types: [...otherClient.grant_types],
      response_types: [...otherClient.response_types],
    }],
    trustedClientMetadataUrls: [],
    fetchMetadata: async () => {
      throw new Error("static client metadata must not be fetched");
    },
  });
  app.use(createOAuthAuthorizationServer({
    now: () => TEST_NOW,
    issuer: ISSUER,
    resource: RESOURCE,
    audience: RESOURCE,
    requiredScope: "mcp:access",
    upstreamAuthorizationEndpoint: "https://issuer.example.test/authorize",
    upstreamTokenEndpoint: "https://issuer.example.test/oauth/token",
    upstreamClientId: "upstream-client",
    upstreamRedirectUri: "https://mcp.example.test/oauth/callback",
    registry,
    verifyAccessToken: async () => ({
      subject: "allowed-subject",
      issuer: "https://issuer.example.test/",
      audience: [RESOURCE],
      scopes: ["mcp:access"],
    }),
    allowedSubject: "allowed-subject",
    exchangeUpstreamCode: async ({ code }) => {
      calls.exchangedCodes.push(code);
      return { accessToken: "auth0-access-token", expiresIn: 3600 };
    },
    fetchJwks: async (jwksUri) => {
      calls.jwksUris.push(jwksUri);
      assert.equal(jwksUri, CHATGPT_JWKS_URI);
      return CHATGPT_JWKS;
    },
    now: () => NOW_SECONDS * 1_000,
  }));
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

function authorizationUrl(
  baseUrl: string,
  clientId = CHATGPT_CLIENT_ID,
  redirectUri = CHATGPT_REDIRECT_URI,
  state = "client-state",
): string {
  return `${baseUrl}/oauth/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "mcp:access",
    resource: RESOURCE,
    audience: RESOURCE,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state,
  })}`;
}

async function issueCode(
  baseUrl: string,
  clientId = CHATGPT_CLIENT_ID,
  redirectUri = CHATGPT_REDIRECT_URI,
): Promise<string> {
  const authorization = await fetch(authorizationUrl(baseUrl, clientId, redirectUri));
  assert.equal(authorization.status, 200);
  const consent = await authorization.text();
  const transaction = consent.match(/name="transaction" value="([^"]+)"/u)?.[1];
  const csrfToken = consent.match(/name="csrf_token" value="([^"]+)"/u)?.[1];
  const cookie = authorization.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(transaction);
  assert.ok(csrfToken);
  assert.ok(cookie);

  const approved = await fetch(`${baseUrl}/oauth/consent`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams({ transaction, csrf_token: csrfToken, decision: "approve" }),
  });
  assert.equal(approved.status, 302);
  const upstreamState = new URL(approved.headers.get("location") ?? "").searchParams.get("state");
  assert.ok(upstreamState);

  const callback = await fetch(
    `${baseUrl}/oauth/callback?${new URLSearchParams({ code: "upstream-code", state: upstreamState })}`,
    { redirect: "manual" },
  );
  assert.equal(callback.status, 302);
  const code = new URL(callback.headers.get("location") ?? "").searchParams.get("code");
  assert.ok(code);
  return code;
}

async function redeem(
  baseUrl: string,
  input: {
    code: string;
    clientId?: string;
    redirectUri?: string;
    assertion?: string;
  },
): Promise<Response> {
  const clientId = input.clientId ?? CHATGPT_CLIENT_ID;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code: input.code,
    redirect_uri: input.redirectUri ?? CHATGPT_REDIRECT_URI,
    code_verifier: VERIFIER,
    resource: RESOURCE,
    audience: RESOURCE,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: input.assertion ?? createChatGptAssertion({ now: NOW_SECONDS }),
  });
  return fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

test("authenticates the production ChatGPT CIMD client with private_key_jwt", async () => {
  await withServer(async (baseUrl, calls) => {
    const code = await issueCode(baseUrl);
    const response = await redeem(baseUrl, { code });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      access_token: "auth0-access-token",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "mcp:access",
      resource: RESOURCE,
      audience: RESOURCE,
    });
    assert.deepEqual(calls.jwksUris, [CHATGPT_JWKS_URI]);
  });
});

test("rejects invalid ChatGPT assertion signatures, audiences, timestamps, and kids", async () => {
  const cases = [
    {
      name: "wrong signature",
      assertion: createChatGptAssertion({ now: NOW_SECONDS, jti: "wrong-signature", signingKey: WRONG_PRIVATE_KEY }),
    },
    {
      name: "wrong audience",
      assertion: createChatGptAssertion({ now: NOW_SECONDS, jti: "wrong-audience", audience: "https://other.example/token" }),
    },
    {
      name: "expired",
      assertion: createChatGptAssertion({ now: NOW_SECONDS, jti: "expired", expiresAt: NOW_SECONDS - 1, issuedAt: NOW_SECONDS - 120 }),
    },
    {
      name: "unknown kid",
      assertion: createChatGptAssertion({ now: NOW_SECONDS, jti: "unknown-kid", kid: "unknown-kid" }),
    },
  ];

  await withServer(async (baseUrl) => {
    for (const current of cases) {
      const code = await issueCode(baseUrl, CHATGPT_CLIENT_ID, CHATGPT_REDIRECT_URI);
      const response = await redeem(baseUrl, { code, assertion: current.assertion });
      assert.equal(response.status, 400, current.name);
      assert.equal((await response.json()).error, "invalid_client", current.name);
    }
  });
});

test("rejects replayed assertions and requires exact authenticated client and redirect bindings", async () => {
  await withServer(async (baseUrl) => {
    const assertion = createChatGptAssertion({ now: NOW_SECONDS, jti: "replayed" });
    const first = await redeem(baseUrl, { code: await issueCode(baseUrl), assertion });
    assert.equal(first.status, 200);
    const replay = await redeem(baseUrl, { code: await issueCode(baseUrl), assertion });
    assert.equal(replay.status, 400);
    assert.equal((await replay.json()).error, "invalid_client");

    const wrongAssertionClient = await redeem(baseUrl, {
      code: await issueCode(baseUrl),
      assertion: createChatGptAssertion({
        now: NOW_SECONDS,
        clientId: OTHER_CLIENT_ID,
        issuer: OTHER_CLIENT_ID,
        subject: OTHER_CLIENT_ID,
        jti: "wrong-assertion-client",
      }),
    });
    assert.equal(wrongAssertionClient.status, 400);
    assert.equal((await wrongAssertionClient.json()).error, "invalid_client");

    const wrongRedirect = await redeem(baseUrl, {
      code: await issueCode(baseUrl),
      redirectUri: "https://chatgpt.com/connector/oauth/other",
      assertion: createChatGptAssertion({ now: NOW_SECONDS, jti: "wrong-redirect" }),
    });
    assert.equal(wrongRedirect.status, 400);
    assert.equal((await wrongRedirect.json()).error, "invalid_grant");

    const wrongCodeClient = await redeem(baseUrl, {
      code: await issueCode(baseUrl, OTHER_CLIENT_ID, OTHER_REDIRECT_URI),
      assertion: createChatGptAssertion({ now: NOW_SECONDS, jti: "wrong-code-client" }),
    });
    assert.equal(wrongCodeClient.status, 400);
    assert.equal((await wrongCodeClient.json()).error, "invalid_grant");
  });
});

test("uses JWKS TTL, bounded capacity, and refetches for rotation or unknown kids", async () => {
  let timestamp = 1_000;
  let fetches = 0;
  const cache = createJwksKeyCache({
    fetchJwks: async () => {
      fetches += 1;
      return CHATGPT_JWKS;
    },
    now: () => timestamp,
    ttlMs: 100,
    maxEntries: 1,
  });

  await cache.getKey(CHATGPT_JWKS_URI, CHATGPT_KID);
  await cache.getKey(CHATGPT_JWKS_URI, CHATGPT_KID);
  assert.equal(fetches, 1);
  timestamp += 101;
  await cache.getKey(CHATGPT_JWKS_URI, CHATGPT_KID);
  assert.equal(fetches, 2);
  await assert.rejects(cache.getKey(CHATGPT_JWKS_URI, "rotated-kid"), /unknown/u);
  assert.equal(fetches, 3);
  await assert.rejects(cache.getKey(CHATGPT_JWKS_URI, "rotated-kid"), /unknown/u);
  assert.equal(fetches, 3);

  await cache.getKey("https://second.example/jwks.json", CHATGPT_KID);
  await cache.getKey(CHATGPT_JWKS_URI, CHATGPT_KID);
  assert.equal(fetches, 5);
});

test("bounds repeated failed-signature JWKS refreshes during the cooldown", async () => {
  let fetches = 0;
  const verifier = createClientAssertionVerifier({
    fetchJwks: async () => {
      fetches += 1;
      return CHATGPT_JWKS;
    },
    now: () => NOW_SECONDS * 1_000,
  });
  const client: ResolvedClient = {
    client_id: CHATGPT_CLIENT_ID,
    client_name: "ChatGPT",
    redirect_uris: [CHATGPT_REDIRECT_URI],
    token_endpoint_auth_method: "private_key_jwt",
    token_endpoint_auth_signing_alg: "RS256",
    jwks_uri: CHATGPT_JWKS_URI,
    grant_types: ["authorization_code"],
    response_types: ["code"],
  };

  for (const jti of ["bad-signature-1", "bad-signature-2"]) {
    await assert.rejects(
      verifier.verify({
        client,
        clientId: CHATGPT_CLIENT_ID,
        clientAssertionType: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        clientAssertion: createChatGptAssertion({
          now: NOW_SECONDS,
          jti,
          signingKey: WRONG_PRIVATE_KEY,
        }),
        tokenEndpoint: CHATGPT_TOKEN_ENDPOINT,
      }),
      /signature/u,
    );
  }
  assert.equal(fetches, 2);
});

test("verifies required private_key_jwt claims with an offline client assertion verifier", async () => {
  let fetches = 0;
  const verifier = createClientAssertionVerifier({
    fetchJwks: async () => {
      fetches += 1;
      return CHATGPT_JWKS;
    },
    now: () => NOW_SECONDS * 1_000,
  });
  const client: ResolvedClient = {
    client_id: CHATGPT_CLIENT_ID,
    client_name: "ChatGPT",
    redirect_uris: [CHATGPT_REDIRECT_URI],
    token_endpoint_auth_method: "private_key_jwt",
    token_endpoint_auth_signing_alg: "RS256",
    jwks_uri: CHATGPT_JWKS_URI,
    grant_types: ["authorization_code"],
    response_types: ["code"],
  };

  await verifier.verify({
    client,
    clientId: CHATGPT_CLIENT_ID,
    clientAssertionType: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    clientAssertion: createChatGptAssertion({ now: NOW_SECONDS, jti: "claims-valid" }),
    tokenEndpoint: CHATGPT_TOKEN_ENDPOINT,
  });
  assert.equal(fetches, 1);
  await assert.rejects(
    verifier.verify({
      client,
      clientId: CHATGPT_CLIENT_ID,
      clientAssertionType: "wrong",
      clientAssertion: createChatGptAssertion({ now: NOW_SECONDS, jti: "claims-type" }),
      tokenEndpoint: CHATGPT_TOKEN_ENDPOINT,
    }),
    /authentication is invalid/u,
  );
  await assert.rejects(
    verifier.verify({
      client,
      clientId: CHATGPT_CLIENT_ID,
      clientAssertionType: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      clientAssertion: createChatGptAssertion({ now: NOW_SECONDS, jti: "claims-iat", issuedAt: NOW_SECONDS + 61 }),
      tokenEndpoint: CHATGPT_TOKEN_ENDPOINT,
    }),
    /timestamps are invalid/u,
  );
});

test("does not let assertion verification bypass the secure JWKS URL policy", async () => {
  const verifier = createClientAssertionVerifier({
    fetchJwks: async () => CHATGPT_JWKS,
    now: () => NOW_SECONDS * 1_000,
  });
  const unsafeClient: ResolvedClient = {
    ...otherClient,
    jwks_uri: "http://169.254.169.254/jwks.json",
  };

  await assert.rejects(
    verifier.verify({
      client: unsafeClient,
      clientId: OTHER_CLIENT_ID,
      clientAssertionType: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      clientAssertion: createChatGptAssertion({
        now: NOW_SECONDS,
        clientId: OTHER_CLIENT_ID,
        issuer: OTHER_CLIENT_ID,
        subject: OTHER_CLIENT_ID,
        jti: "unsafe-jwks-uri",
      }),
      tokenEndpoint: CHATGPT_TOKEN_ENDPOINT,
    }),
    /JWKS URI is invalid/u,
  );
});

test("refetches JWKS when a signing key rotates under the same kid", async () => {
  let fetches = 0;
  const verifier = createClientAssertionVerifier({
    fetchJwks: async () => {
      fetches += 1;
      return fetches === 1 ? CHATGPT_JWKS : ROTATED_CHATGPT_JWKS;
    },
    now: () => NOW_SECONDS * 1_000,
  });
  const client: ResolvedClient = {
    client_id: CHATGPT_CLIENT_ID,
    client_name: "ChatGPT",
    redirect_uris: [CHATGPT_REDIRECT_URI],
    token_endpoint_auth_method: "private_key_jwt",
    token_endpoint_auth_signing_alg: "RS256",
    jwks_uri: CHATGPT_JWKS_URI,
    grant_types: ["authorization_code"],
    response_types: ["code"],
  };

  await verifier.verify({
    client,
    clientId: CHATGPT_CLIENT_ID,
    clientAssertionType: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    clientAssertion: createChatGptAssertion({
      now: NOW_SECONDS,
      jti: "rotated-key",
      signingKey: WRONG_PRIVATE_KEY,
    }),
    tokenEndpoint: CHATGPT_TOKEN_ENDPOINT,
  });
  assert.equal(fetches, 2);
});

test("JWKS retrieval failure stays unavailable throughout forced-refresh cooldown", async () => {
  const { ClientMetadataUnavailable } = await import("../src/oauth/client-registry.js");
  let timestamp = 1_800_000_000_000, fetches = 0;
  const cache = createJwksKeyCache({ fetchJwks: async () => { fetches++; if (fetches > 1) throw new Error("private DNS detail"); return CHATGPT_JWKS; }, now: () => timestamp });
  await cache.getKey(CHATGPT_JWKS_URI, CHATGPT_KID);
  await assert.rejects(cache.getKey(CHATGPT_JWKS_URI, "rotated-kid"), ClientMetadataUnavailable);
  await assert.rejects(cache.getKey(CHATGPT_JWKS_URI, "rotated-kid"), ClientMetadataUnavailable);
  assert.equal(fetches, 2);
  timestamp += 11_000;
  await assert.rejects(cache.getKey(CHATGPT_JWKS_URI, "rotated-kid"), ClientMetadataUnavailable);
  assert.equal(fetches, 3);
});
