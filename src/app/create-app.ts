import express from "express";
import { optionalBearerAuth } from "../auth/bearer-auth.js";
import { env } from "../config/env.js";
import { createMcpRouter } from "../mcp/server/router.js";

export function createApp(): express.Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_request, response) => {
    response.json({
      success: true,
      data: {
        service: "leilei-os",
        status: "ok",
      },
    });
  });

  app.use("/mcp", optionalBearerAuth(env.MCP_AUTH_TOKEN), createMcpRouter());

  app.use((_request, response) => {
    response.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Route not found.",
      },
    });
  });

  return app;
}
