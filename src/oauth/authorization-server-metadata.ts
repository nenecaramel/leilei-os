import type { RequestHandler } from "express";

export type AuthorizationServerMetadataConfig = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  requiredScope: string;
  refreshEnabled?: boolean;
};

export function createAuthorizationServerMetadataHandler(
  config: AuthorizationServerMetadataConfig,
): RequestHandler {
  return (_request, response) => {
    response.setHeader("Cache-Control", "public, max-age=300");
    response.json({
      issuer: config.issuer,
      authorization_endpoint: config.authorizationEndpoint,
      token_endpoint: config.tokenEndpoint,
      response_types_supported: ["code"],
      grant_types_supported: config.refreshEnabled ? ["authorization_code", "refresh_token"] : ["authorization_code"],
      token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: config.refreshEnabled ? [config.requiredScope, "offline_access"] : [config.requiredScope],
      authorization_response_iss_parameter_supported: true,
      client_id_metadata_document_supported: true,
    });
  };
}
