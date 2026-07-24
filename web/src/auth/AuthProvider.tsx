import { Auth0Provider } from "@auth0/auth0-react";
import type { PropsWithChildren } from "react";
import { authConfig } from "../config/auth";
import { ConfigurationRequired } from "./ConfigurationRequired";

export function AppAuthProvider({ children }: PropsWithChildren) {
  if (!authConfig) {
    return <ConfigurationRequired />;
  }

  return (
    <Auth0Provider
      domain={authConfig.domain}
      clientId={authConfig.clientId}
      authorizationParams={{
        redirect_uri: authConfig.redirectUri,
        audience: authConfig.audience,
        scope: `openid profile email ${authConfig.scope}`,
      }}
      cacheLocation="memory"
    >
      {children}
    </Auth0Provider>
  );
}
