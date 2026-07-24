import { useAuth0 } from "@auth0/auth0-react";
import { useMemo } from "react";
import { authConfig } from "../config/auth";

export type WebApiClient = {
  request<T>(path: string, init?: RequestInit): Promise<T>;
};

export function useWebApiClient(): WebApiClient {
  const { getAccessTokenSilently } = useAuth0();

  return useMemo(() => ({
    async request<T>(path: string, init: RequestInit = {}): Promise<T> {
      if (!authConfig) throw new Error("Web API configuration is unavailable.");
      if (!path.startsWith("/")) throw new Error("Web API paths must be absolute.");

      const accessToken = await getAccessTokenSilently({
        authorizationParams: {
          audience: authConfig.audience,
          scope: authConfig.scope,
        },
      });
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${accessToken}`);
      if (init.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      const response = await fetch(`${authConfig.apiBaseUrl}${path}`, {
        ...init,
        headers,
      });
      if (!response.ok) throw new Error(`Web API request failed (${response.status}).`);
      return (await response.json()) as T;
    },
  }), [getAccessTokenSilently]);
}
