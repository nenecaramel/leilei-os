import type { RequestHandler } from "express";

const ALLOWED_METHODS =
  "GET,POST,PATCH,PUT,DELETE,OPTIONS";

const ALLOWED_HEADERS =
  "Authorization,Content-Type";

export function createWebApiCorsMiddleware(
  origin: string,
): RequestHandler {
  return (request, response, next) => {
    const requestOrigin = request.header("Origin");

    if (!requestOrigin) {
      next();
      return;
    }

    if (requestOrigin !== origin) {
      response.status(403).json({
        success: false,
        error: {
          code: "CORS_ORIGIN_DENIED",
          message: "Origin is not allowed.",
        },
      });
      return;
    }

    response.setHeader(
      "Access-Control-Allow-Origin",
      origin,
    );
    response.setHeader("Vary", "Origin");
    response.setHeader(
      "Access-Control-Allow-Credentials",
      "true",
    );
    response.setHeader(
      "Access-Control-Allow-Methods",
      ALLOWED_METHODS,
    );
    response.setHeader(
      "Access-Control-Allow-Headers",
      ALLOWED_HEADERS,
    );

    if (request.method === "OPTIONS") {
      response.sendStatus(204);
      return;
    }

    next();
  };
}
