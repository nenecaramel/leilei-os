import type { RequestHandler } from "express";

export function createWebApiCorsMiddleware(
  origin: string,
): RequestHandler {
  return (request, response, next) => {
    const requestOrigin = request.headers.origin;

    if (requestOrigin === origin) {
      response.header("Access-Control-Allow-Origin", origin);
    }

    response.header(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    );

    response.header(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type",
    );

    response.header(
      "Access-Control-Allow-Credentials",
      "true",
    );

    if (request.method === "OPTIONS") {
      response.sendStatus(204);
      return;
    }

    next();
  };
}