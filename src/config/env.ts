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
  NATIVE_LIVE_RELAY_AUTH_TOKEN: z.string().min(32).optional(),
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
  LEILEI_HEALTH_SYNC_KEY: z.string().min(32).optional(),
  LEILEI_HEALTH_SYNC_USER_ID: z.string().uuid().optional(),
  NOTION_PAT: z.string().trim().min(16).optional(),
  MCP_SESSION_IDLE_TTL_SECONDS: z.coerce.number().int().positive().default(7_200),
  MCP_SESSION_ABSOLUTE_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  MCP_SESSION_MAX_PER_USER: z.coerce.number().int().positive().default(8),
  MCP_SESSION_MAX_TOTAL: z.coerce.number().int().positive().default(32),
  MCP_IDEMPOTENCY_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  MCP_IDEMPOTENCY_CLEANUP_INTERVAL_HOURS: z.coerce.number().int().positive().default(24),
  MCP_PUBLIC_TOOL_PROFILES: z.string().optional(),
  MCP_INTERNAL_TOOL_PROFILES: z.string().optional(),
  NATIVE_LIVE_BREATH_SALIENCE_WEIGHT:
    z.coerce.number().min(0).max(1).optional(),
  NATIVE_LIVE_MIND_SEMANTIC_GROUPING_THRESHOLD:
    z.coerce.number().positive().max(1).optional(),
  NATIVE_LIVE_DRIVE_BASE_PRESSURE:
    z.coerce.number().min(0).max(1).optional(),
  NATIVE_LIVE_DRIVE_REINFORCEMENT_BOOST:
    z.coerce.number().min(0).max(1).optional(),
  NATIVE_LIVE_DRIVE_ACTIVE_THRESHOLD:
    z.coerce.number().min(0).max(1).optional(),
  NATIVE_LIVE_DRIVE_DORMANT_AFTER_SATISFIED_HOURS:
    z.coerce.number().positive().optional(),
  NATIVE_LIVE_THOUGHT_HALF_LIFE_HOURS:
    z.coerce.number().positive().optional(),
  NATIVE_LIVE_THOUGHT_BASE_STRENGTH:
    z.coerce.number().min(0).max(1).optional(),
  NATIVE_LIVE_THOUGHT_REINFORCEMENT_BOOST:
    z.coerce.number().min(0).max(1).optional(),
  NATIVE_LIVE_THOUGHT_DORMANT_BELOW_STRENGTH:
    z.coerce.number().min(0).max(1).optional(),
  NATIVE_LIVE_CURIOSITY_DORMANT_AFTER_HOURS:
    z.coerce.number().positive().optional(),
  NATIVE_LIVE_TOPIC_DORMANT_AFTER_HOURS:
    z.coerce.number().positive().optional(),
  NATIVE_LIVE_MIND_RETIREMENT_ENABLED: booleanEnv.optional(),
  NATIVE_LIVE_MIND_RETIREMENT_DRIVE_RETENTION_HOURS:
    z.coerce.number().positive().optional(),
  NATIVE_LIVE_MIND_RETIREMENT_THOUGHT_RETENTION_HOURS:
    z.coerce.number().positive().optional(),
  NATIVE_LIVE_MIND_RETIREMENT_CURIOSITY_RETENTION_HOURS:
    z.coerce.number().positive().optional(),
  NATIVE_LIVE_MIND_RETIREMENT_TOPIC_RETENTION_HOURS:
    z.coerce.number().positive().optional(),
  NATIVE_LIVE_TOPIC_RESURFACE_ENABLED: booleanEnv.optional(),
  NATIVE_LIVE_TOPIC_RESURFACE_CANDIDATE_LIMIT:
    z.coerce.number().int().positive().max(25).optional(),
  NATIVE_LIVE_MEMORY_DECAY_MEMORY_HALF_LIFE_HOURS:
    z.coerce.number().positive().optional(),
  NATIVE_LIVE_MEMORY_DECAY_FEEL_HALF_LIFE_HOURS:
    z.coerce.number().positive().optional(),
  NATIVE_LIVE_MEMORY_DECAY_FADING_THRESHOLD:
    z.coerce.number().min(0).max(1).optional(),
  NATIVE_LIVE_MEMORY_DECAY_ARCHIVE_THRESHOLD:
    z.coerce.number().min(0).max(1).optional(),
  NATIVE_LIVE_PROACTIVITY_ENABLED: booleanEnv.optional(),
  NATIVE_LIVE_PROACTIVITY_MIN_IDLE_SECONDS:
    z.coerce.number().int().positive().optional(),
  NATIVE_LIVE_PROACTIVITY_COOLDOWN_SECONDS:
    z.coerce.number().int().positive().optional(),
  NATIVE_LIVE_ATTACHMENT_BUCKET: z.string().trim().min(1).optional(),
  NATIVE_LIVE_ATTACHMENT_ENDPOINT: httpsUrl.optional(),
  NATIVE_LIVE_ATTACHMENT_ACCESS_KEY_ID: z.string().trim().min(1).optional(),
  NATIVE_LIVE_ATTACHMENT_SECRET_ACCESS_KEY: z.string().trim().min(1).optional(),
  NATIVE_LIVE_ATTACHMENT_REGION: z.string().trim().min(1).default("auto"),
  NATIVE_LIVE_ATTACHMENT_PRESIGN_TTL_SECONDS:
    z.coerce.number().int().min(60).max(3_600).default(600),
  NATIVE_LIVE_ATTACHMENT_MAX_FILE_BYTES:
    z.coerce.number().int().positive().default(20 * 1024 * 1024),
  NATIVE_LIVE_ATTACHMENT_MAX_PER_TURN:
    z.coerce.number().int().min(1).max(20).default(8),
  NATIVE_LIVE_ATTACHMENT_UNBOUND_TTL_SECONDS:
    z.coerce.number().int().min(600).default(24 * 60 * 60),
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

function urlHasOrigin(value: string, origin: string): boolean {
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}

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

function isChatGptStaticClientCandidate(client: OAuthStaticClientConfig): boolean {
  return client.client_name === "ChatGPT" || urlHasOrigin(client.client_id, CHATGPT_ORIGIN);
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

export type BreathRankingConfig = {
  salienceWeight: number;
};

export type TopicResurfaceOpportunityConfig = {
  candidateLimit: number;
};

export type MindSemanticGroupingConfig = {
  threshold: number;
  candidateLimit: number;
};

export type MindLifecycleTuningConfig = {
  drive: {
    basePressure: number;
    reinforcementBoost: number;
    activeThreshold: number;
    dormantAfterSatisfiedHours: number;
  };
  thought: {
    halfLifeHours: number;
    baseStrength: number;
    reinforcementBoost: number;
    dormantBelowStrength: number;
  };
  curiosity: {
    dormantAfterHours: number;
  };
  topic: {
    dormantAfterHours: number;
  };
};

export type MindRetirementConfig = Partial<Record<
  "drive" | "thought" | "curiosity" | "topic",
  { retentionHours: number }
>>;

export type MemoryDecayConfig = {
  halfLifeHours: {
    memory: number;
    feel: number;
  };
  fadingThreshold: number;
  archiveThreshold: number;
};

export type ProactivityWakeOpportunityConfig = {
  minIdleMs: number;
  cooldownMs: number;
};

export type NativeLiveAttachmentStorageConfig = {
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  presignTtlSeconds: number;
  maxFileBytes: number;
  maxPerTurn: number;
  unboundTtlSeconds: number;
};

export function getNativeLiveAttachmentStorageConfig(
  environment: RuntimeEnv,
): NativeLiveAttachmentStorageConfig | undefined {
  const required = [
    environment.NATIVE_LIVE_ATTACHMENT_BUCKET,
    environment.NATIVE_LIVE_ATTACHMENT_ENDPOINT,
    environment.NATIVE_LIVE_ATTACHMENT_ACCESS_KEY_ID,
    environment.NATIVE_LIVE_ATTACHMENT_SECRET_ACCESS_KEY,
  ];
  if (required.every((value) => value === undefined)) {
    return undefined;
  }
  if (required.some((value) => value === undefined)) {
    throw new Error(
      "Native Live attachment storage requires bucket, endpoint, access key id, and secret access key together.",
    );
  }
  return {
    bucket: environment.NATIVE_LIVE_ATTACHMENT_BUCKET!,
    endpoint: environment.NATIVE_LIVE_ATTACHMENT_ENDPOINT!,
    accessKeyId: environment.NATIVE_LIVE_ATTACHMENT_ACCESS_KEY_ID!,
    secretAccessKey:
      environment.NATIVE_LIVE_ATTACHMENT_SECRET_ACCESS_KEY!,
    region: environment.NATIVE_LIVE_ATTACHMENT_REGION,
    presignTtlSeconds:
      environment.NATIVE_LIVE_ATTACHMENT_PRESIGN_TTL_SECONDS,
    maxFileBytes:
      environment.NATIVE_LIVE_ATTACHMENT_MAX_FILE_BYTES,
    maxPerTurn:
      environment.NATIVE_LIVE_ATTACHMENT_MAX_PER_TURN,
    unboundTtlSeconds:
      environment.NATIVE_LIVE_ATTACHMENT_UNBOUND_TTL_SECONDS,
  };
}


export function getBreathRankingConfig(
  environment: Pick<
    RuntimeEnv,
    "NATIVE_LIVE_BREATH_SALIENCE_WEIGHT"
  >,
): BreathRankingConfig {
  const salienceWeight =
    environment.NATIVE_LIVE_BREATH_SALIENCE_WEIGHT ?? 0.1;
  if (
    !Number.isFinite(salienceWeight)
    || salienceWeight < 0
    || salienceWeight > 1
  ) {
    throw new Error(
      "NATIVE_LIVE_BREATH_SALIENCE_WEIGHT must be between 0 and 1.",
    );
  }
  return { salienceWeight };
}

export function getMindLifecycleTuningConfig(
  environment: Pick<
    RuntimeEnv,
    | "NATIVE_LIVE_DRIVE_BASE_PRESSURE"
    | "NATIVE_LIVE_DRIVE_REINFORCEMENT_BOOST"
    | "NATIVE_LIVE_DRIVE_ACTIVE_THRESHOLD"
    | "NATIVE_LIVE_DRIVE_DORMANT_AFTER_SATISFIED_HOURS"
    | "NATIVE_LIVE_THOUGHT_HALF_LIFE_HOURS"
    | "NATIVE_LIVE_THOUGHT_BASE_STRENGTH"
    | "NATIVE_LIVE_THOUGHT_REINFORCEMENT_BOOST"
    | "NATIVE_LIVE_THOUGHT_DORMANT_BELOW_STRENGTH"
    | "NATIVE_LIVE_CURIOSITY_DORMANT_AFTER_HOURS"
    | "NATIVE_LIVE_TOPIC_DORMANT_AFTER_HOURS"
  >,
): MindLifecycleTuningConfig {
  const drive = {
    basePressure: environment.NATIVE_LIVE_DRIVE_BASE_PRESSURE ?? 0.4,
    reinforcementBoost:
      environment.NATIVE_LIVE_DRIVE_REINFORCEMENT_BOOST ?? 0.2,
    activeThreshold:
      environment.NATIVE_LIVE_DRIVE_ACTIVE_THRESHOLD ?? 0.1,
    dormantAfterSatisfiedHours:
      environment.NATIVE_LIVE_DRIVE_DORMANT_AFTER_SATISFIED_HOURS ?? 168,
  };
  const thought = {
    halfLifeHours:
      environment.NATIVE_LIVE_THOUGHT_HALF_LIFE_HOURS ?? 168,
    baseStrength:
      environment.NATIVE_LIVE_THOUGHT_BASE_STRENGTH ?? 0.35,
    reinforcementBoost:
      environment.NATIVE_LIVE_THOUGHT_REINFORCEMENT_BOOST ?? 0.25,
    dormantBelowStrength:
      environment.NATIVE_LIVE_THOUGHT_DORMANT_BELOW_STRENGTH ?? 0.1,
  };
  if (drive.basePressure <= drive.activeThreshold) {
    throw new Error(
      "Drive base pressure must exceed active threshold.",
    );
  }
  if (thought.baseStrength < thought.dormantBelowStrength) {
    throw new Error(
      "Thought base strength must be at least dormant threshold.",
    );
  }
  return {
    drive,
    thought,
    curiosity: {
      dormantAfterHours:
        environment.NATIVE_LIVE_CURIOSITY_DORMANT_AFTER_HOURS ?? 168,
    },
    topic: {
      dormantAfterHours:
        environment.NATIVE_LIVE_TOPIC_DORMANT_AFTER_HOURS ?? 168,
    },
  };
}

export function getMindRetirementConfig(
  environment: Pick<
    RuntimeEnv,
    | "NATIVE_LIVE_MIND_RETIREMENT_ENABLED"
    | "NATIVE_LIVE_MIND_RETIREMENT_DRIVE_RETENTION_HOURS"
    | "NATIVE_LIVE_MIND_RETIREMENT_THOUGHT_RETENTION_HOURS"
    | "NATIVE_LIVE_MIND_RETIREMENT_CURIOSITY_RETENTION_HOURS"
    | "NATIVE_LIVE_MIND_RETIREMENT_TOPIC_RETENTION_HOURS"
  >,
): MindRetirementConfig | undefined {
  const values = {
    drive:
      environment.NATIVE_LIVE_MIND_RETIREMENT_DRIVE_RETENTION_HOURS,
    thought:
      environment.NATIVE_LIVE_MIND_RETIREMENT_THOUGHT_RETENTION_HOURS,
    curiosity:
      environment.NATIVE_LIVE_MIND_RETIREMENT_CURIOSITY_RETENTION_HOURS,
    topic:
      environment.NATIVE_LIVE_MIND_RETIREMENT_TOPIC_RETENTION_HOURS,
  };
  const configured = Object.entries(values).filter(
    (entry): entry is [
      keyof MindRetirementConfig,
      number,
    ] => entry[1] !== undefined,
  );

  if (environment.NATIVE_LIVE_MIND_RETIREMENT_ENABLED !== true) {
    if (configured.length > 0) {
      throw new Error(
        "NATIVE_LIVE_MIND_RETIREMENT_ENABLED=true is required when retirement retention is configured.",
      );
    }
    return undefined;
  }
  if (configured.length === 0) {
    throw new Error(
      "Mind retirement requires at least one positive per-kind retention.",
    );
  }

  const policy: MindRetirementConfig = {};
  for (const [kind, retentionHours] of configured) {
    if (!Number.isFinite(retentionHours) || retentionHours <= 0) {
      throw new Error(
        "Mind retirement " + kind + " retentionHours must be positive.",
      );
    }
    policy[kind] = { retentionHours };
  }
  return policy;
}

export function getMindSemanticGroupingConfig(
  environment: Pick<
    RuntimeEnv,
    "NATIVE_LIVE_MIND_SEMANTIC_GROUPING_THRESHOLD"
  >,
): MindSemanticGroupingConfig | undefined {
  const threshold =
    environment.NATIVE_LIVE_MIND_SEMANTIC_GROUPING_THRESHOLD;
  if (threshold === undefined) return undefined;
  if (
    !Number.isFinite(threshold)
    || threshold <= 0
    || threshold > 1
  ) {
    throw new Error(
      "NATIVE_LIVE_MIND_SEMANTIC_GROUPING_THRESHOLD must be greater than 0 and at most 1.",
    );
  }
  return {
    threshold,
    candidateLimit: 32,
  };
}

export function getProactivityWakeOpportunityConfig(
  environment: Pick<
    RuntimeEnv,
    | "NATIVE_LIVE_PROACTIVITY_ENABLED"
    | "NATIVE_LIVE_PROACTIVITY_MIN_IDLE_SECONDS"
    | "NATIVE_LIVE_PROACTIVITY_COOLDOWN_SECONDS"
  >,
): ProactivityWakeOpportunityConfig | undefined {
  const enabled = environment.NATIVE_LIVE_PROACTIVITY_ENABLED;
  const values = [
    environment.NATIVE_LIVE_PROACTIVITY_MIN_IDLE_SECONDS,
    environment.NATIVE_LIVE_PROACTIVITY_COOLDOWN_SECONDS,
  ];

  if (enabled !== true) {
    if (values.some((value) => value !== undefined)) {
      throw new Error(
        "NATIVE_LIVE_PROACTIVITY_ENABLED=true is required when Proactivity policy values are configured.",
      );
    }
    return undefined;
  }

  if (values.some((value) => value === undefined)) {
    throw new Error(
      "NATIVE_LIVE_PROACTIVITY_MIN_IDLE_SECONDS and NATIVE_LIVE_PROACTIVITY_COOLDOWN_SECONDS are required when Proactivity is enabled.",
    );
  }

  return {
    minIdleMs:
      environment.NATIVE_LIVE_PROACTIVITY_MIN_IDLE_SECONDS! * 1_000,
    cooldownMs:
      environment.NATIVE_LIVE_PROACTIVITY_COOLDOWN_SECONDS! * 1_000,
  };
}

export function getMemoryDecayConfig(
  environment: Pick<
    RuntimeEnv,
    | "NATIVE_LIVE_MEMORY_DECAY_MEMORY_HALF_LIFE_HOURS"
    | "NATIVE_LIVE_MEMORY_DECAY_FEEL_HALF_LIFE_HOURS"
    | "NATIVE_LIVE_MEMORY_DECAY_FADING_THRESHOLD"
    | "NATIVE_LIVE_MEMORY_DECAY_ARCHIVE_THRESHOLD"
  >,
): MemoryDecayConfig | undefined {
  const values = [
    environment.NATIVE_LIVE_MEMORY_DECAY_MEMORY_HALF_LIFE_HOURS,
    environment.NATIVE_LIVE_MEMORY_DECAY_FEEL_HALF_LIFE_HOURS,
    environment.NATIVE_LIVE_MEMORY_DECAY_FADING_THRESHOLD,
    environment.NATIVE_LIVE_MEMORY_DECAY_ARCHIVE_THRESHOLD,
  ];
  if (values.every((value) => value === undefined)) {
    return undefined;
  }
  if (values.some((value) => value === undefined)) {
    throw new Error(
      "All NATIVE_LIVE_MEMORY_DECAY_* settings must be configured together.",
    );
  }

  const fadingThreshold =
    environment.NATIVE_LIVE_MEMORY_DECAY_FADING_THRESHOLD!;
  const archiveThreshold =
    environment.NATIVE_LIVE_MEMORY_DECAY_ARCHIVE_THRESHOLD!;
  if (archiveThreshold >= fadingThreshold) {
    throw new Error(
      "Memory decay thresholds must satisfy archive < fading.",
    );
  }

  return {
    halfLifeHours: {
      memory:
        environment.NATIVE_LIVE_MEMORY_DECAY_MEMORY_HALF_LIFE_HOURS!,
      feel:
        environment.NATIVE_LIVE_MEMORY_DECAY_FEEL_HALF_LIFE_HOURS!,
    },
    fadingThreshold,
    archiveThreshold,
  };
}

export function getTopicResurfaceOpportunityConfig(
  environment: Pick<
    RuntimeEnv,
    | "NATIVE_LIVE_TOPIC_RESURFACE_ENABLED"
    | "NATIVE_LIVE_TOPIC_RESURFACE_CANDIDATE_LIMIT"
  >,
): TopicResurfaceOpportunityConfig | undefined {
  const enabled =
    environment.NATIVE_LIVE_TOPIC_RESURFACE_ENABLED === true;
  const limit =
    environment.NATIVE_LIVE_TOPIC_RESURFACE_CANDIDATE_LIMIT;

  if (!enabled) {
    if (limit !== undefined) {
      throw new Error(
        "NATIVE_LIVE_TOPIC_RESURFACE_CANDIDATE_LIMIT requires NATIVE_LIVE_TOPIC_RESURFACE_ENABLED=true.",
      );
    }
    return undefined;
  }

  return {
    candidateLimit: limit ?? 5,
  };
}

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

  const chatGptStaticClients = staticClients.filter(isChatGptStaticClientCandidate);
  if (
    chatGptStaticClients.length === 0 ||
    chatGptStaticClients.some((client) => !isTrustedChatGptStaticClient(client))
  ) {
    throw new Error(
      "OAUTH_STATIC_CLIENTS_JSON must include at least one trusted ChatGPT private_key_jwt static client and no untrusted ChatGPT entries before enabling OAUTH_AS_ENABLED.",
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
