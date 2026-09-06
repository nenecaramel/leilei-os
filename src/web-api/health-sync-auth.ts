import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

export function createHealthSyncAuthMiddleware(
  configuredKey: string | undefined,
  configuredUserId: string | undefined,
): RequestHandler {
  return (request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    if (!configuredKey || !configuredUserId) {
      response.status(503).json({
        success: false,
        error: {
          code: "HEALTH_SYNC_UNAVAILABLE",
          message: "Health sync is unavailable.",
        },
      });
      return;
    }

    const suppliedKey = request.header("x-leilei-health-sync-key");
    if (!suppliedKey || !constantTimeEqual(suppliedKey, configuredKey)) {
      response.status(401).json({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Health sync authentication failed.",
        },
      });
      return;
    }

    next();
  };
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}
