import { Router, type Response } from "express";
import { z } from "zod";
import {
  HealthServiceError,
  type HealthService,
} from "../domains/health-v2/health-service.js";
import type { HealthDailySummary } from "../domains/health-v2/health-types.js";

const healthSyncBodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  steps: z.number().int().nonnegative(),
  menstruation_dates: z.array(
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  ).max(60),
}).strict();

export type HealthSyncApiDependencies = {
  healthSyncService?: Pick<HealthService, "syncDaily">;
  userId?: string;
};

export function createHealthSyncRouter(
  dependencies: HealthSyncApiDependencies,
): Router {
  const router = Router();

  router.post("/", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!dependencies.healthSyncService || !dependencies.userId) {
      sendError(response, 503, "HEALTH_SYNC_UNAVAILABLE", "Health sync is unavailable.");
      return;
    }

    const parsed = healthSyncBodySchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, "INVALID_HEALTH_REQUEST", "The Health sync request is invalid.");
      return;
    }

    try {
      const result = await dependencies.healthSyncService.syncDaily(
        dependencies.userId,
        parsed.data,
      );
      response.status(result.created ? 201 : 200).json({
        success: true,
        data: serializeHealthSummary(result.summary),
      });
    } catch (error) {
      if (error instanceof HealthServiceError) {
        if (error.code === "INVALID_HEALTH_INPUT") {
          sendError(response, 400, "INVALID_HEALTH_REQUEST", "The Health sync request is invalid.");
          return;
        }
        sendError(response, 503, "HEALTH_SYNC_UNAVAILABLE", "Health sync is unavailable.");
        return;
      }
      sendError(response, 500, "HEALTH_SYNC_ERROR", "Health sync could not be completed.");
    }
  });

  return router;
}

export function serializeHealthSummary(summary: HealthDailySummary) {
  return {
    date: summary.date,
    steps: summary.steps,
    menstruating: summary.menstruating,
    periodStartDate: summary.periodStartDate,
    cycleDay: summary.cycleDay,
    updatedAt: summary.updatedAt.toISOString(),
  };
}

function sendError(
  response: Response,
  status: number,
  code: string,
  message: string,
): void {
  response.status(status).json({ success: false, error: { code, message } });
}
