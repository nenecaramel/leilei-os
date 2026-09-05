import "dotenv/config";
import { z } from "zod";

const httpsUrl = z.string().url().refine((value) => value.startsWith("https://"), {
  message: "OAuth URLs must use HTTPS.",
});

const booleanEnv = z
  .enum(["0", "1", "false", "true"])
  .transform((value) => value === "1" || value === "true");

const oauthStaticClientSchema = z.object({
  client_id: z.string().trim().min(1),
  client_name: z.string().min(1),
  redirect_uris: z.array(z.string().min(1)).min(1),
  token_endpoint_auth_method: z.enum(["none", "private_key_jwt"]).optional(),
  token_endpoint_auth_methods_supported: z.array(z.string().min(1)).min(1).optional(),
  token_endpoint_auth_signing_alg: z.string().min(1).optional(),
  jwks_uri: httpsUrl.optional(),
  grant_types: z.array(z.string().min(1)).min(1).optional(),
  response_types: z.array(z.string().min(1)).min(1).optional(),
  scope: z.string().min(1).optional(),
}).superRefine((client, context) => {
  if (client.token_endpoint_auth_method !== "private_key_jwt") return;
  if (!client.jwks_uri) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["jwks_uri"],
      message: "private_key_jwt clients require jwks_uri.",
    });
  }
  if (
    client.token_endpoint_auth_signing_alg !== undefined &&
    client.token_endpoint_auth_signing_alg !== "RS256"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["token_endpoint_auth_signing_alg"],
      message: "Only RS256 client assertion signing is supported.",
    });
  }
});

const baseEnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default("0.0.0.0"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  DATABASE_URL: z.string().url().optional(),
  MCP_AUTH_TOKEN: z.string().min(16).optional(),
  MCP_USER_ID: z.string().uuid().optional(),
  MCP_SERVER_URL: httpsUrl.optional(),
  AUTH0_ISSUER: httpsUrl.optional(),
  AUTH0_AUDIENCE: httpsUrl.optional(),
  AUTH0_JWKS_URI: httpsUrl.optional(),
  AUTH0_REQUIRED_SCOPE: z.string().trim().min(1).optional(),
  AUTH0_ALLOWED_SUBJECT: z.string().trim().min(1).optional(),
  WEB_APP_ORIGIN: httpsUrl.optional(),
  WEB_AUTH0_AUDIENCE: httpsUrl.optional(),
  WEB_AUTH0_REQUIRED_SCOPE: z.string().trim().min(1).optional(),
  OAUTH_AS_ENABLED: booleanEnv.optional(),
  OAUTH_AS_UPSTREAM_CLIENT_ID: z.string().trim().min(1).optional(),
  OAUTH_AS_UPSTREAM_REDIRECT_URI: httpsUrl.optional(),
  OAUTH_CIMD_TRUSTED_CLIENT_IDS: z.string().optional(),
  OAUTH_CIMD_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().max(30_000).optional(),
  OAUTH_STATIC_CLIENTS_JSON: z.string().optional(),
  LEILEI_TOY_BRIDGE_KEY: z.string().min(32).optional(),
  LEILEI_TOY_BRIDGE_USER_ID: z.string().uuid().optional(),
  NOTION_PAT: z.string().trim().min(16).optional(),
  BRIDGE_AMBIGUITY_ACCEPTANCE_ENABLED: booleanEnv.optional(),
  MCP_SESSION_IDLE_TTL_SECONDS: z.coerce.number().int().positive().default(7_200),
  MCP_SESSION_ABSOLUTE_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  MCP_SESSION_MAX_PER_USER: z.coerce.number().int().positive().default(8),
  MCP_SESSION_MAX_TOTAL: z.coerce.number().int().positive().default(32),
  MCP_IDEMPOTENCY_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  MCP_IDEMPOTENCY_CLEANUP_INTERVAL_HOURS: z.coerce.number().int().positive().default(24),
});

const mcpGovernanceEnvSchema = z.object({
  MCP_SESSION_IDLE_TTL_SECONDS: z.coerce.number().int().positive().default(7_200),
  MCP_SESSION_ABSOLUTE_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  MCP_SESSION_MAX_PER_USER: z.coerce.number().int().positive().default(8),
  MCP_SESSION_MAX_TOTAL: z.coerce.number().int().positive().default(32),
  MCP_IDEMPOTENCY_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  MCP_IDEMPOTENCY_CLEANUP_INTERVAL_HOURS: z.coerce.number().int().positive().default(24),
}).superRefine((value, context) => {
  if (value.MCP_SESSION_ABSOLUTE_TTL_SECONDS < value.MCP_SESSION_IDLE_TTL_SECONDS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["MCP_SESSION_ABSOLUTE_TTL_SECONDS"],
      message: "Absolute session TTL must be greater than or equal to idle TTL.",
    });
  }
  if (value.MCP_SESSION_MAX_TOTAL < value.MCP_SESSION_MAX_PER_USER) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["MCP_SESSION_MAX_TOTAL"],
      message: "Total MCP session capacity must be greater than or equal to per-user capacity.",
    });
  }
});

const webApiEnvSchema = baseEnvSchema
  .pick({
    MCP_USER_ID: true,
    AUTH0_ISSUER: true,
    AUTH0_JWKS_URI: true,
    AUTH0_ALLOWED_SUBJECT: true,
    WEB_APP_ORIGIN: true,
    WEB_AUTH0_AUDIENCE: true,
    WEB_AUTH0_REQUIRED_SCOPE: true,
  })
  .required()
  .superRefine((config, context) => {
    if (!config.AUTH0_ISSUER.endsWith("/")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH0_ISSUER"],
        message: "AUTH0_ISSUER must end with a slash.",
      });
    }
  });

const oauthEnvSchema = baseEnvSchema
  .extend({
    MCP_USER_ID: z.string().uuid(),
    MCP_SERVER_URL: httpsUrl,
    AUTH0_ISSUER: httpsUrl,
    AUTH0_AUDIENCE: httpsUrl,
    AUTH0_JWKS_URI: httpsUrl,
    AUTH0_REQUIRED_SCOPE: z.string().trim().min(1),
    AUTH0_ALLOWED_SUBJECT: z.string().trim().min(1),
    BRIDGE_AMBIGUITY_ACCEPTANCE_ENABLED: z.boolean().optional(),
    OAUTH_AS_ENABLED: z.boolean().optional(),
  })
  .superRefine((config, context) => {
    const resourceUrl = new URL("/mcp", config.MCP_SERVER_URL).toString();
    if (config.AUTH0_AUDIENCE !== resourceUrl) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH0_AUDIENCE"],
        message: `AUTH0_AUDIENCE must equal the public MCP resource URL (${resourceUrl}).`,
      });
    }

    if (!config.AUTH0_ISSUER.endsWith("/")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH0_ISSUER"],
        message: "AUTH0_ISSUER must end with a slash.",
      });
    }
  });

export const env = baseEnvSchema.parse(process.env);
export type RuntimeEnv = z.infer<typeof baseEnvSchema>;
export type AppConfig = z.infer<typeof oauthEnvSchema>;
export type WebApiConfig = z.infer<typeof webApiEnvSchema>;

export type OAuthStaticClientConfig = z.infer<typeof oauthStaticClientSchema>;

export type OAuthAuthorizationServerConfig = {
  trustedClientMetadataUrls: readonly string[];
  staticClients: readonly OAuthStaticClientConfig[];
  fetchTimeoutMs: number;
  upstreamClientId: string;
  upstreamRedirectUri: string;
};

const DEFAULT_CIMD_TRUSTED_CLIENT_IDS = [
  "https://claude.ai/oauth/mcp-oauth-client-metadata",
] as const;

const CHATGPT_ORIGIN = "https://chatgpt.com";
const REQUIRED_CHATGPT_JWKS_URI = "https://chatgpt.com/oauth/jwks.json";

function isTrustedChatGptClientId(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.origin === CHATGPT_ORIGIN &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    /^\/oauth\/(?:[^/]+\/)?client\.json$/u.test(url.pathname)
  );
}

function isTrustedChatGptRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.origin === CHATGPT_ORIGIN &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    (
      url.pathname === "/connector_platform_oauth_redirect" ||
      /^\/connector\/oauth\/[^/]+$/u.test(url.pathname)
    )
  );
}

function isTrustedChatGptStaticClient(client: OAuthStaticClientConfig): boolean {
  return (
    client.client_name === "ChatGPT" &&
    isTrustedChatGptClientId(client.client_id) &&
    client.redirect_uris.length > 0 &&
    client.redirect_uris.every(isTrustedChatGptRedirectUri) &&
    client.token_endpoint_auth_method === "private_key_jwt" &&
    client.token_endpoint_auth_signing_alg === "RS256" &&
    client.jwks_uri === REQUIRED_CHATGPT_JWKS_URI
  );
}

export type McpGovernanceConfig = {
  idleTtlSeconds: number;
  absoluteTtlSeconds: number;
  maxPerUser: number;
  maxTotal: number;
  idempotencyRetentionDays: number;
  idempotencyCleanupIntervalHours: number;
};

export function getMcpGovernanceConfig(
  values: Partial<Record<
    | "MCP_SESSION_IDLE_TTL_SECONDS"
    | "MCP_SESSION_ABSOLUTE_TTL_SECONDS"
    | "MCP_SESSION_MAX_PER_USER"
    | "MCP_SESSION_MAX_TOTAL"
    | "MCP_IDEMPOTENCY_RETENTION_DAYS"
    | "MCP_IDEMPOTENCY_CLEANUP_INTERVAL_HOURS",
    string | number | undefined
  >>,
): McpGovernanceConfig {
  const parsed = mcpGovernanceEnvSchema.parse(values);
  return {
    idleTtlSeconds: parsed.MCP_SESSION_IDLE_TTL_SECONDS,
    absoluteTtlSeconds: parsed.MCP_SESSION_ABSOLUTE_TTL_SECONDS,
    maxPerUser: parsed.MCP_SESSION_MAX_PER_USER,
    maxTotal: parsed.MCP_SESSION_MAX_TOTAL,
    idempotencyRetentionDays: parsed.MCP_IDEMPOTENCY_RETENTION_DAYS,
    idempotencyCleanupIntervalHours: parsed.MCP_IDEMPOTENCY_CLEANUP_INTERVAL_HOURS,
  };
}

export function requireOAuthConfig(environment: RuntimeEnv): AppConfig {
  return oauthEnvSchema.parse(environment);
}

export function getOAuthAuthorizationServerConfig(
  environment: RuntimeEnv,
): OAuthAuthorizationServerConfig | undefined {
  if (environment.OAUTH_AS_ENABLED !== true) return undefined;

  const upstreamClientId = environment.OAUTH_AS_UPSTREAM_CLIENT_ID;
  const upstreamRedirectUri = environment.OAUTH_AS_UPSTREAM_REDIRECT_URI;
  if (!upstreamClientId || !upstreamRedirectUri) {
    throw new Error(
      "OAUTH_AS_UPSTREAM_CLIENT_ID and OAUTH_AS_UPSTREAM_REDIRECT_URI are required when OAUTH_AS_ENABLED is true.",
    );
  }

  const trustedClientMetadataUrls = environment.OAUTH_CIMD_TRUSTED_CLIENT_IDS === undefined
    ? [...DEFAULT_CIMD_TRUSTED_CLIENT_IDS]
    : environment.OAUTH_CIMD_TRUSTED_CLIENT_IDS
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

  let staticClients: OAuthStaticClientConfig[] = [];
  if (environment.OAUTH_STATIC_CLIENTS_JSON !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(environment.OAUTH_STATIC_CLIENTS_JSON);
    } catch {
      throw new Error("OAUTH_STATIC_CLIENTS_JSON must be valid JSON.");
    }
    const result = z.array(oauthStaticClientSchema).safeParse(parsed);
    if (!result.success) {
      throw new Error("OAUTH_STATIC_CLIENTS_JSON contains an invalid static client registry.");
    }
    staticClients = result.data;
  }
  if (!staticClients.some(isTrustedChatGptStaticClient)) {
    throw new Error(
      "OAUTH_STATIC_CLIENTS_JSON must include a trusted ChatGPT private_key_jwt static client before enabling OAUTH_AS_ENABLED.",
    );
  }

  return {
    trustedClientMetadataUrls,
    staticClients,
    fetchTimeoutMs: environment.OAUTH_CIMD_FETCH_TIMEOUT_MS ?? 5_000,
    upstreamClientId,
    upstreamRedirectUri,
  };
}

export function getWebApiConfig(
  environment: RuntimeEnv,
): WebApiConfig | undefined {
  const values = [
    environment.WEB_APP_ORIGIN,
    environment.WEB_AUTH0_AUDIENCE,
    environment.WEB_AUTH0_REQUIRED_SCOPE,
  ];

  if (values.every((value) => value === undefined)) return undefined;
  return webApiEnvSchema.parse(environment);
}
