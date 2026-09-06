import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import {
  HealthServiceError,
  type HealthService,
} from "../../../domains/health-v2/health-service.js";
import type { HealthDailySummary } from "../../../domains/health-v2/health-types.js";
import { getProductDate } from "../../../domains/time/current-time.js";
import {
  createMcpToolError,
  mcpToolErrorDetailsSchema,
} from "../error-contract.js";

const healthDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

const getHealthInputSchema = z.object({
  date: healthDateSchema.optional(),
  days: z.number().int().min(1).max(60).optional(),
}).strict();

const healthRecordSchema = z.object({
  date: z.string(),
  steps: z.number().int().nonnegative(),
  menstruating: z.boolean(),
  period_start_date: z.string().nullable(),
  cycle_day: z.number().int().positive().nullable(),
  updated_at: z.string().datetime(),
}).strict();

const getHealthOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    timezone: z.literal("Asia/Shanghai"),
    records: z.array(healthRecordSchema),
  }).optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export type GetHealthToolDependencies = {
  healthService: Pick<HealthService, "readDay" | "readRecent">;
  getAuthenticatedUserId: () => string;
};

export function registerGetHealthTool(
  server: McpServer,
  dependencies: GetHealthToolDependencies,
): void {
  server.registerTool(
    "get_health",
    {
      title: "Get Health summary",
      description:
        "Read the authenticated user's daily steps and menstrual-cycle summary for one exact Asia/Shanghai date or a trailing range of up to 60 days.",
      inputSchema: getHealthInputSchema,
      outputSchema: getHealthOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ date, days }) => {
      try {
        if (date !== undefined && days !== undefined) return invalidHealthRequest();

        const userId = dependencies.getAuthenticatedUserId();
        const records = date !== undefined
          ? await readExactDate(dependencies.healthService, userId, date)
          : days !== undefined
            ? await dependencies.healthService.readRecent(userId, days)
            : await readExactDate(
                dependencies.healthService,
                userId,
                getProductDate(new Date()),
              );

        return {
          content: [{ type: "text" as const, text: "Health summary retrieved." }],
          structuredContent: {
            success: true as const,
            data: {
              timezone: "Asia/Shanghai" as const,
              records: records.map(toPublicHealthRecord),
            },
          },
        };
      } catch (error) {
        return toSafeGetHealthError(error);
      }
    },
  );
}

async function readExactDate(
  healthService: GetHealthToolDependencies["healthService"],
  userId: string,
  date: string,
) {
  if (!isCurrentOrPastProductDate(date)) {
    throw new HealthServiceError("INVALID_HEALTH_INPUT");
  }
  const summary = await healthService.readDay(userId, date);
  return summary === null ? [] : [summary];
}

function isCurrentOrPastProductDate(date: string): boolean {
  try {
    const requested = Temporal.PlainDate.from(date);
    const today = Temporal.PlainDate.from(getProductDate(new Date()));
    return Temporal.PlainDate.compare(requested, today) <= 0;
  } catch {
    return false;
  }
}

function toPublicHealthRecord(summary: HealthDailySummary) {
  return {
    date: summary.date,
    steps: summary.steps,
    menstruating: summary.menstruating,
    period_start_date: summary.periodStartDate,
    cycle_day: summary.cycleDay,
    updated_at: summary.updatedAt.toISOString(),
  };
}

function invalidHealthRequest() {
  return createMcpToolError("INVALID_HEALTH_INPUT", "The health request is invalid.");
}

function toSafeGetHealthError(error: unknown) {
  if (error instanceof HealthServiceError) {
    if (error.code === "INVALID_HEALTH_INPUT") return invalidHealthRequest();
    return createMcpToolError(error.code, "Health is unavailable for the authenticated user.");
  }
  return createMcpToolError("INTERNAL_ERROR", "Health is temporarily unavailable.");
}
