import type { WebApiConfig } from "../config/env.js";
import type { AuthenticatedPrincipal } from "../auth/auth-types.js";
import { AccessTokenError } from "../auth/jwt-verifier.js";

export function mapWebPrincipalToUserId(
  config: WebApiConfig,
  principal: AuthenticatedPrincipal,
): string {
  if (principal.subject !== config.AUTH0_ALLOWED_SUBJECT) {
    throw new AccessTokenError(
      "The token subject is not authorized.",
      "invalid_token",
    );
  }

  return config.MCP_USER_ID;
}
