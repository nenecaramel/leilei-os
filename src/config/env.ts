import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default("0.0.0.0"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  DATABASE_URL: z.string().url().optional(),
  MCP_AUTH_TOKEN: z.string().min(16).optional(),
  MCP_USER_ID: z.string().uuid().optional(),
  MCP_SERVER_URL: z.string().url().optional(),
});

export const env = envSchema.parse(process.env);
