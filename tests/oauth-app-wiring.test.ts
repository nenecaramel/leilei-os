import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

const ENVIRONMENT_KEYS = [
  "MCP_USER_ID",
  "MCP_SERVER_URL",
  "AUTH0_ISSUER",
  "AUTH0_AUDIENCE",
  "AUTH0_JWKS_URI",
  "AUTH0_REQUIRED_SCOPE",
  "AUTH0_ALLOWED_SUBJECT",
  "DATABASE_URL",
  "WEB_APP_ORIGIN",
  "WEB_AUTH0_AUDIENCE",
  "WEB_AUTH0_REQUIRED_SCOPE",
  "OAUTH_AS_ENABLED",
  "OAUTH_AS_UPSTREAM_CLIENT_ID",
  "OAUTH_AS_UPSTREAM_REDIRECT_URI",
  "OAUTH_CIMD_TRUSTED_CLIENT_IDS",
  "OAUTH_STATIC_CLIENTS_JSON",
] as const;

test("mounts the opt-in AS while preserving Auth0 token and resource semantics", async () => {
  const previous = Object.fromEntries(ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    MCP_USER_ID: "11111111-1111-4111-8111-111111111111",
    MCP_SERVER_URL: "https://mcp.example.test",
    AUTH0_ISSUER: "https://issuer.example.test/",
    AUTH0_AUDIENCE: "https://mcp.example.test/mcp",
    AUTH0_JWKS_URI: "https://issuer.example.test/.well-known/jwks.json",
    AUTH0_REQUIRED_SCOPE: "mcp:access",
    AUTH0_ALLOWED_SUBJECT: "allowed-subject",
    OAUTH_AS_ENABLED: "true",
    OAUTH_AS_UPSTREAM_CLIENT_ID: "upstream-client",
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
  delete process.env.DATABASE_URL;
  delete process.env.WEB_APP_ORIGIN;
  delete process.env.WEB_AUTH0_AUDIENCE;
  delete process.env.WEB_AUTH0_REQUIRED_SCOPE;

  try {
    const { createApp } = await import("../src/app/create-app.js");
    const app = createApp({
      verifyAccessToken: async () => ({
        subject: "allowed-subject",
        issuer: "https://issuer.example.test/",
        audience: ["https://mcp.example.test/mcp"],
        scopes: ["mcp:access"],
      }),
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    try {
      const asMetadata = await fetch(`http://127.0.0.1:${address.port}/.well-known/oauth-authorization-server`);
      assert.equal(asMetadata.status, 200);
      assert.equal((await asMetadata.json()).client_id_metadata_document_supported, true);

      const protectedMetadata = await fetch(`http://127.0.0.1:${address.port}/.well-known/oauth-protected-resource`);
      assert.equal(protectedMetadata.status, 200);
      assert.deepEqual((await protectedMetadata.json()).authorization_servers, [
        "https://mcp.example.test",
        "https://issuer.example.test/",
      ]);

      const oauthPage = await fetch(`http://127.0.0.1:${address.port}/oauth`);
      assert.equal(oauthPage.status, 200);
      assert.match(await oauthPage.text(), /OAuth 2\.1/u);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  } finally {
    for (const key of ENVIRONMENT_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
