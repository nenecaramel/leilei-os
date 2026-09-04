import assert from "node:assert/strict";
import test from "node:test";
import {
  getOAuthAuthorizationServerConfig,
  type RuntimeEnv,
} from "../src/config/env.js";

const baseEnvironment = {
  PORT: 3000,
  HOST: "127.0.0.1",
  LOG_LEVEL: "error",
  MCP_USER_ID: "11111111-1111-4111-8111-111111111111",
  MCP_SERVER_URL: "https://mcp.example.test",
  AUTH0_ISSUER: "https://issuer.example.test/",
  AUTH0_AUDIENCE: "https://mcp.example.test/mcp",
  AUTH0_JWKS_URI: "https://issuer.example.test/.well-known/jwks.json",
  AUTH0_REQUIRED_SCOPE: "mcp:access",
  AUTH0_ALLOWED_SUBJECT: "allowed-subject",
} satisfies RuntimeEnv;

const chatGptStaticClientsJson = JSON.stringify([
  {
    client_id: "chatgpt-static-client",
    client_name: "ChatGPT",
    redirect_uris: ["https://chatgpt.example/callback"],
    token_endpoint_auth_method: "none",
  },
]);

test("uses the initial exact CIMD trust URL when no override is configured", () => {
  const config = getOAuthAuthorizationServerConfig({
    ...baseEnvironment,
    OAUTH_AS_ENABLED: true,
    OAUTH_AS_UPSTREAM_CLIENT_ID: "auth0-upstream-client",
    OAUTH_AS_UPSTREAM_REDIRECT_URI: "https://mcp.example.test/oauth/callback",
    OAUTH_STATIC_CLIENTS_JSON: chatGptStaticClientsJson,
  });

  assert.ok(config);
  assert.deepEqual(config.trustedClientMetadataUrls, [
    "https://claude.ai/oauth/mcp-oauth-client-metadata",
  ]);
});
test("an explicitly empty trust list remains enabled but fails closed", () => {
  const config = getOAuthAuthorizationServerConfig({
    ...baseEnvironment,
    OAUTH_AS_ENABLED: true,
    OAUTH_CIMD_TRUSTED_CLIENT_IDS: " , ",
    OAUTH_AS_UPSTREAM_CLIENT_ID: "auth0-upstream-client",
    OAUTH_AS_UPSTREAM_REDIRECT_URI: "https://mcp.example.test/oauth/callback",
    OAUTH_STATIC_CLIENTS_JSON: chatGptStaticClientsJson,
  });

  assert.ok(config);
  assert.deepEqual(config.trustedClientMetadataUrls, []);
});

test("parses static client JSON without allowing a malformed registry", () => {
  const config = getOAuthAuthorizationServerConfig({
    ...baseEnvironment,
    OAUTH_AS_ENABLED: true,
    OAUTH_STATIC_CLIENTS_JSON: JSON.stringify([
      {
        client_id: "chatgpt-static-client",
        client_name: "ChatGPT",
        redirect_uris: ["https://chatgpt.example/callback"],
        token_endpoint_auth_method: "none",
      },
    ]),
    OAUTH_AS_UPSTREAM_CLIENT_ID: "auth0-upstream-client",
    OAUTH_AS_UPSTREAM_REDIRECT_URI: "https://mcp.example.test/oauth/callback",
  });

  assert.ok(config);
  assert.deepEqual(config.staticClients, [
    {
      client_id: "chatgpt-static-client",
      client_name: "ChatGPT",
      redirect_uris: ["https://chatgpt.example/callback"],
      token_endpoint_auth_method: "none",
    },
  ]);
});

test("does not enable the adapter when the opt-in flag is absent", () => {
  assert.equal(getOAuthAuthorizationServerConfig(baseEnvironment), undefined);
});

test("enabled configuration requires an upstream client and callback", () => {
  assert.throws(
    () => getOAuthAuthorizationServerConfig({
      ...baseEnvironment,
      OAUTH_AS_ENABLED: true,
    }),
    /OAUTH_AS_UPSTREAM_CLIENT_ID|OAUTH_AS_UPSTREAM_REDIRECT_URI/u,
  );
});

test("refuses to enable the adapter without a static ChatGPT registry", () => {
  assert.throws(
    () => getOAuthAuthorizationServerConfig({
      ...baseEnvironment,
      OAUTH_AS_ENABLED: true,
      OAUTH_AS_UPSTREAM_CLIENT_ID: "auth0-upstream-client",
      OAUTH_AS_UPSTREAM_REDIRECT_URI: "https://mcp.example.test/oauth/callback",
    }),
    /OAUTH_STATIC_CLIENTS_JSON.*ChatGPT/u,
  );

  assert.throws(
    () => getOAuthAuthorizationServerConfig({
      ...baseEnvironment,
      OAUTH_AS_ENABLED: true,
      OAUTH_AS_UPSTREAM_CLIENT_ID: "auth0-upstream-client",
      OAUTH_AS_UPSTREAM_REDIRECT_URI: "https://mcp.example.test/oauth/callback",
      OAUTH_STATIC_CLIENTS_JSON: "[]",
    }),
    /OAUTH_STATIC_CLIENTS_JSON.*ChatGPT/u,
  );
});
