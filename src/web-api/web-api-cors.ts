import type { RequestHandler } from "express";

export function createWebApiCorsMiddleware(allowedOrigin: string): RequestHandler {
  return (request, response, next) => {
    const origin = request.header("origin");
    if (origin === allowedOrigin) {
      response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
      response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    }

    if (request.method === "OPTIONS") {
      response.sendStatus(origin === allowedOrigin ? 204 : 403);
      return;
    }

    next();
  };
}
