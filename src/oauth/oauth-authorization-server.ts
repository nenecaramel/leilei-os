import { timingSafeEqual } from "node:crypto";
import express, { type Response, type Router } from "express";
import type { AccessTokenVerifier } from "../auth/jwt-verifier.js";
import {
  assertRedirectUriAllowed,
  type ClientRegistry,
  type ResolvedClient,
} from "./client-registry.js";
import { renderConsentPage } from "./consent-page.js";
import {
  createOAuthCodeStore,
  createOAuthOpaqueToken,
  createPkceChallenge,
  isValidPkceCodeChallenge,
  type OAuthCodeStore,
  type PendingOAuthTransaction,
} from "./oauth-code-store.js";
import {
  createAuthorizationServerMetadataHandler,
} from "./authorization-server-metadata.js";
import { createAuth0CodeExchange } from "./upstream-client.js";

export type UpstreamCodeExchange = (input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  resource: string;
  audience: string;
}) => Promise<{ accessToken: string }>;

export type OAuthAuthorizationServerOptions = {
  issuer: string;
  resource: string;
  audience: string;
  requiredScope: string;
  upstreamAuthorizationEndpoint: string;
  upstreamTokenEndpoint: string;
  upstreamClientId: string;
  upstreamRedirectUri: string;
  registry: ClientRegistry;
  verifyAccessToken: AccessTokenVerifier;
  allowedSubject: string;
  exchangeUpstreamCode?: UpstreamCodeExchange;
  codeStore?: OAuthCodeStore;
  now?: () => number;
};

function valueOf(input: unknown): string | undefined {
  return typeof input === "string" ? input : undefined;
}

function sendError(response: Response, error: string): void {
  response
    .status(400)
    .setHeader("Cache-Control", "no-store")
    .json({ error });
}

function sendInvalidRequest(response: Response): void {
  sendError(response, "invalid_request");
}

function redirectError(
  response: Response,
  transaction: PendingOAuthTransaction,
  error: "access_denied" | "server_error",
  issuer: string,
): void {
  const location = new URL(transaction.redirectUri);
  location.searchParams.set("error", error);
  if (transaction.state) location.searchParams.set("state", transaction.state);
  location.searchParams.set("iss", issuer);
  response.setHeader("Cache-Control", "no-store");
  response.redirect(location.toString());
}

function getHostname(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "registered-client";
  }
}

function parseScope(value: string): string[] | undefined {
  const scopes = value.split(/\s+/u).filter(Boolean);
  if (scopes.length === 0 || new Set(scopes).size !== scopes.length) return undefined;
  return scopes;
}

function readCookie(request: express.Request, name: string): string | undefined {
  const cookieHeader = request.header("cookie");
  if (!cookieHeader) return undefined;
  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === name) return cookie.slice(separator + 1).trim();
  }
  return undefined;
}

function secureOpaqueEquals(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function scopeIsAllowed(
  requested: readonly string[],
  requiredScope: string,
  client: ResolvedClient,
): boolean {
  const supported = new Set(requiredScope.split(/\s+/u).filter(Boolean));
  const clientScopes = client.scope === undefined ? undefined : new Set(parseScope(client.scope) ?? []);
  return (
    requiredScope.split(/\s+/u).filter(Boolean).every((scope) => requested.includes(scope)) &&
    requested.every((scope) => supported.has(scope) && (clientScopes === undefined || clientScopes.has(scope)))
  );
}

function createUpstreamAuthorizationUrl(
  options: OAuthAuthorizationServerOptions,
  transaction: PendingOAuthTransaction,
  upstreamState: string,
  upstreamVerifier: string,
): string {
  const url = new URL(options.upstreamAuthorizationEndpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: options.upstreamClientId,
    redirect_uri: options.upstreamRedirectUri,
    scope: transaction.scope,
    resource: transaction.resource,
    audience: transaction.audience,
    state: upstreamState,
    code_challenge: createPkceChallenge(upstreamVerifier),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

function createClientAuthorizationRouter(
  options: OAuthAuthorizationServerOptions,
  store: OAuthCodeStore,
): Router {
  const router = express.Router();
  const exchangeUpstreamCode = options.exchangeUpstreamCode ?? createAuth0CodeExchange({
    tokenEndpoint: options.upstreamTokenEndpoint,
  });
  router.use(express.urlencoded({ extended: false, limit: "10kb" }));

  router.get("/.well-known/oauth-authorization-server", createAuthorizationServerMetadataHandler({
    issuer: options.issuer,
    authorizationEndpoint: new URL("/oauth/authorize", options.issuer).toString(),
    tokenEndpoint: new URL("/oauth/token", options.issuer).toString(),
    requiredScope: options.requiredScope,
  }));

  router.get("/oauth/authorize", async (request, response) => {
    const clientId = valueOf(request.query.client_id);
    const redirectUri = valueOf(request.query.redirect_uri);
    if (!clientId || !redirectUri) {
      sendInvalidRequest(response);
      return;
    }

    let client: ResolvedClient | undefined;
    try {
      client = await options.registry.resolve(clientId);
    } catch {
      sendError(response, "invalid_client");
      return;
    }
    if (!client) {
      sendError(response, "invalid_client");
      return;
    }

    try {
      assertRedirectUriAllowed(client, redirectUri);
    } catch {
      sendInvalidRequest(response);
      return;
    }

    const responseType = valueOf(request.query.response_type);
    const scopeValue = valueOf(request.query.scope);
    const resource = valueOf(request.query.resource);
    const audience = valueOf(request.query.audience);
    const codeChallenge = valueOf(request.query.code_challenge);
    const codeChallengeMethod = valueOf(request.query.code_challenge_method);
    const state = valueOf(request.query.state);
    const scopes = scopeValue ? parseScope(scopeValue) : undefined;
    if (
      responseType !== "code" ||
      !scopes ||
      !resource ||
      resource !== options.resource ||
      (audience !== undefined && audience !== options.audience) ||
      !codeChallenge ||
      codeChallengeMethod !== "S256" ||
      !isValidPkceCodeChallenge(codeChallenge) ||
      (state !== undefined && state.length > 2048) ||
      !scopeIsAllowed(scopes, options.requiredScope, client)
    ) {
      sendInvalidRequest(response);
      return;
    }

    let transaction: PendingOAuthTransaction;
    try {
      transaction = store.createTransaction({
        client,
        consentToken: createOAuthOpaqueToken(),
        redirectUri,
        ...(state !== undefined ? { state } : {}),
        scope: scopes.join(" "),
        resource,
        audience: audience ?? options.audience,
        codeChallenge,
      });
    } catch {
      sendError(response, "temporarily_unavailable");
      return;
    }
    response
      .status(200)
      .setHeader("Cache-Control", "no-store")
      .setHeader(
        "Set-Cookie",
        `oauth_consent=${transaction.consentToken}; Path=/oauth/consent; HttpOnly; SameSite=Lax; Secure`,
      )
      .type("html")
      .send(renderConsentPage({
        transactionId: transaction.id,
        csrfToken: transaction.consentToken,
        clientName: client.client_name,
        clientIdHostname: getHostname(client.client_id),
        redirectHostname: getHostname(redirectUri),
      }));
  });

  router.post("/oauth/consent", (request, response) => {
    const transactionId = valueOf(request.body?.transaction);
    const csrfToken = valueOf(request.body?.csrf_token);
    const decision = valueOf(request.body?.decision);
    const transaction = transactionId ? store.getTransaction(transactionId) : undefined;
    if (
      !transaction ||
      !secureOpaqueEquals(csrfToken, transaction.consentToken) ||
      !secureOpaqueEquals(readCookie(request, "oauth_consent"), transaction.consentToken) ||
      (decision !== "approve" && decision !== "deny")
    ) {
      sendInvalidRequest(response);
      return;
    }
    if (decision === "deny") {
      store.removeTransaction(transaction.id);
      redirectError(response, transaction, "access_denied", options.issuer);
      return;
    }

    try {
      const upstream = store.beginUpstream(transaction.id);
      response.setHeader("Cache-Control", "no-store");
      response.redirect(createUpstreamAuthorizationUrl(options, transaction, upstream.state, upstream.verifier));
    } catch {
      sendInvalidRequest(response);
    }
  });

  router.get("/oauth/callback", async (request, response) => {
    const upstreamState = valueOf(request.query.state);
    if (!upstreamState) {
      sendInvalidRequest(response);
      return;
    }
    const transaction = store.claimTransactionByUpstreamState(upstreamState);
    if (!transaction || !transaction.upstreamVerifier) {
      sendInvalidRequest(response);
      return;
    }
    if (valueOf(request.query.error)) {
      redirectError(response, transaction, "access_denied", options.issuer);
      return;
    }
    const upstreamCode = valueOf(request.query.code);
    if (!upstreamCode) {
      redirectError(response, transaction, "server_error", options.issuer);
      return;
    }

    try {
      const result = await exchangeUpstreamCode({
        code: upstreamCode,
        clientId: options.upstreamClientId,
        redirectUri: options.upstreamRedirectUri,
        codeVerifier: transaction.upstreamVerifier,
        resource: transaction.resource,
        audience: transaction.audience,
      });
      await verifyIssuedToken(options, result.accessToken);
      const code = store.issueCode(transaction, result.accessToken);
      const location = new URL(transaction.redirectUri);
      location.searchParams.set("code", code);
      if (transaction.state) location.searchParams.set("state", transaction.state);
      location.searchParams.set("iss", options.issuer);
      response.setHeader("Cache-Control", "no-store");
      response.redirect(location.toString());
    } catch {
      redirectError(response, transaction, "server_error", options.issuer);
    }
  });

  router.post("/oauth/token", async (request, response) => {
    const body = request.body as Record<string, unknown> | undefined;
    if (
      request.header("authorization") ||
      body?.client_secret !== undefined ||
      body?.client_assertion !== undefined ||
      body?.client_assertion_type !== undefined
    ) {
      sendError(response, "invalid_client");
      return;
    }
    const grantType = valueOf(body?.grant_type);
    const clientId = valueOf(body?.client_id);
    const code = valueOf(body?.code);
    const redirectUri = valueOf(body?.redirect_uri);
    const codeVerifier = valueOf(body?.code_verifier);
    if (!clientId || !code || !redirectUri || !codeVerifier || grantType !== "authorization_code") {
      sendInvalidRequest(response);
      return;
    }

    try {
      const redeemed = store.redeemCode({ code, clientId, redirectUri, codeVerifier });
      if (
        (body?.resource !== undefined && body.resource !== redeemed.resource) ||
        (body?.audience !== undefined && body.audience !== redeemed.audience) ||
        (body?.scope !== undefined && body.scope !== redeemed.scope)
      ) {
        throw new Error("OAuth token request binding is invalid");
      }
      response
        .status(200)
        .setHeader("Cache-Control", "no-store")
        .json({
          access_token: redeemed.accessToken,
          token_type: "Bearer",
          expires_in: 3600,
          scope: redeemed.scope,
          resource: redeemed.resource,
          audience: redeemed.audience,
        });
    } catch {
      sendError(response, "invalid_grant");
    }
  });

  return router;
}

async function verifyIssuedToken(
  options: OAuthAuthorizationServerOptions,
  accessToken: string,
): Promise<void> {
  if (typeof accessToken !== "string" || accessToken.length === 0) throw new Error("upstream token is invalid");
  const principal = await options.verifyAccessToken(accessToken);
  if (principal.subject !== options.allowedSubject) throw new Error("upstream token subject is not allowed");
}

export function createOAuthAuthorizationServer(
  options: OAuthAuthorizationServerOptions,
): Router {
  const store = options.codeStore ?? createOAuthCodeStore({ now: options.now });
  return createClientAuthorizationRouter(options, store);
}
