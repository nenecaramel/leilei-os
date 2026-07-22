export type AuthenticatedPrincipal = {
  subject: string;
  issuer: string;
  audience: string[];
  scopes: string[];
};

declare global {
  namespace Express {
    interface Request {
      oauthPrincipal?: AuthenticatedPrincipal;
      mcpUserId?: string;
    }
  }
}

