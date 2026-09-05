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
  OAUTH_AS_ENABLED: true,
  OAUTH_AS_UPSTREAM_CLIENT_ID: "auth0-upstream-client",
  OAUTH_AS_UPSTREAM_REDIRECT_URI: "https://mcp.example.test/oauth/callback",
} satisfies RuntimeEnv;

const currentChatGptClient = {
  client_id: "https://chatgpt.com/oauth/client.json",
  client_name: "ChatGPT",
  redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
  token_endpoint_auth_method: "private_key_jwt",
  token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
  token_endpoint_auth_signing_alg: "RS256",
  jwks_uri: "https://chatgpt.com/oauth/jwks.json",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
} as const;

function configure(client: Record<string, unknown>): RuntimeEnv {
  return configureClients([client]);
}

function configureClients(clients: readonly Record<string, unknown>[]): RuntimeEnv {
  return {
    ...baseEnvironment,
    OAUTH_STATIC_CLIENTS_JSON: JSON.stringify(clients),
  };
}

test("keeps current ChatGPT static trust bound to chatgpt.com client and redirect origins", () => {
  for (const client of [
    {
      ...currentChatGptClient,
      client_id: "https://chatgpt.example/oauth/client.json",
    },
    {
      ...currentChatGptClient,
      client_id: "https://chatgpt.com/oauth/not-a-client.json",
    },
    {
      ...currentChatGptClient,
      redirect_uris: ["https://attacker.example/connector_platform_oauth_redirect"],
    },
    {
      ...currentChatGptClient,
      redirect_uris: ["https://chatgpt.com/not-a-connector-callback"],
    },
  ]) {
    assert.throws(
      () => getOAuthAuthorizationServerConfig(configure(client)),
      /trusted ChatGPT.*private_key_jwt|ChatGPT/u,
    );
  }
});

test("keeps current ChatGPT static trust bound to private_key_jwt RS256 and the production JWKS", () => {
  for (const client of [
    {
      ...currentChatGptClient,
      token_endpoint_auth_method: "none",
    },
    {
      ...currentChatGptClient,
      token_endpoint_auth_signing_alg: "RS512",
    },
    {
      ...currentChatGptClient,
      jwks_uri: "https://chatgpt.com/oauth/other-jwks.json",
    },
  ]) {
    assert.throws(
      () => getOAuthAuthorizationServerConfig(configure(client)),
      /trusted ChatGPT.*private_key_jwt|static client registry|RS256|ChatGPT/u,
    );
  }
});

test("rejects an unsafe additional ChatGPT static client even when another ChatGPT client is valid", () => {
  const unsafeRotatedClient = {
    ...currentChatGptClient,
    client_id: "https://chatgpt.com/oauth/rotated-client/client.json",
    redirect_uris: ["https://attacker.example/connector_platform_oauth_redirect"],
  };

  assert.throws(
    () => getOAuthAuthorizationServerConfig(configureClients([
      currentChatGptClient,
      unsafeRotatedClient,
    ])),
    /trusted ChatGPT.*private_key_jwt|ChatGPT/u,
  );
});
