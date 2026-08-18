import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

export function createToyBridgeAuthMiddleware(
  configuredKey: string | undefined,
): RequestHandler {
  return (request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    if (!configuredKey) {
      response.status(503).json({
        success: false,
        error: {
          code: "TOY_UNAVAILABLE",
          message: "Toy command queue is unavailable.",
        },
      });
      return;
    }

    const suppliedKey = request.header("x-leilei-bridge-key");
    if (!suppliedKey || !constantTimeEqual(suppliedKey, configuredKey)) {
      response.status(401).json({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Bridge authentication failed.",
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
