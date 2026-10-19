import type { UpstreamCodeExchange } from "./oauth-authorization-server.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type UpstreamTokenSet = { accessToken: string; expiresIn: number; refreshToken?: string };
export type UpstreamRefreshExchange = (input: { refreshToken: string; clientId: string; resource: string; audience: string }) => Promise<UpstreamTokenSet>;
export class UpstreamTokenError extends Error {
  constructor(readonly retryable: boolean, invalidResponse = false) { super(invalidResponse ? "upstream token response is invalid" : "upstream token exchange failed"); }
}
function createTokenPost(options: { tokenEndpoint: string; fetch?: FetchLike; timeoutMs?: number }) {
  const endpoint = new URL(options.tokenEndpoint);
  if (endpoint.protocol !== "https:") throw new Error("OAuth upstream token endpoint must use HTTPS");
  const fetchImpl = options.fetch ?? fetch;
  return async (body: Record<string, string>): Promise<UpstreamTokenSet> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
    try {
      const response = await fetchImpl(endpoint, { method: "POST", redirect: "error", signal: controller.signal,
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams(body).toString() });
      const readJson = async (): Promise<unknown> => {
        try {
          if (!response.body) throw new Error("empty");
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = []; let bytes = 0;
          try {
            while (true) {
              const chunk = await reader.read(); if (chunk.done) break;
              bytes += chunk.value.byteLength;
              if (bytes > 65_536) { await reader.cancel(); throw new Error("large"); }
              chunks.push(chunk.value);
            }
          } finally { reader.releaseLock(); }
          return JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch { throw new UpstreamTokenError(true, true); }
      };
      if (response.status !== 200) {
        // Only explicit invalid_grant proves the credential invalid. A transient
        // or configuration failure must not make clients discard their grant.
        if (response.status === 400) {
          const errorBody = await readJson();
          const revoked = errorBody !== null && typeof errorBody === "object" &&
            "error" in errorBody && errorBody.error === "invalid_grant";
          throw new UpstreamTokenError(!revoked);
        }
        await response.body?.cancel();
        throw new UpstreamTokenError(true);
      }
      const parsed = await readJson();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new UpstreamTokenError(true, true);
      const p = parsed as Record<string, unknown>;
      if (typeof p.access_token !== "string" || !p.access_token || typeof p.expires_in !== "number" || !Number.isSafeInteger(p.expires_in) || p.expires_in <= 0 ||
        (p.token_type !== undefined && (typeof p.token_type !== "string" || p.token_type.toLowerCase() !== "bearer")) ||
        (p.refresh_token !== undefined && (typeof p.refresh_token !== "string" || !p.refresh_token))) throw new UpstreamTokenError(true, true);
      return { accessToken: p.access_token, expiresIn: p.expires_in, ...(typeof p.refresh_token === "string" ? { refreshToken: p.refresh_token } : {}) };
    } catch (error) {
      if (error instanceof UpstreamTokenError) throw error;
      throw new UpstreamTokenError(true);
    } finally { clearTimeout(timeout); }
  };
}
export function createAuth0CodeExchange(options: Parameters<typeof createTokenPost>[0]): UpstreamCodeExchange {
  const post = createTokenPost(options);
  return input => post({ grant_type: "authorization_code", code: input.code, client_id: input.clientId,
    redirect_uri: input.redirectUri, code_verifier: input.codeVerifier, resource: input.resource, audience: input.audience });
}
export function createAuth0RefreshExchange(options: Parameters<typeof createTokenPost>[0]): UpstreamRefreshExchange {
  const post = createTokenPost(options);
  return input => post({ grant_type: "refresh_token", refresh_token: input.refreshToken, client_id: input.clientId,
    resource: input.resource, audience: input.audience });
}
