import "dotenv/config";
import { createApp } from "./create-app.js";
import { createProcessRuntime } from "./process-runtime.js";
import { createGracefulShutdownController } from "./graceful-shutdown.js";
import { env } from "../config/env.js";
import { createShutdownObserver } from "../observability/runtime-observers.js";

const runtime = createProcessRuntime();
const app = createApp(runtime.appDependencies);

const httpServer = app.listen(env.PORT, env.HOST, () => {
  runtime.startBackgroundWork();
  runtime.logger.info("service_started");
  runtime.logger.info("mcp_public_endpoint_enabled");
  if (env.MCP_AUTH_TOKEN) {
    runtime.logger.info("mcp_internal_endpoint_enabled");
  }
});

const shutdown = createGracefulShutdownController({
  server: httpServer,
  closeMcpSessions: () => runtime.mcpSessionRegistry.shutdown(),
  stopBackgroundWork: () => runtime.stopBackgroundWork(),
  drainBackgroundWork: () => runtime.drainBackgroundWork(),
  closeDatabase: () => runtime.closeDatabase(),
  exit: (code) => process.exit(code),
  observer: createShutdownObserver(runtime.logger),
});

process.on("SIGINT", () => { void shutdown("SIGINT"); });
process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
