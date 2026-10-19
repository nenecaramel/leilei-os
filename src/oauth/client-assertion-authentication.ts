import { createPublicKey, createVerify } from "node:crypto";
import { ClientMetadataUnavailable, type ResolvedClient } from "./client-registry.js";
import { isCompliantSecureJsonUrl } from "./secure-metadata-fetch.js";

export const CLIENT_ASSERTION_TYPE =
  "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

type JsonObject = Record<string, unknown>;

type RsaJwk = JsonObject & {
  kty: "RSA";
  kid: string;
  n: string;
  e: string;
};

export type JwksFetcher = (jwksUri: string) => Promise<JsonObject>;

export type JwksKeyCache = {
  getKey(jwksUri: string, kid: string, forceRefresh?: boolean): Promise<RsaJwk>;
};

type JwksCacheEntry = {
  expiresAt: number;
  keys: readonly RsaJwk[];
  refreshUnavailable?: boolean;
};

const DEFAULT_JWKS_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_JWKS_MAX_ENTRIES = 32;
const DEFAULT_JWKS_REFRESH_COOLDOWN_MS = 10 * 1_000;
const DEFAULT_REPLAY_MAX_ENTRIES = 4_096;
const MAX_ASSERTION_BYTES = 16 * 1024;
const MAX_KEY_ID_LENGTH = 256;
const MAX_JTI_LENGTH = 256;
const MAX_ASSERTION_LIFETIME_SECONDS = 300;
const MAX_CLOCK_SKEW_SECONDS = 60;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRsaJwk(value: unknown): RsaJwk | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.kty !== "RSA" ||
    typeof value.kid !== "string" ||
    value.kid.length === 0 ||
    value.kid.length > MAX_KEY_ID_LENGTH ||
    typeof value.n !== "string" ||
    typeof value.e !== "string" ||
    value.alg !== undefined && value.alg !== "RS256" ||
    value.use !== undefined && value.use !== "sig" ||
    ["d", "p", "q", "dp", "dq", "qi", "oth"].some((name) => name in value)
  ) {
    return undefined;
  }
  return value as RsaJwk;
}

function parseJwks(value: unknown): readonly RsaJwk[] {
  if (!isRecord(value) || !Array.isArray(value.keys)) {
    throw new Error("JWKS response is invalid");
  }
  const keys = value.keys.map(asRsaJwk).filter((key): key is RsaJwk => key !== undefined);
  if (keys.length === 0 || new Set(keys.map((key) => key.kid)).size !== keys.length) {
    throw new Error("JWKS response has no usable unique RSA signing keys");
  }
  return keys;
}

export function createJwksKeyCache(options: {
  fetchJwks: JwksFetcher;
  now?: () => number;
  ttlMs?: number;
  maxEntries?: number;
  refreshCooldownMs?: number;
}): JwksKeyCache {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_JWKS_TTL_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_JWKS_MAX_ENTRIES;
  const refreshCooldownMs = options.refreshCooldownMs ?? DEFAULT_JWKS_REFRESH_COOLDOWN_MS;
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new Error("JWKS cache TTL must be positive");
  if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
    throw new Error("JWKS cache capacity must be positive");
  }
  if (!Number.isInteger(refreshCooldownMs) || refreshCooldownMs <= 0) {
    throw new Error("JWKS refresh cooldown must be positive");
  }

  const entries = new Map<string, JwksCacheEntry>();
  const inFlight = new Map<string, Promise<JwksCacheEntry>>();
  const lastForcedRefresh = new Map<string, number>();

  const refreshIsCoolingDown = (jwksUri: string): boolean => {
    const lastRefreshAt = lastForcedRefresh.get(jwksUri);
    if (lastRefreshAt === undefined) return false;
    if (now() - lastRefreshAt >= refreshCooldownMs) {
      lastForcedRefresh.delete(jwksUri);
      return false;
    }
    return true;
  };

  const claimForcedRefresh = (jwksUri: string): boolean => {
    if (refreshIsCoolingDown(jwksUri)) return false;
    if (!lastForcedRefresh.has(jwksUri) && lastForcedRefresh.size >= maxEntries) {
      const oldest = lastForcedRefresh.keys().next().value as string | undefined;
      if (oldest !== undefined) lastForcedRefresh.delete(oldest);
    }
    lastForcedRefresh.set(jwksUri, now());
    return true;
  };

  const load = async (jwksUri: string, forceRefresh: boolean): Promise<JwksCacheEntry> => {
    const cached = entries.get(jwksUri);
    if (!forceRefresh && cached && cached.expiresAt > now()) return cached;

    const pending = inFlight.get(jwksUri);
    if (pending) return pending;

    const request = options.fetchJwks(jwksUri)
      .catch(() => {
        if (cached) cached.refreshUnavailable = true;
        throw new ClientMetadataUnavailable();
      })
      .then((body) => ({ expiresAt: now() + ttlMs, keys: parseJwks(body) }))
      .then((entry) => {
        if (!entries.has(jwksUri) && entries.size >= maxEntries) {
          const oldest = entries.keys().next().value as string | undefined;
          if (oldest !== undefined) {
            entries.delete(oldest);
            lastForcedRefresh.delete(oldest);
          }
        }
        entries.delete(jwksUri);
        entries.set(jwksUri, entry);
        return entry;
      });
    inFlight.set(jwksUri, request);
    try {
      return await request;
    } finally {
      inFlight.delete(jwksUri);
    }
  };

  return {
    async getKey(jwksUri, kid, forceRefresh = false) {
      let entry: JwksCacheEntry;
      if (forceRefresh) {
        if (claimForcedRefresh(jwksUri)) {
          entry = await load(jwksUri, true);
        } else {
          const cached = entries.get(jwksUri);
          if (!cached || cached.expiresAt <= now()) {
            throw new ClientMetadataUnavailable();
          }
          if (cached.refreshUnavailable) throw new ClientMetadataUnavailable();
          entry = cached;
        }
      } else {
        entry = await load(jwksUri, false);
      }
      let key = entry.keys.find((candidate) => candidate.kid === kid);
      if (!key && !forceRefresh) {
        if (!claimForcedRefresh(jwksUri)) {
          if (entry.refreshUnavailable) throw new ClientMetadataUnavailable();
          throw new Error("JWKS key id is unknown");
        }
        entry = await load(jwksUri, true);
        key = entry.keys.find((candidate) => candidate.kid === kid);
      }
      if (!key) throw new Error("JWKS key id is unknown");
      return key;
    },
  };
}

function decodeJsonPart(value: string): JsonObject {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!isRecord(decoded)) throw new Error("JWT part must be an object");
    return decoded;
  } catch {
    throw new Error("client assertion is malformed");
  }
}

function verifySignature(
  signingInput: string,
  signature: string,
  key: RsaJwk,
): boolean {
  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(signingInput);
    verifier.end();
    return verifier.verify(
      createPublicKey({ key, format: "jwk" }),
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}

export type ClientAssertionVerifier = {
  verify(input: {
    client: ResolvedClient;
    clientId: string;
    clientAssertionType: string | undefined;
    clientAssertion: string | undefined;
    tokenEndpoint: string;
  }): Promise<void>;
};

export function createClientAssertionVerifier(options: {
  fetchJwks: JwksFetcher;
  now?: () => number;
  jwksCache?: JwksKeyCache;
  jwksTtlMs?: number;
  jwksMaxEntries?: number;
  replayMaxEntries?: number;
}): ClientAssertionVerifier {
  const now = options.now ?? Date.now;
  const jwksCache = options.jwksCache ?? createJwksKeyCache({
    fetchJwks: options.fetchJwks,
    now,
    ttlMs: options.jwksTtlMs,
    maxEntries: options.jwksMaxEntries,
  });
  const replayMaxEntries = options.replayMaxEntries ?? DEFAULT_REPLAY_MAX_ENTRIES;
  if (!Number.isInteger(replayMaxEntries) || replayMaxEntries <= 0) {
    throw new Error("client assertion replay cache capacity must be positive");
  }
  const usedJtis = new Map<string, number>();

  const sweepReplays = (timestamp: number): void => {
    for (const [key, expiresAt] of usedJtis) {
      if (expiresAt <= timestamp) usedJtis.delete(key);
    }
  };

  return {
    async verify(input) {
      if (input.client.token_endpoint_auth_method !== "private_key_jwt") {
        throw new Error("client assertion is not valid for this client");
      }
      if (
        input.clientAssertionType !== CLIENT_ASSERTION_TYPE ||
        typeof input.clientAssertion !== "string" ||
        Buffer.byteLength(input.clientAssertion, "utf8") > MAX_ASSERTION_BYTES
      ) {
        throw new Error("client assertion authentication is invalid");
      }
      if (!input.client.jwks_uri || !isCompliantSecureJsonUrl(input.client.jwks_uri)) {
        throw new Error("JWKS URI is invalid");
      }
      if (input.client.token_endpoint_auth_signing_alg !== "RS256") {
        throw new Error("private_key_jwt client metadata is incomplete");
      }

      const parts = input.clientAssertion.split(".");
      if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
        throw new Error("client assertion is malformed");
      }
      const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
      const header = decodeJsonPart(encodedHeader);
      if (
        header.alg !== "RS256" ||
        typeof header.kid !== "string" ||
        header.kid.length === 0 ||
        header.kid.length > MAX_KEY_ID_LENGTH
      ) {
        throw new Error("client assertion header is invalid");
      }

      let key = await jwksCache.getKey(input.client.jwks_uri, header.kid);
      const signingInput = `${encodedHeader}.${encodedPayload}`;
      if (!verifySignature(signingInput, encodedSignature, key)) {
        key = await jwksCache.getKey(input.client.jwks_uri, header.kid, true);
        if (!verifySignature(signingInput, encodedSignature, key)) {
          throw new Error("client assertion signature is invalid");
        }
      }

      const payload = decodeJsonPart(encodedPayload);
      if (
        payload.iss !== input.clientId ||
        payload.sub !== input.clientId ||
        typeof payload.aud !== "string" ||
        payload.aud !== input.tokenEndpoint ||
        typeof payload.exp !== "number" ||
        !Number.isFinite(payload.exp) ||
        typeof payload.iat !== "number" ||
        !Number.isFinite(payload.iat) ||
        typeof payload.jti !== "string" ||
        payload.jti.length === 0 ||
        payload.jti.length > MAX_JTI_LENGTH
      ) {
        throw new Error("client assertion claims are invalid");
      }

      const timestamp = Math.floor(now() / 1_000);
      if (
        payload.exp <= timestamp ||
        payload.iat > timestamp + MAX_CLOCK_SKEW_SECONDS ||
        payload.exp <= payload.iat ||
        payload.exp - payload.iat > MAX_ASSERTION_LIFETIME_SECONDS
      ) {
        throw new Error("client assertion timestamps are invalid");
      }

      sweepReplays(timestamp);
      const replayKey = `${input.clientId}\u0000${payload.jti}`;
      if (usedJtis.has(replayKey)) throw new Error("client assertion was replayed");
      if (usedJtis.size >= replayMaxEntries) {
        const oldest = usedJtis.keys().next().value as string | undefined;
        if (oldest !== undefined) usedJtis.delete(oldest);
      }
      usedJtis.set(replayKey, payload.exp);
    },
  };
}
