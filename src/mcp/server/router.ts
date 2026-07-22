import { randomUUID } from "node:crypto";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Router } from "express";
import type { Request, Response } from "express";
import { createMcpServer } from "./create-server.js";

type ActiveSession = {
  server: ReturnType<typeof createMcpServer>;
  transport: StreamableHTTPServerTransport;
};

const sessions = new Map<string, ActiveSession>();

export function createMcpRouter(): Router {
  const router = Router();

  router.post("/", async (request: Request, response: Response) => {
    try {
      const sessionId = request.header("mcp-session-id");
      let activeSession = sessionId ? sessions.get(sessionId) : undefined;

      if (!activeSession && isInitializeRequest(request.body)) {
        const server = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (initializedSessionId) => {
            sessions.set(initializedSessionId, { server, transport });
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            sessions.delete(transport.sessionId);
          }
        };

        await server.connect(transport);
        activeSession = { server, transport };
      }

      if (!activeSession) {
        response.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Invalid or missing MCP session.",
          },
          id: null,
        });
        return;
      }

      await activeSession.transport.handleRequest(request, response, request.body);
    } catch (error) {
      console.error("MCP request failed", error);
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error.",
          },
          id: null,
        });
      }
    }
  });

  router.get("/", async (request: Request, response: Response) => {
    const sessionId = request.header("mcp-session-id");
    const activeSession = sessionId ? sessions.get(sessionId) : undefined;

    if (!activeSession) {
      response.status(400).send("Invalid or missing MCP session.");
      return;
    }

    await activeSession.transport.handleRequest(request, response);
  });

  router.delete("/", async (request: Request, response: Response) => {
    const sessionId = request.header("mcp-session-id");
    const activeSession = sessionId ? sessions.get(sessionId) : undefined;

    if (!activeSession) {
      response.status(400).send("Invalid or missing MCP session.");
      return;
    }

    await activeSession.transport.handleRequest(request, response);
  });

  return router;
}
