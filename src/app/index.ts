import { createApp } from "./create-app.js";
import { env } from "../config/env.js";

const app = createApp();

const httpServer = app.listen(env.PORT, env.HOST, () => {
  console.log(`Leilei OS listening on http://${env.HOST}:${env.PORT}`);
  console.log(`MCP endpoint: http://${env.HOST}:${env.PORT}/mcp`);
  if (!env.MCP_AUTH_TOKEN) {
    console.warn("MCP_AUTH_TOKEN is not set; /mcp is unauthenticated for Phase 1 testing.");
  }
});

function shutdown(signal: string): void {
  console.log(`${signal} received; shutting down.`);
  httpServer.close((error) => {
    if (error) {
      console.error("Shutdown failed", error);
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
