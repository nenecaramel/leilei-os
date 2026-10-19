import { timingSafeEqual } from "node:crypto";
import express, { type Response, type Router } from "express";
import { AccessTokenError, type AccessTokenVerifier } from "../auth/jwt-verifier.js";
import {
  assertRedirectUriAllowed,
  ClientMetadataUnavailable,
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
import {
  createClientAssertionVerifier,
  type JwksFetcher,
  type JwksKeyCache,
} from "./client-assertion-authentication.js";
import { createAuth0CodeExchange, createAuth0RefreshExchange, UpstreamTokenError, type UpstreamTokenSet, type UpstreamRefreshExchange } from "./upstream-client.js";
import { createRefreshTokenEnvelope } from "./refresh-token-envelope.js";

export type UpstreamCodeExchange = (input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  resource: string;
  audience: string;
}) => Promise<UpstreamTokenSet>;

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
  exchangeUpstreamRefresh?: UpstreamRefreshExchange;
  refreshTokenKey?: string;
  fetchJwks?: JwksFetcher;
  jwksCache?: JwksKeyCache;
  jwksTtlMs?: number;
  jwksMaxEntries?: number;
  replayMaxEntries?: number;
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
  refreshEnabled = false,
): boolean {
  const supported = new Set((refreshEnabled ? `${requiredScope} offline_access` : requiredScope).split(/\s+/u).filter(Boolean));
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
  const now = options.now ?? Date.now;
  const envelope = options.refreshTokenKey ? createRefreshTokenEnvelope({ key: options.refreshTokenKey, issuer: options.issuer, now }) : undefined;
  const exchangeUpstreamRefresh = options.exchangeUpstreamRefresh ?? createAuth0RefreshExchange({ tokenEndpoint: options.upstreamTokenEndpoint });
  const verifyClientAssertion = createClientAssertionVerifier({
    fetchJwks: options.fetchJwks ?? (async () => {
      throw new Error("JWKS fetcher is not configured");
    }),
    now: options.now,
    jwksCache: options.jwksCache,
    jwksTtlMs: options.jwksTtlMs,
    jwksMaxEntries: options.jwksMaxEntries,
    replayMaxEntries: options.replayMaxEntries,
  });
  router.use(express.urlencoded({ extended: false, limit: "64kb" }));

  router.get("/.well-known/oauth-authorization-server", createAuthorizationServerMetadataHandler({
    issuer: options.issuer,
    authorizationEndpoint: new URL("/oauth/authorize", options.issuer).toString(),
    tokenEndpoint: new URL("/oauth/token", options.issuer).toString(),
    requiredScope: options.requiredScope,
    refreshEnabled: !!envelope,
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
    } catch (error) {
      if (error instanceof ClientMetadataUnavailable) {
        response.status(503).setHeader("Cache-Control", "no-store").json({ error: "temporarily_unavailable" });
      } else sendError(response, "invalid_client");
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
      !scopeIsAllowed(scopes, options.requiredScope, client, !!envelope) ||
      (scopes.includes("offline_access") && !client.grant_types.includes("refresh_token"))
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
      const startedAt = now();
      const result = await exchangeUpstreamCode({
        code: upstreamCode,
        clientId: options.upstreamClientId,
        redirectUri: options.upstreamRedirectUri,
        codeVerifier: transaction.upstreamVerifier,
        resource: transaction.resource,
        audience: transaction.audience,
      });
      await verifyIssuedToken(options, result.accessToken);
      const accessTokenExpiresAt = startedAt + result.expiresIn * 1000;
      if (!Number.isSafeInteger(accessTokenExpiresAt) || result.expiresIn <= 0) throw new Error("Invalid upstream token expiry");
      const offline = transaction.scope.split(/\s+/u).includes("offline_access");
      if (offline && (!envelope || !result.refreshToken)) throw new Error("Offline access is unavailable");
      const refreshToken = offline ? envelope!.seal({
        clientId: transaction.client.client_id, subject: options.allowedSubject, resource: transaction.resource,
        audience: transaction.audience, scope: transaction.scope, upstreamToken: result.refreshToken!, expiresAt: now() + 30 * 86400_000,
      }) : undefined;
      const code = store.issueCode(transaction, result.accessToken, { accessTokenExpiresAt, ...(refreshToken ? { refreshToken } : {}) });
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
    if (request.header("authorization") || body?.client_secret !== undefined) {
      sendError(response, "invalid_client");
      return;
    }
    const grantType = valueOf(body?.grant_type);
    const clientId = valueOf(body?.client_id);
    const code = valueOf(body?.code);
    const redirectUri = valueOf(body?.redirect_uri);
    const codeVerifier = valueOf(body?.code_verifier);
    if (!clientId || (grantType !== "authorization_code" && grantType !== "refresh_token") ||
      (grantType === "authorization_code" && (!code || !redirectUri || !codeVerifier)) ||
      (grantType === "refresh_token" && (!envelope || !valueOf(body?.refresh_token)))) {
      sendInvalidRequest(response);
      return;
    }

    let client: ResolvedClient | undefined;
    try {
      client = await options.registry.resolve(clientId);
      if (!client || !client.grant_types.includes(grantType!)) throw new Error("OAuth client grant is not allowed");
      if (client.token_endpoint_auth_method === "none") {
        if (
          body?.client_assertion !== undefined ||
          body?.client_assertion_type !== undefined
        ) {
          throw new Error("client assertion is not supported for this client");
        }
      } else if (client.token_endpoint_auth_method === "private_key_jwt") {
        await verifyClientAssertion.verify({
          client,
          clientId,
          clientAssertionType: valueOf(body?.client_assertion_type),
          clientAssertion: valueOf(body?.client_assertion),
          tokenEndpoint: new URL("/oauth/token", options.issuer).toString(),
        });
      } else {
        throw new Error("OAuth client authentication method is unsupported");
      }
    } catch (error) {
      if (error instanceof ClientMetadataUnavailable) {
        response.status(503).setHeader("Cache-Control", "no-store").json({ error: "temporarily_unavailable" });
      } else sendError(response, "invalid_client");
      return;
    }

    if (grantType === "refresh_token") {
      let stage: "grant" | "upstream" | "verify" | "response" = "grant";
      try {
        const grant = envelope!.open(valueOf(body?.refresh_token)!);
        if (grant.clientId !== clientId || grant.subject !== options.allowedSubject || grant.resource !== options.resource || grant.audience !== options.audience ||
          !scopeIsAllowed(grant.scope.split(/\s+/u), options.requiredScope, client, true) ||
          (body?.resource !== undefined && body.resource !== grant.resource) || (body?.audience !== undefined && body.audience !== grant.audience) ||
          (body?.scope !== undefined && body.scope !== grant.scope)) throw new Error("Invalid refresh binding");
        const startedAt = now();
        stage = "upstream";
        const result = await exchangeUpstreamRefresh({ refreshToken: grant.upstreamToken, clientId: options.upstreamClientId, resource: grant.resource, audience: grant.audience });
        stage = "verify";
        await verifyIssuedToken(options, result.accessToken);
        stage = "response";
        // Public-client renewal requires upstream rotation/reuse detection. Never
        // silently accept an unrotated or absent replacement refresh token.
        if (!result.refreshToken || result.refreshToken === grant.upstreamToken || !Number.isSafeInteger(result.expiresIn) || result.expiresIn <= 0) throw new Error("Invalid upstream refresh rotation");
        const expiresIn = Math.floor((startedAt + result.expiresIn * 1000 - now()) / 1000);
        if (expiresIn <= 0) throw new Error("Refreshed access token expired");
        const refreshToken = envelope!.seal({ ...grant, upstreamToken: result.refreshToken });
        response.status(200).setHeader("Cache-Control", "no-store").json({ access_token: result.accessToken, token_type: "Bearer",
          expires_in: expiresIn, refresh_token: refreshToken, scope: grant.scope, resource: grant.resource, audience: grant.audience });
      } catch (error) {
        const transientVerification = error instanceof AccessTokenError &&
          ["jwks_unavailable", "verification_unknown", "token_expired"].includes(error.diagnosticReason);
        const terminalVerification = error instanceof AccessTokenError && !transientVerification;
        const temporary = error instanceof UpstreamTokenError ? error.retryable :
          stage !== "grant" && !terminalVerification;
        if (temporary) {
          response.status(503).setHeader("Cache-Control", "no-store").json({ error: "temporarily_unavailable" });
        } else sendError(response, "invalid_grant");
      }
      return;
    }
    try {
      const redeemed = store.redeemCode({ code: code!, clientId, redirectUri: redirectUri!, codeVerifier: codeVerifier! });
      if (redeemed.clientId !== client.client_id) {
        throw new Error("OAuth client authentication does not match the authorization code");
      }
      if (
        (body?.resource !== undefined && body.resource !== redeemed.resource) ||
        (body?.audience !== undefined && body.audience !== redeemed.audience) ||
        (body?.scope !== undefined && body.scope !== redeemed.scope)
      ) {
        throw new Error("OAuth token request binding is invalid");
      }
      const expiresIn = Math.floor(((redeemed.accessTokenExpiresAt ?? 0) - now()) / 1000);
      if (expiresIn <= 0) throw new Error("Access token expired before redemption");
      response
        .status(200)
        .setHeader("Cache-Control", "no-store")
        .json({
          access_token: redeemed.accessToken,
          token_type: "Bearer",
          expires_in: expiresIn,
          ...(redeemed.refreshToken ? { refresh_token: redeemed.refreshToken } : {}),
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
  if (principal.subject !== options.allowedSubject) throw new AccessTokenError("upstream token subject is not allowed", "invalid_token", "subject_not_allowed");
}

export function createOAuthAuthorizationServer(
  options: OAuthAuthorizationServerOptions,
): Router {
  const store = options.codeStore ?? createOAuthCodeStore({ now: options.now });
  return createClientAuthorizationRouter(options, store);
}
