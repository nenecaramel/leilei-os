import type { RequestHandler } from "express";

export function optionalBearerAuth(
  expectedToken?: string,
  allowUnauthenticated = false,
): RequestHandler {
  return (request, response, next) => {
    if (allowUnauthenticated || !expectedToken) {
      next();
      return;
    }

    const authorization = request.header("authorization");
    if (authorization !== `Bearer ${expectedToken}`) {
      response.status(401).json({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "A valid bearer token is required.",
        },
      });
      return;
    }

    next();
  };
}
