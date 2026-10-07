import type { OAuthStaticClientConfig } from "../config/env.js";
import {
  isCompliantCimdClientIdentifier,
  isCompliantSecureJsonUrl,
  type MetadataFetcher,
} from "./secure-metadata-fetch.js";

export type OAuthClientMetadata = {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method?: string;
  token_endpoint_auth_methods_supported?: string[];
  token_endpoint_auth_signing_alg?: string;
  jwks_uri?: string;
  grant_types?: string[];
  response_types?: string[];
  scope?: string;
  [key: string]: unknown;
};

export type ResolvedClient = {
  client_id: string;
  client_name: string;
  redirect_uris: readonly string[];
  token_endpoint_auth_method: "none" | "private_key_jwt";
  token_endpoint_auth_signing_alg?: "RS256";
  jwks_uri?: string;
  grant_types: readonly string[];
  response_types: readonly string[];
  scope?: string;
};

export type ClientRegistry = {
  resolve(clientId: string): Promise<ResolvedClient | undefined>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateRedirectUri(value: string): void {
  if (value.length === 0 || value !== value.trim()) {
    throw new Error("CIMD redirect URI is invalid");
  }
  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    throw new Error("CIMD redirect URI is invalid");
  }
  const loopback = uri.hostname === "localhost" || uri.hostname === "127.0.0.1" || uri.hostname === "[::1]" || uri.hostname === "::1";
  if ((uri.protocol !== "https:" && !(uri.protocol === "http:" && loopback)) || uri.username || uri.password || uri.hash) {
    throw new Error("CIMD redirect URI is invalid");
  }
}

function hasOnlyAllowedClientAuthenticationMethod(
  value: string,
): value is "none" | "private_key_jwt" {
  if (/^client_secret_/u.test(value)) {
    throw new Error("shared-secret client authentication is forbidden");
  }
  if (value !== "none" && value !== "private_key_jwt") {
    throw new Error("client authentication method is unsupported");
  }
  return true;
}

export function validateClientMetadata(
  raw: unknown,
  requestedClientId: string,
): ResolvedClient {
  if (!isRecord(raw)) throw new Error("CIMD metadata must be a JSON object");
  if (typeof raw.client_id !== "string" || raw.client_id.length === 0) {
    throw new Error("CIMD client_id is required");
  }
  if (raw.client_id !== requestedClientId) {
    throw new Error("CIMD client_id must exactly match the requested client id");
  }
  if (typeof raw.client_name !== "string" || raw.client_name.trim().length === 0) {
    throw new Error("CIMD client_name is required");
  }
  if (
    !Array.isArray(raw.redirect_uris) ||
    raw.redirect_uris.length === 0 ||
    raw.redirect_uris.some((value) => typeof value !== "string" || value.length === 0)
  ) {
    throw new Error("CIMD redirect_uris is required");
  }
  const redirectUris = raw.redirect_uris as string[];
  if (new Set(redirectUris).size !== redirectUris.length) {
    throw new Error("CIMD redirect_uris must be unique");
  }
  for (const redirectUri of redirectUris) validateRedirectUri(redirectUri);

  const authMethod = raw.token_endpoint_auth_method === undefined
    ? "none"
    : raw.token_endpoint_auth_method;
  if (typeof authMethod !== "string") {
    throw new Error("CIMD client authentication method is invalid");
  }
  if (!hasOnlyAllowedClientAuthenticationMethod(authMethod)) {
    throw new Error("client authentication method is unsupported");
  }
  if (raw.token_endpoint_auth_methods_supported !== undefined) {
    if (
      !Array.isArray(raw.token_endpoint_auth_methods_supported) ||
      raw.token_endpoint_auth_methods_supported.some((value) => typeof value !== "string") ||
      !raw.token_endpoint_auth_methods_supported.includes(authMethod)
    ) {
      throw new Error("CIMD client authentication methods are invalid");
    }
  }

  let jwksUri: string | undefined;
  let signingAlg: "RS256" | undefined;
  if (authMethod === "private_key_jwt") {
    if (
      typeof raw.jwks_uri !== "string" ||
      !isCompliantSecureJsonUrl(raw.jwks_uri)
    ) {
      throw new Error("private_key_jwt clients require a valid HTTPS jwks_uri");
    }
    if (raw.token_endpoint_auth_signing_alg !== "RS256") {
      throw new Error("Only RS256 client assertion signing is supported");
    }
    jwksUri = raw.jwks_uri;
    signingAlg = "RS256";
  }

  const grantTypes = raw.grant_types === undefined ? ["authorization_code"] : raw.grant_types;
  if (
    !Array.isArray(grantTypes) ||
    !grantTypes.includes("authorization_code") ||
    grantTypes.some((value) => typeof value !== "string")
  ) {
    throw new Error("CIMD authorization_code grant is required");
  }
  const responseTypes = raw.response_types === undefined ? ["code"] : raw.response_types;
  if (
    !Array.isArray(responseTypes) ||
    !responseTypes.includes("code") ||
    responseTypes.some((value) => typeof value !== "string")
  ) {
    throw new Error("CIMD code response type is required");
  }
  if (raw.scope !== undefined && (typeof raw.scope !== "string" || raw.scope.trim().length === 0)) {
    throw new Error("CIMD scope is invalid");
  }

  return {
    client_id: requestedClientId,
    client_name: raw.client_name,
    redirect_uris: [...redirectUris],
    token_endpoint_auth_method: authMethod,
    ...(jwksUri !== undefined ? { jwks_uri: jwksUri } : {}),
    ...(signingAlg !== undefined ? { token_endpoint_auth_signing_alg: signingAlg } : {}),
    grant_types: [...(grantTypes as string[])],
    response_types: [...(responseTypes as string[])],
    ...(typeof raw.scope === "string" ? { scope: raw.scope } : {}),
  };
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "[::1]"
    || hostname === "::1";
}

function loopbackRedirectMatches(
  registeredRedirectUri: string,
  requestedRedirectUri: string,
): boolean {
  let registered: URL;
  let requested: URL;
  try {
    registered = new URL(registeredRedirectUri);
    requested = new URL(requestedRedirectUri);
  } catch {
    return false;
  }

  return registered.protocol === "http:"
    && requested.protocol === "http:"
    && isLoopbackHostname(registered.hostname)
    && registered.hostname === requested.hostname
    && registered.port === ""
    && registered.pathname === requested.pathname
    && registered.search === requested.search
    && registered.hash === requested.hash
    && !requested.username
    && !requested.password;
}

export function assertRedirectUriAllowed(
  client: ResolvedClient,
  requestedRedirectUri: string,
): void {
  if (!client.redirect_uris.some((redirectUri) =>
    redirectUri === requestedRedirectUri
    || loopbackRedirectMatches(redirectUri, requestedRedirectUri)
  )) {
    throw new Error("redirect_uri is not registered for this client");
  }
}

export function createClientRegistry(options: {
  staticClients: readonly OAuthStaticClientConfig[];
  trustedClientMetadataUrls: readonly string[];
  fetchMetadata: MetadataFetcher["fetch"];
}): ClientRegistry {
  const staticClients = new Map<string, OAuthStaticClientConfig>();
  for (const client of options.staticClients) {
    if (staticClients.has(client.client_id)) {
      throw new Error("static OAuth client ids must be unique");
    }
    staticClients.set(client.client_id, client);
  }
  const trustedClientMetadataUrls = new Set(options.trustedClientMetadataUrls);

  return {
    async resolve(clientId) {
      const staticClient = staticClients.get(clientId);
      if (staticClient) return validateClientMetadata(staticClient, clientId);
      if (!isCompliantCimdClientIdentifier(clientId) || !trustedClientMetadataUrls.has(clientId)) {
        return undefined;
      }
      return validateClientMetadata(await options.fetchMetadata(clientId), clientId);
    },
  };
}
