import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

function tokensMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function createInternalAuthMiddleware(
  expectedToken: string,
  userId: string,
): RequestHandler {
  return (request, response, next) => {
    const authorization = request.header("authorization");
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined;

    if (!token || !tokensMatch(token, expectedToken)) {
      response.status(401).json({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "A valid internal credential is required.",
        },
      });
      return;
    }

    request.mcpUserId = userId;
    next();
  };
}

