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

export function bearerTokenMatches(
  authorization: string | undefined,
  expectedToken: string,
): boolean {
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
  return token !== undefined && token.length > 0
    && tokensMatch(token, expectedToken);
}

export function createInternalAuthMiddleware(
  expectedToken: string,
  userId: string,
): RequestHandler {
  return (request, response, next) => {
    if (!bearerTokenMatches(request.header("authorization"), expectedToken)) {
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

