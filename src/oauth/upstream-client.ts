import type { UpstreamCodeExchange } from "./oauth-authorization-server.js";

type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function createAuth0CodeExchange(options: {
  tokenEndpoint: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}): UpstreamCodeExchange {
  const tokenEndpoint = new URL(options.tokenEndpoint);
  if (tokenEndpoint.protocol !== "https:") {
    throw new Error("OAuth upstream token endpoint must use HTTPS");
  }
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  return async (input) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(tokenEndpoint, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: input.code,
          client_id: input.clientId,
          redirect_uri: input.redirectUri,
          code_verifier: input.codeVerifier,
          resource: input.resource,
          audience: input.audience,
        }).toString(),
      });
      if (response.status !== 200) {
        throw new Error("upstream token exchange failed");
      }
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        throw new Error("upstream token response is invalid");
      }
      if (!isRecord(parsed) || typeof parsed.access_token !== "string" || parsed.access_token.length === 0) {
        throw new Error("upstream token response is invalid");
      }
      return { accessToken: parsed.access_token };
    } finally {
      clearTimeout(timeout);
    }
  };
}
