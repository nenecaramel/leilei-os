import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type RefreshGrant = {
  clientId: string;
  subject: string;
  resource: string;
  audience: string;
  scope: string;
  upstreamToken: string;
  expiresAt: number;
};
export type RefreshTokenEnvelope = ReturnType<typeof createRefreshTokenEnvelope>;
const MAX_LENGTH = 24_000;
export function createRefreshTokenEnvelope(options: { key: string; issuer: string; now?: () => number }) {
  const key = Buffer.from(options.key, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== options.key) throw new Error("OAuth refresh key must be 32 base64url-encoded bytes");
  const aad = Buffer.from(`leileios:oauth-refresh:v1:${options.issuer}`);
  const now = options.now ?? Date.now;
  return {
    seal(grant: RefreshGrant): string {
      if (grant.expiresAt <= now()) throw new Error("OAuth refresh grant expired");
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(grant), "utf8"), cipher.final()]);
      const token = [iv, ciphertext, cipher.getAuthTag()].map(b => b.toString("base64url")).join(".");
      if (token.length > MAX_LENGTH) throw new Error("OAuth refresh grant too large");
      return token;
    },
    open(token: string): RefreshGrant {
      if (token.length > MAX_LENGTH || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(token)) throw new Error("Invalid OAuth refresh grant");
      const [iv, ciphertext, tag] = token.split(".").map(v => Buffer.from(v, "base64url"));
      if (!iv || iv.length !== 12 || !ciphertext || !tag || tag.length !== 16) throw new Error("Invalid OAuth refresh grant");
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(aad); decipher.setAuthTag(tag);
      const grant: unknown = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
      if (!grant || typeof grant !== "object" || Array.isArray(grant)) throw new Error("Invalid OAuth refresh grant");
      const g = grant as Record<string, unknown>;
      for (const field of ["clientId", "subject", "resource", "audience", "scope", "upstreamToken"]) {
        if (typeof g[field] !== "string" || !g[field]) throw new Error("Invalid OAuth refresh grant");
      }
      if (typeof g.expiresAt !== "number" || !Number.isSafeInteger(g.expiresAt) || g.expiresAt <= now()) throw new Error("OAuth refresh grant expired");
      return g as RefreshGrant;
    },
  };
}
