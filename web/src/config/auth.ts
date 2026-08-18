export type AuthConfig = {
  domain: string;
  clientId: string;
  audience: string;
  scope: string;
  redirectUri: string;
  apiBaseUrl: string;
};

const domain = import.meta.env.VITE_AUTH0_DOMAIN?.trim() ?? "";
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID?.trim() ?? "";
const audience = import.meta.env.VITE_AUTH0_AUDIENCE?.trim() ?? "";
const scope = import.meta.env.VITE_AUTH0_SCOPE?.trim() ?? "";
const redirectUri =
  import.meta.env.VITE_AUTH0_REDIRECT_URI?.trim() || window.location.origin;
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? "";

export const authConfig: AuthConfig | null =
  domain && clientId && audience && scope && apiBaseUrl
    ? { domain, clientId, audience, scope, redirectUri, apiBaseUrl }
    : null;
