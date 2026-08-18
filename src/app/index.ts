import "dotenv/config";
import { createApp } from "./create-app.js";
import { env } from "../config/env.js";

const app = createApp();

const httpServer = app.listen(env.PORT, env.HOST, () => {
  console.log(`Leilei OS listening on http://${env.HOST}:${env.PORT}`);
  console.log("Public OAuth MCP endpoint enabled at /mcp.");
  if (env.MCP_AUTH_TOKEN) {
    console.log("Internal MCP endpoint enabled at /internal/mcp.");
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
