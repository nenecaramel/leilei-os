import "dotenv/config";
import { createApp } from "./create-app.js";
import { createProcessRuntime } from "./process-runtime.js";
import { createGracefulShutdownController } from "./graceful-shutdown.js";
import { env } from "../config/env.js";

const runtime = createProcessRuntime();
const app = createApp(runtime.appDependencies);

const httpServer = app.listen(env.PORT, env.HOST, () => {
  console.log(`Leilei OS listening on http://${env.HOST}:${env.PORT}`);
  console.log("Public OAuth MCP endpoint enabled at /mcp.");
  if (env.MCP_AUTH_TOKEN) {
    console.log("Internal MCP endpoint enabled at /internal/mcp.");
  }
});

const shutdown = createGracefulShutdownController({
  server: httpServer,
  closeMcpSessions: () => runtime.mcpSessionRegistry.shutdown(),
  drainBackgroundWork: () => runtime.drainBackgroundWork(),
  closeDatabase: () => runtime.closeDatabase(),
  exit: (code) => process.exit(code),
  logInfo: (message) => console.info(message),
  logError: (message) => console.error(message),
});

process.on("SIGINT", () => { void shutdown("SIGINT"); });
process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
