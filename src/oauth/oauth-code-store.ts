import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ResolvedClient } from "./client-registry.js";

export type PendingOAuthTransaction = {
  id: string;
  consentToken: string;
  client: ResolvedClient;
  redirectUri: string;
  state?: string;
  scope: string;
  resource: string;
  audience: string;
  codeChallenge: string;
  expiresAt: number;
  upstreamState?: string;
  upstreamVerifier?: string;
};

export type OAuthTokenMetadata = { accessTokenExpiresAt?: number; refreshToken?: string };

export type RedeemedOAuthCode = OAuthTokenMetadata & {
  accessToken: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  resource: string;
  audience: string;
};

export type OAuthCodeStore = {
  createTransaction(input: Omit<PendingOAuthTransaction, "id" | "expiresAt">): PendingOAuthTransaction;
  getTransaction(id: string): PendingOAuthTransaction | undefined;
  beginUpstream(id: string): { state: string; verifier: string };
  getTransactionByUpstreamState(state: string): PendingOAuthTransaction | undefined;
  claimTransactionByUpstreamState(state: string): PendingOAuthTransaction | undefined;
  issueCode(transaction: PendingOAuthTransaction, accessToken: string, metadata?: OAuthTokenMetadata): string;
  completeUpstream(state: string, accessToken: string): string;
  removeTransaction(id: string): PendingOAuthTransaction | undefined;
  redeemCode(input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
  }): RedeemedOAuthCode;
};

const CODE_TTL_MS = 60_000;
const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;
const MAX_PENDING_TRANSACTIONS = 1_024;
const MAX_PENDING_CODES = 1_024;

function randomOpaqueValue(): string {
  return randomBytes(32).toString("base64url");
}

export function createOAuthOpaqueToken(): string {
  return randomOpaqueValue();
}

function isExpired(expiresAt: number, now: number): boolean {
  return expiresAt <= now;
}

function matchesPkceVerifier(verifier: string, challenge: string): boolean {
  if (!VERIFIER_PATTERN.test(verifier)) return false;
  const calculated = createHash("sha256").update(verifier).digest("base64url");
  const calculatedBytes = Buffer.from(calculated);
  const expectedBytes = Buffer.from(challenge);
  return calculatedBytes.length === expectedBytes.length && timingSafeEqual(calculatedBytes, expectedBytes);
}

export function createOAuthCodeStore(options: {
  now?: () => number;
  ttlMs?: number;
  maxPendingTransactions?: number;
  maxPendingCodes?: number;
} = {}): OAuthCodeStore {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? CODE_TTL_MS;
  const maxPendingTransactions = options.maxPendingTransactions ?? MAX_PENDING_TRANSACTIONS;
  const maxPendingCodes = options.maxPendingCodes ?? MAX_PENDING_CODES;
  const transactions = new Map<string, PendingOAuthTransaction>();
  const codes = new Map<string, PendingOAuthTransaction & { accessToken: string } & OAuthTokenMetadata>();

  const sweep = (): void => {
    const timestamp = now();
    for (const [id, transaction] of transactions) {
      if (isExpired(transaction.expiresAt, timestamp)) transactions.delete(id);
    }
    for (const [code, record] of codes) {
      if (isExpired(record.expiresAt, timestamp)) codes.delete(code);
    }
  };

  const claimTransactionByUpstreamState = (
    state: string,
  ): PendingOAuthTransaction | undefined => {
    sweep();
    for (const transaction of transactions.values()) {
      if (transaction.upstreamState === state) {
        transactions.delete(transaction.id);
        return transaction;
      }
    }
    return undefined;
  };

  const issueCode = (transaction: PendingOAuthTransaction, accessToken: string, metadata: OAuthTokenMetadata = {}): string => {
    sweep();
    if (codes.size >= maxPendingCodes) {
      throw new Error("OAuth code capacity is temporarily unavailable");
    }
    const code = randomOpaqueValue();
    codes.set(code, { ...transaction, accessToken, ...metadata });
    return code;
  };

  return {
    createTransaction(input) {
      sweep();
      if (transactions.size >= maxPendingTransactions) {
        throw new Error("OAuth transaction capacity is temporarily unavailable");
      }
      const transaction: PendingOAuthTransaction = {
        ...input,
        id: randomOpaqueValue(),
        expiresAt: now() + ttlMs,
      };
      transactions.set(transaction.id, transaction);
      return transaction;
    },

    getTransaction(id) {
      sweep();
      return transactions.get(id);
    },

    beginUpstream(id) {
      sweep();
      const transaction = transactions.get(id);
      if (!transaction) throw new Error("OAuth transaction is unavailable");
      const state = randomOpaqueValue();
      const verifier = randomOpaqueValue();
      transaction.upstreamState = state;
      transaction.upstreamVerifier = verifier;
      return { state, verifier };
    },

    getTransactionByUpstreamState(state) {
      sweep();
      for (const transaction of transactions.values()) {
        if (transaction.upstreamState === state) return transaction;
      }
      return undefined;
    },

    claimTransactionByUpstreamState(state) {
      return claimTransactionByUpstreamState(state);
    },

    issueCode(transaction, accessToken, metadata) {
      return issueCode(transaction, accessToken, metadata);
    },

    completeUpstream(state, accessToken) {
      const transaction = claimTransactionByUpstreamState(state);
      if (!transaction || !transaction.upstreamVerifier) {
        throw new Error("OAuth transaction is unavailable");
      }
      return issueCode(transaction, accessToken);
    },

    removeTransaction(id) {
      sweep();
      const transaction = transactions.get(id);
      if (transaction) transactions.delete(id);
      return transaction;
    },

    redeemCode(input) {
      sweep();
      const record = codes.get(input.code);
      codes.delete(input.code);
      if (!record || isExpired(record.expiresAt, now())) {
        throw new Error("OAuth code is invalid or expired");
      }
      if (
        record.client.client_id !== input.clientId ||
        record.redirectUri !== input.redirectUri ||
        !matchesPkceVerifier(input.codeVerifier, record.codeChallenge)
      ) {
        throw new Error("OAuth code binding is invalid");
      }
      return {
        accessToken: record.accessToken,
        ...(record.accessTokenExpiresAt !== undefined ? { accessTokenExpiresAt: record.accessTokenExpiresAt } : {}),
        ...(record.refreshToken !== undefined ? { refreshToken: record.refreshToken } : {}),
        clientId: record.client.client_id,
        redirectUri: record.redirectUri,
        scope: record.scope,
        resource: record.resource,
        audience: record.audience,
      };
    },
  };
}

export function isValidPkceCodeChallenge(value: string): boolean {
  return /^[A-Za-z0-9_-]{43,128}$/u.test(value);
}

export function createPkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
