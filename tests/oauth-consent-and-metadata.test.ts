import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { renderConsentPage } from "../src/oauth/consent-page.js";
import { createAuthorizationServerMetadataHandler } from "../src/oauth/authorization-server-metadata.js";

test("escapes consent text and does not render logo or raw client URLs", () => {
  const html = renderConsentPage({
    transactionId: "tx-123",
    csrfToken: "csrf-123",
    clientName: "<img src=x onerror=alert(1)>",
    clientIdHostname: "claude.ai&lt;script&gt;",
    redirectHostname: "claude.ai\" autofocus onfocus=alert(1)",
  });

  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/u);
  assert.doesNotMatch(html, /<img src=x/u);
  assert.match(html, /claude\.ai&amp;lt;script&amp;gt;/u);
  assert.match(html, /claude\.ai&quot; autofocus onfocus=alert\(1\)/u);
  assert.match(html, /name="transaction" value="tx-123"/u);
  assert.match(html, /name="csrf_token" value="csrf-123"/u);
  assert.doesNotMatch(html, /logo|<img/iu);
});

test("publishes an authorization-server metadata document with CIMD and S256", () => {
  let body: unknown;
  const response = {
    setHeader: () => response,
    json: (value: unknown) => {
      body = value;
      return response;
    },
  } as unknown as Response;
  createAuthorizationServerMetadataHandler({
    issuer: "https://mcp.example.test",
    authorizationEndpoint: "https://mcp.example.test/oauth/authorize",
    tokenEndpoint: "https://mcp.example.test/oauth/token",
    requiredScope: "mcp:access",
  })({} as Request, response, (() => {}) as NextFunction);

  assert.deepEqual(body, {
    issuer: "https://mcp.example.test",
    authorization_endpoint: "https://mcp.example.test/oauth/authorize",
    token_endpoint: "https://mcp.example.test/oauth/token",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["mcp:access"],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
  });
});
