import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRedirectUriAllowed,
  createClientRegistry,
  validateClientMetadata,
  type OAuthClientMetadata,
} from "../src/oauth/client-registry.js";

const CLIENT_ID = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const REDIRECT_URI = "https://claude.ai/oauth/callback";

const validMetadata: OAuthClientMetadata = {
  client_id: CLIENT_ID,
  client_name: "Claude",
  redirect_uris: [REDIRECT_URI],
  grant_types: ["authorization_code"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
};

test("resolves an exact static client before consulting CIMD", async () => {
  let fetched = false;
  const registry = createClientRegistry({
    staticClients: [{
      client_id: "chatgpt-static-client",
      client_name: "ChatGPT",
      redirect_uris: ["https://chatgpt.example/callback"],
      token_endpoint_auth_method: "none",
    }],
    trustedClientMetadataUrls: ["https://chatgpt-static-client"],
    fetchMetadata: async () => {
      fetched = true;
      return validMetadata;
    },
  });

  const resolved = await registry.resolve("chatgpt-static-client");
  assert.equal(resolved?.client_name, "ChatGPT");
  assert.equal(fetched, false);
});

test("does not fetch malformed, non-HTTPS, or untrusted client identifiers", async () => {
  let fetched = false;
  const registry = createClientRegistry({
    staticClients: [],
    trustedClientMetadataUrls: [CLIENT_ID],
    fetchMetadata: async () => {
      fetched = true;
      return validMetadata;
    },
  });

  for (const clientId of [
    "not-a-url",
    "http://claude.ai/oauth/mcp-oauth-client-metadata",
    "https://other.example/client.json",
    "https://claude.ai/",
    "https://claude.ai/oauth/../metadata",
  ]) {
    assert.equal(await registry.resolve(clientId), undefined, clientId);
  }
  assert.equal(fetched, false);
});

test("requires exact client_id and safely permits ephemeral loopback callback ports", () => {
  assert.throws(
    () => validateClientMetadata({ ...validMetadata, client_id: "https://claude.ai/oauth/mcp-oauth-client-metadata/" }, CLIENT_ID),
    /client_id.*match|exact/u,
  );
  assert.throws(
    () => validateClientMetadata(validMetadata, "https://claude.ai/oauth/mcp-oauth-client-metadata/"),
    /client_id.*match|exact/u,
  );
  const resolved = validateClientMetadata(validMetadata, CLIENT_ID);
  assert.throws(() => assertRedirectUriAllowed(resolved, "https://claude.ai/oauth/other"), /redirect/u);
  assert.doesNotThrow(() => assertRedirectUriAllowed(resolved, REDIRECT_URI));

  const loopback = validateClientMetadata({
    ...validMetadata,
    redirect_uris: [
      "http://localhost/callback",
      "http://127.0.0.1/callback",
      "http://localhost:8080/fixed",
    ],
  }, CLIENT_ID);
  assert.doesNotThrow(() => assertRedirectUriAllowed(loopback, "http://localhost:59451/callback"));
  assert.doesNotThrow(() => assertRedirectUriAllowed(loopback, "http://127.0.0.1:43123/callback"));
  assert.throws(() => assertRedirectUriAllowed(loopback, "http://localhost:59451/other"), /redirect/u);
  assert.throws(() => assertRedirectUriAllowed(loopback, "http://localhost:59451/callback?next=1"), /redirect/u);
  assert.throws(() => assertRedirectUriAllowed(loopback, "https://localhost:59451/callback"), /redirect/u);
  assert.throws(() => assertRedirectUriAllowed(loopback, "http://localhost:8081/fixed"), /redirect/u);
});

test("requires the three mandatory fields and authorization-code support", () => {
  for (const metadata of [
    { ...validMetadata, client_name: "" },
    { ...validMetadata, redirect_uris: [] },
    { ...validMetadata, grant_types: ["client_credentials"] },
    { ...validMetadata, response_types: ["token"] },
  ]) {
    assert.throws(
      () => validateClientMetadata(metadata, CLIENT_ID),
      /client_name|redirect|authorization_code|code/u,
    );
  }
  assert.doesNotThrow(() => validateClientMetadata({ ...validMetadata, redirect_uris: ["http://localhost:43123/callback"] }, CLIENT_ID));
});

test("rejects shared-secret authentication methods", () => {
  for (const method of ["client_secret_basic", "client_secret_post", "client_secret_jwt"]) {
    assert.throws(
      () => validateClientMetadata({ ...validMetadata, token_endpoint_auth_method: method }, CLIENT_ID),
      /shared-secret|client authentication|forbidden/u,
    );
  }
});

test("accepts the production ChatGPT private_key_jwt metadata", () => {
  assert.doesNotThrow(() => validateClientMetadata({
    client_id: "https://chatgpt.com/oauth/DC6KIBaz_41D/client.json",
    client_name: "ChatGPT",
    redirect_uris: ["https://chatgpt.com/connector/oauth/DC6KIBaz_41D"],
    token_endpoint_auth_method: "private_key_jwt",
    token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
    token_endpoint_auth_signing_alg: "RS256",
    jwks_uri: "https://chatgpt.com/oauth/jwks.json",
  }, "https://chatgpt.com/oauth/DC6KIBaz_41D/client.json"));
});

test("resolves trusted CIMD metadata and never follows logo or other secondary URLs", async () => {
  const requested: string[] = [];
  const registry = createClientRegistry({
    staticClients: [],
    trustedClientMetadataUrls: [CLIENT_ID],
    fetchMetadata: async (clientId) => {
      requested.push(clientId);
      return {
        ...validMetadata,
        logo_uri: "https://attacker.example/logo.png",
        jwks_uri: "https://attacker.example/jwks.json",
      };
    },
  });

  const resolved = await registry.resolve(CLIENT_ID);
  assert.equal(resolved?.client_id, CLIENT_ID);
  assert.deepEqual(requested, [CLIENT_ID]);
  assert.equal("logo_uri" in (resolved ?? {}), false);
  assert.equal("jwks_uri" in (resolved ?? {}), false);
});
