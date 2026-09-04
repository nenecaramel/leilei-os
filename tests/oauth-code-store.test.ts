import assert from "node:assert/strict";
import test from "node:test";
import { createOAuthCodeStore, createPkceChallenge } from "../src/oauth/oauth-code-store.js";
import type { ResolvedClient } from "../src/oauth/client-registry.js";

const client: ResolvedClient = {
  client_id: "https://client.example.test/metadata.json",
  client_name: "Test client",
  redirect_uris: ["https://client.example.test/callback"],
  token_endpoint_auth_method: "none",
  grant_types: ["authorization_code"],
  response_types: ["code"],
};

function transaction() {
  const verifier = "a".repeat(43);
  return {
    client,
    consentToken: "consent",
    redirectUri: client.redirect_uris[0]!,
    scope: "mcp:access",
    resource: "https://mcp.example.test/mcp",
    audience: "https://mcp.example.test/mcp",
    codeChallenge: createPkceChallenge(verifier),
  };
}

test("bounds pending OAuth transactions and authorization codes", () => {
  const store = createOAuthCodeStore({ maxPendingTransactions: 1, maxPendingCodes: 1 });
  const first = store.createTransaction(transaction());
  assert.throws(() => store.createTransaction(transaction()), /capacity/u);
  store.beginUpstream(first.id);
  const code = store.completeUpstream(first.upstreamState!, "access-token");
  assert.ok(code);
  assert.throws(() => {
    const second = store.createTransaction(transaction());
    store.beginUpstream(second.id);
    store.completeUpstream(second.upstreamState!, "access-token");
  }, /capacity/u);
});
