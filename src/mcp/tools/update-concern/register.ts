import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  CONCERN_LIMITS,
  NativeLiveConcernError,
  type CreateConcernInput,
  type NativeLiveConcernService,
  type NativeLiveConcernView,
  type ReleaseConcernInput,
  type UpdateConcernInput,
} from "../../../domains/bridge/concern/native-live-concern.js";
import { ActiveUserAuthorizationError } from "../../../domains/require-active-user.js";
import { joinMcpContentLines } from "../content-contract.js";
import {
  createMcpToolError,
  mcpErrorRecoveryHint,
  mcpToolErrorDetailsSchema,
} from "../error-contract.js";

const maxConsiderInMinutes = CONCERN_LIMITS.maxHorizonMs / 60_000;

const concernText = z.string().trim().min(1).max(CONCERN_LIMITS.maxTextLength);

const updateConcernInputSchema = z.object({
  action: z.enum(["create", "update", "release", "list"]).describe(
    "create: keep a new concern. update: edit or move one. release: end one that is settled or no longer worth raising. list: show this conversation's active concerns.",
  ),
  concern_id: z.string().uuid().optional().describe(
    "Concern ID; required for update and release.",
  ),
  expected_revision: z.number().int().min(1).optional().describe(
    "Revision you last saw; required for update and release. A stale revision is rejected so an old decision never overwrites a newer one.",
  ),
  content: concernText.optional().describe(
    "What you are keeping in mind, in your own words. Required for create.",
  ),
  reason: concernText.nullable().optional().describe(
    "Why it matters, for your future self. null clears it on update.",
  ),
  progress: concernText.nullable().optional().describe(
    "Update only: what has happened so far, e.g. already asked once. null clears it.",
  ),
  consider_in_minutes: z.number().int()
    .min(CONCERN_LIMITS.minConsiderInMinutes)
    .max(maxConsiderInMinutes)
    .optional()
    .describe(
      "Minutes from now until you want to reconsider it. Required for create; on update it moves the time earlier or later.",
    ),
  expires_at: z.string().datetime({ offset: true }).optional().describe(
    "ISO 8601 datetime with offset after which the concern lapses on its own; at most 7 days ahead. Required for create.",
  ),
  outcome: z.enum(["resolved", "dropped"]).optional().describe(
    "Release only: resolved when it is settled, dropped when it is no longer worth raising.",
  ),
}).strict();

const concernViewSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  reason: z.string().nullable(),
  progress: z.string().nullable(),
  consider_at: z.string(),
  expires_at: z.string(),
  status: z.enum(["active", "released", "expired"]),
  release_reason: z.enum(["resolved", "dropped"]).nullable(),
  revision: z.number().int(),
  wake_count: z.number().int(),
  max_wakes: z.number().int(),
  last_woken_at: z.string().nullable(),
}).strict();

const updateConcernOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    action: z.enum(["create", "update", "release", "list"]),
    concern: concernViewSchema.optional(),
    concerns: z.array(concernViewSchema).optional(),
    replayed: z.boolean().optional(),
  }).strict().optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

type UpdateConcernArguments = z.infer<typeof updateConcernInputSchema>;

export type UpdateConcernToolDependencies = {
  concernService: Pick<
    NativeLiveConcernService,
    "create" | "update" | "release" | "list"
  >;
  requireActiveUser: () => Promise<string>;
};

export function registerUpdateConcernTool(
  server: McpServer,
  dependencies: UpdateConcernToolDependencies,
): void {
  server.registerTool(
    "update_concern",
    {
      title: "Update concern",
      description:
        "Keep, adjust or let go of something you want to come back to in this conversation, such as asking how an interview went. "
        + "LeileiOS only times it and wakes you when it is due; you then decide to speak, postpone or release. "
        + "Short-term only; use Memory for lasting facts.",
      inputSchema: updateConcernInputSchema,
      outputSchema: updateConcernOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      let userId: string;
      try {
        userId = await dependencies.requireActiveUser();
      } catch (error) {
        if (error instanceof ActiveUserAuthorizationError) {
          return createMcpToolError(
            "AUTHENTICATION_REQUIRED",
            "Authentication is required to manage concerns.",
          );
        }
        return unavailable();
      }

      const missing = missingFields(args);
      if (missing.length > 0) {
        return createMcpToolError(
          "INVALID_INPUT",
          `${args.action} requires ${missing.join(", ")}.`,
        );
      }

      try {
        switch (args.action) {
          case "create": {
            const created = await dependencies.concernService.create({
              userId,
              content: args.content!,
              reason: args.reason ?? null,
              considerInMinutes: args.consider_in_minutes!,
              expiresAt: args.expires_at!,
            } satisfies CreateConcernInput);
            return success("create", {
              concern: created.concern,
              replayed: created.replayed,
            }, `${created.replayed ? "Already keeping" : "Keeping"} ${describe(created.concern)}`);
          }
          case "update": {
            const updated = await dependencies.concernService.update({
              userId,
              concernId: args.concern_id!,
              expectedRevision: args.expected_revision!,
              ...(args.content === undefined ? {} : { content: args.content }),
              ...(args.reason === undefined ? {} : { reason: args.reason }),
              ...(args.progress === undefined ? {} : { progress: args.progress }),
              ...(args.consider_in_minutes === undefined
                ? {} : { considerInMinutes: args.consider_in_minutes }),
              ...(args.expires_at === undefined ? {} : { expiresAt: args.expires_at }),
            } satisfies UpdateConcernInput);
            return success("update", { concern: updated }, `Updated ${describe(updated)}`);
          }
          case "release": {
            const released = await dependencies.concernService.release({
              userId,
              concernId: args.concern_id!,
              expectedRevision: args.expected_revision!,
              outcome: args.outcome!,
            } satisfies ReleaseConcernInput);
            return success(
              "release",
              { concern: released },
              `Released concern ${released.id} as ${released.release_reason}.`,
            );
          }
          case "list": {
            const listed = await dependencies.concernService.list({ userId });
            return success(
              "list",
              { concerns: listed.concerns },
              listed.concerns.length === 0
                ? "No active concerns in this conversation."
                : listed.concerns.map(describe).join("\n"),
            );
          }
        }
      } catch (error) {
        return toToolError(error);
      }
    },
  );
}

function missingFields(args: UpdateConcernArguments): string[] {
  const required: Record<UpdateConcernArguments["action"], Array<keyof UpdateConcernArguments>> = {
    create: ["content", "consider_in_minutes", "expires_at"],
    update: ["concern_id", "expected_revision"],
    release: ["concern_id", "expected_revision", "outcome"],
    list: [],
  };
  const forbidden: Partial<Record<UpdateConcernArguments["action"], Array<keyof UpdateConcernArguments>>> = {
    create: ["concern_id", "expected_revision", "progress", "outcome"],
    update: ["outcome"],
  };
  return [
    ...required[args.action].filter((field) => args[field] === undefined),
    ...(forbidden[args.action] ?? [])
      .filter((field) => args[field] !== undefined)
      .map((field) => `no ${field}`),
  ];
}

function describe(concern: NativeLiveConcernView): string {
  return `concern ${concern.id} (expected_revision=${concern.revision}, ${concern.status}): `
    + `${concern.content}; reconsider at ${concern.consider_at}; keep until ${concern.expires_at}; `
    + `woken ${concern.wake_count}/${concern.max_wakes}.`;
}

function success(
  action: UpdateConcernArguments["action"],
  data: {
    concern?: NativeLiveConcernView;
    concerns?: NativeLiveConcernView[];
    replayed?: boolean;
  },
  text: string,
) {
  return {
    content: [{ type: "text" as const, text: joinMcpContentLines([text]) }],
    structuredContent: { success: true as const, data: { action, ...data } },
  };
}

function toToolError(error: unknown) {
  if (error instanceof NativeLiveConcernError) {
    if (error.code === "STALE_REVISION") {
      return createMcpToolError(
        error.code,
        error.message,
        error.current ? `${error.message} Current: ${describe(error.current)}` : error.message,
        mcpErrorRecoveryHint({
          retryable: false,
          reason: "stale_revision",
          currentRevision: error.current?.revision ?? null,
          recommendedTool: "update_concern",
          recommendedArguments: { action: "list" },
        }),
      );
    }
    if (error.code === "CONCERN_NOT_ACTIVE") {
      return createMcpToolError(
        error.code,
        error.message,
        error.message,
        mcpErrorRecoveryHint({
          retryable: false,
          reason: "status_conflict",
          currentRevision: error.current?.revision ?? null,
        }),
      );
    }
    return createMcpToolError(error.code, error.message);
  }
  console.error(
    "update_concern failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return unavailable();
}

function unavailable() {
  return createMcpToolError(
    "INTERNAL_ERROR",
    "Concerns are temporarily unavailable.",
  );
}
