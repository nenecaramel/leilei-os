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

export function requireOAuthConfig(environment: RuntimeEnv): AppConfig {
  return oauthEnvSchema.parse(environment);
}
