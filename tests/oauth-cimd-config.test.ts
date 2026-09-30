import assert from "node:assert/strict";
import test from "node:test";
import {
  getOAuthAuthorizationServerConfig,
  requireOAuthConfig,
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
    client_id: "https://chatgpt.com/oauth/DC6KIBaz_41D/client.json",
    client_name: "ChatGPT",
    redirect_uris: ["https://chatgpt.com/connector/oauth/DC6KIBaz_41D"],
    token_endpoint_auth_method: "private_key_jwt",
    token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
    token_endpoint_auth_signing_alg: "RS256",
    jwks_uri: "https://chatgpt.com/oauth/jwks.json",
  },
]);

test("accepts already-normalized boolean flags when OAuth config is re-parsed", () => {
  const config = requireOAuthConfig({
    ...baseEnvironment,
    NATIVE_LIVE_SEND_FILE_ENABLED: true,
  });

  assert.equal(config.NATIVE_LIVE_SEND_FILE_ENABLED, true);
});

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
    OAUTH_STATIC_CLIENTS_JSON: chatGptStaticClientsJson,
    OAUTH_AS_UPSTREAM_CLIENT_ID: "auth0-upstream-client",
    OAUTH_AS_UPSTREAM_REDIRECT_URI: "https://mcp.example.test/oauth/callback",
  });

  assert.ok(config);
  assert.deepEqual(config.staticClients, JSON.parse(chatGptStaticClientsJson));
});

test("retains private_key_jwt metadata in the static client registry", () => {
  const config = getOAuthAuthorizationServerConfig({
    ...baseEnvironment,
    OAUTH_AS_ENABLED: true,
    OAUTH_AS_UPSTREAM_CLIENT_ID: "auth0-upstream-client",
    OAUTH_AS_UPSTREAM_REDIRECT_URI: "https://mcp.example.test/oauth/callback",
    OAUTH_STATIC_CLIENTS_JSON: JSON.stringify([{
      client_id: "https://chatgpt.com/oauth/DC6KIBaz_41D/client.json",
      client_name: "ChatGPT",
      redirect_uris: ["https://chatgpt.com/connector/oauth/DC6KIBaz_41D"],
      token_endpoint_auth_method: "private_key_jwt",
      token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
      token_endpoint_auth_signing_alg: "RS256",
      jwks_uri: "https://chatgpt.com/oauth/jwks.json",
    }]),
  });

  assert.ok(config);
  assert.equal(config.staticClients[0]?.token_endpoint_auth_method, "private_key_jwt");
  assert.equal(config.staticClients[0]?.token_endpoint_auth_signing_alg, "RS256");
  assert.equal(config.staticClients[0]?.jwks_uri, "https://chatgpt.com/oauth/jwks.json");
});

test("refuses local OAuth AS without the exact production ChatGPT static client", () => {
  for (const clients of [
    [{
      client_id: "https://other.example/client.json",
      client_name: "Other",
      redirect_uris: ["https://other.example/callback"],
      token_endpoint_auth_method: "none",
    }],
    [{
      client_id: "https://chatgpt.com/oauth/DC6KIBaz_41D/client.json",
      client_name: "ChatGPT",
      redirect_uris: ["https://chatgpt.com/connector/oauth/DC6KIBaz_41D"],
      token_endpoint_auth_method: "none",
    }],
  ]) {
    assert.throws(
      () => getOAuthAuthorizationServerConfig({
        ...baseEnvironment,
        OAUTH_AS_ENABLED: true,
        OAUTH_AS_UPSTREAM_CLIENT_ID: "auth0-upstream-client",
        OAUTH_AS_UPSTREAM_REDIRECT_URI: "https://mcp.example.test/oauth/callback",
        OAUTH_STATIC_CLIENTS_JSON: JSON.stringify(clients),
      }),
      /existing ChatGPT.*private_key_jwt|ChatGPT/u,
    );
  }
});

test("rejects shared-secret static authentication and incomplete private_key_jwt metadata", () => {
  for (const metadata of [
    {
      client_id: "chatgpt-static-client",
      client_name: "ChatGPT",
      redirect_uris: ["https://chatgpt.example/callback"],
      token_endpoint_auth_method: "client_secret_jwt",
    },
    {
      client_id: "https://chatgpt.com/oauth/DC6KIBaz_41D/client.json",
      client_name: "ChatGPT",
      redirect_uris: ["https://chatgpt.com/connector/oauth/DC6KIBaz_41D"],
      token_endpoint_auth_method: "private_key_jwt",
      token_endpoint_auth_signing_alg: "RS256",
    },
  ]) {
    assert.throws(
      () => getOAuthAuthorizationServerConfig({
        ...baseEnvironment,
        OAUTH_AS_ENABLED: true,
        OAUTH_AS_UPSTREAM_CLIENT_ID: "auth0-upstream-client",
        OAUTH_AS_UPSTREAM_REDIRECT_URI: "https://mcp.example.test/oauth/callback",
        OAUTH_STATIC_CLIENTS_JSON: JSON.stringify([metadata]),
      }),
      /private_key_jwt|shared-secret|client authentication|jwks_uri|invalid static client registry/u,
    );
  }
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

test("accepts the current ChatGPT static client without the legacy connector-specific id", () => {
  const currentChatGptStaticClientsJson = JSON.stringify([{
    client_id: "https://chatgpt.com/oauth/client.json",
    client_name: "ChatGPT",
    redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
    token_endpoint_auth_method: "private_key_jwt",
    token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
    token_endpoint_auth_signing_alg: "RS256",
    jwks_uri: "https://chatgpt.com/oauth/jwks.json",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  }]);

  const config = getOAuthAuthorizationServerConfig({
    ...baseEnvironment,
    OAUTH_AS_ENABLED: true,
    OAUTH_AS_UPSTREAM_CLIENT_ID: "auth0-upstream-client",
    OAUTH_AS_UPSTREAM_REDIRECT_URI: "https://mcp.example.test/oauth/callback",
    OAUTH_STATIC_CLIENTS_JSON: currentChatGptStaticClientsJson,
  });

  assert.ok(config);
  assert.deepEqual(config.staticClients, JSON.parse(currentChatGptStaticClientsJson));
});
