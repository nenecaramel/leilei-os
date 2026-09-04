import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import type { OAuthStaticClientConfig } from "../../src/config/env.js";

export const CHATGPT_CLIENT_ID = "https://chatgpt.com/oauth/DC6KIBaz_41D/client.json";
export const CHATGPT_REDIRECT_URI = "https://chatgpt.com/connector/oauth/DC6KIBaz_41D";
export const CHATGPT_JWKS_URI = "https://chatgpt.com/oauth/jwks.json";
export const CHATGPT_TOKEN_ENDPOINT = "https://mcp.example.test/oauth/token";

const chatgptKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const wrongKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });

function publicJwk(publicKey: KeyObject, kid: string): Record<string, unknown> {
  return {
    ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>),
    kid,
    use: "sig",
    alg: "RS256",
  };
}

export const CHATGPT_PRIVATE_KEY = chatgptKeys.privateKey;
export const WRONG_PRIVATE_KEY = wrongKeys.privateKey;
export const CHATGPT_KID = "chatgpt-key-1";
export const CHATGPT_JWKS = {
  keys: [publicJwk(chatgptKeys.publicKey, CHATGPT_KID)],
};
export const ROTATED_CHATGPT_JWKS = {
  keys: [publicJwk(wrongKeys.publicKey, CHATGPT_KID)],
};

export const CHATGPT_CIMD_METADATA: OAuthStaticClientConfig = {
  client_id: CHATGPT_CLIENT_ID,
  client_name: "ChatGPT",
  redirect_uris: [CHATGPT_REDIRECT_URI],
  token_endpoint_auth_method: "private_key_jwt",
  token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
  token_endpoint_auth_signing_alg: "RS256",
  jwks_uri: CHATGPT_JWKS_URI,
  grant_types: ["authorization_code"],
  response_types: ["code"],
};

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function createChatGptAssertion(options: {
  now?: number;
  clientId?: string;
  issuer?: string;
  subject?: string;
  audience?: string | string[];
  expiresAt?: number;
  issuedAt?: number;
  jti?: string;
  kid?: string;
  algorithm?: string;
  signingKey?: KeyObject;
  payload?: Record<string, unknown>;
} = {}): string {
  const now = options.now ?? 1_700_000_000;
  const header = {
    alg: options.algorithm ?? "RS256",
    kid: options.kid ?? CHATGPT_KID,
    typ: "JWT",
  };
  const payload = {
    iss: options.issuer ?? options.clientId ?? CHATGPT_CLIENT_ID,
    sub: options.subject ?? options.clientId ?? CHATGPT_CLIENT_ID,
    aud: options.audience ?? CHATGPT_TOKEN_ENDPOINT,
    exp: options.expiresAt ?? now + 120,
    iat: options.issuedAt ?? now - 5,
    jti: options.jti ?? "chatgpt-assertion-1",
    ...options.payload,
  };
  const signingInput = `${encode(header)}.${encode(payload)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  return `${signingInput}.${signer.sign(options.signingKey ?? CHATGPT_PRIVATE_KEY).toString("base64url")}`;
}
