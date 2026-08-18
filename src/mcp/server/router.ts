import { randomUUID } from "node:crypto";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Router } from "express";
import type { Request, Response } from "express";
import { createMcpServer } from "./create-server.js";
import { registerProductionNotionExplicitWriteTools } from "./register-notion-explicit-writes.js";

type ActiveSession = {
  server: ReturnType<typeof createMcpServer>;
  transport: StreamableHTTPServerTransport;
  userId: string;
};

const sessions = new Map<string, ActiveSession>();

export function createMcpRouter(): Router {
  const router = Router();

  router.post("/", async (request: Request, response: Response) => {
    try {
      const userId = request.mcpUserId;
      if (!userId) {
        response.status(401).json({
          jsonrpc: "2.0",
          error: {
            code: -32001,
            message: "Authenticated user context is missing.",
          },
          id: null,
        });
        return;
      }

      const sessionId = request.header("mcp-session-id");
      let activeSession = sessionId ? sessions.get(sessionId) : undefined;

      if (activeSession && activeSession.userId !== userId) {
        response.status(403).json({
          jsonrpc: "2.0",
          error: {
            code: -32003,
            message: "MCP session belongs to another user.",
          },
          id: null,
        });
        return;
      }

      if (!activeSession && isInitializeRequest(request.body)) {
        const server = createMcpServer({}, userId);
        registerProductionNotionExplicitWriteTools(server, userId);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (initializedSessionId) => {
            sessions.set(initializedSessionId, { server, transport, userId });
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            sessions.delete(transport.sessionId);
          }
        };

        await server.connect(transport);
        activeSession = { server, transport, userId };
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

    if (!request.mcpUserId || activeSession.userId !== request.mcpUserId) {
      response.status(403).send("MCP session belongs to another user.");
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

    if (!request.mcpUserId || activeSession.userId !== request.mcpUserId) {
      response.status(403).send("MCP session belongs to another user.");
      return;
    }

    await activeSession.transport.handleRequest(request, response);
  });

  return router;
}
