import "dotenv/config";
import { z } from "zod";

const httpsUrl = z.string().url().refine((value) => value.startsWith("https://"), {
  message: "OAuth URLs must use HTTPS.",
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
  LEILEI_TOY_BRIDGE_KEY: z.string().min(32).optional(),
  LEILEI_TOY_BRIDGE_USER_ID: z.string().uuid().optional(),
  NOTION_PAT: z.string().trim().min(16).optional(),
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
