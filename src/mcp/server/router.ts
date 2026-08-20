import { randomUUID } from "node:crypto";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Router } from "express";
import type { Request, Response } from "express";
import {
  createMcpServer,
  createProductionActiveUserAuthorizer,
} from "./create-server.js";
import { registerProductionNotionExplicitWriteTools } from "./register-notion-explicit-writes.js";
import {
  McpSessionRegistry,
  type McpSessionNamespace,
  type McpSessionRecord,
} from "./session-registry.js";

const DIAGNOSTIC_LABEL_MAX_LENGTH = 120;

function sanitizeDiagnosticLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const sanitized = value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
  return sanitized ? sanitized.slice(0, DIAGNOSTIC_LABEL_MAX_LENGTH) : null;
}

function readInitializeDiagnosticMetadata(body: unknown): {
  protocolVersion: string | null;
  clientName: string | null;
  clientVersion: string | null;
} {
  if (!body || typeof body !== "object") {
    return { protocolVersion: null, clientName: null, clientVersion: null };
  }
  const params = (body as { params?: unknown }).params;
  if (!params || typeof params !== "object") {
    return { protocolVersion: null, clientName: null, clientVersion: null };
  }
  const clientInfo = (params as { clientInfo?: unknown }).clientInfo;
  const clientRecord = clientInfo && typeof clientInfo === "object"
    ? clientInfo as { name?: unknown; version?: unknown }
    : undefined;
  return {
    protocolVersion: sanitizeDiagnosticLabel((params as { protocolVersion?: unknown }).protocolVersion),
    clientName: sanitizeDiagnosticLabel(clientRecord?.name),
    clientVersion: sanitizeDiagnosticLabel(clientRecord?.version),
  };
}

export type McpRouterOptions = {
  namespace?: McpSessionNamespace;
  registry?: McpSessionRegistry;
  onInitialize?: () => Promise<void>;
};

export function createMcpRouter(options: McpRouterOptions = {}): Router {
  const router = Router();
  const namespace = options.namespace ?? "public";
  const registry = options.registry ?? new McpSessionRegistry();

  const sendError = (
    response: Response,
    status: number,
    code: number,
    message: string,
  ) => {
    response.status(status).json({
      jsonrpc: "2.0",
      error: { code, message },
      id: null,
    });
  };

  const readSession = (sessionId: string | undefined) =>
    sessionId ? registry.findAnyNamespace(sessionId) : null;

  const runRequest = async (
    session: McpSessionRecord,
    request: Request,
    response: Response,
    body?: unknown,
  ) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      registry.finishRequest(session);
    };
    response.once("finish", finish);
    response.once("close", finish);
    try {
      await (session.transport as StreamableHTTPServerTransport).handleRequest(
        request,
        response,
        body,
      );
    } finally {
      if (response.writableEnded) finish();
    }
  };

  router.post("/", async (request: Request, response: Response) => {
    try {
      const userId = request.mcpUserId;
      if (!userId) {
        sendError(response, 401, -32001, "Authenticated user context is missing.");
        return;
      }

      const sessionId = request.header("mcp-session-id");
      const knownSession = readSession(sessionId);

      if (knownSession && knownSession.namespace !== namespace) {
        sendError(response, 400, -32000, "Invalid or missing MCP session.");
        return;
      }

      if (knownSession && knownSession.userId !== userId) {
        sendError(response, 403, -32003, "MCP session belongs to another user.");
        return;
      }

      let activeSession = knownSession
        ? await registry.acquire(sessionId!, namespace, userId)
        : null;

      if (!activeSession && !knownSession && isInitializeRequest(request.body)) {
        registry.observeInitialize({
          namespace,
          ...readInitializeDiagnosticMetadata(request.body),
          hadUnknownSessionHeader: Boolean(sessionId),
        });
        const reservation = await registry.admit(userId, namespace);
        if (!reservation) {
          registry.observeCapacityRejected(userId, namespace);
          sendError(response, 429, -32029, "MCP session capacity exceeded.");
          return;
        }
        // Retention cleanup is best-effort and must never delay initialize.
        void options.onInitialize?.();
        let initializedRecord: McpSessionRecord | null = null;
        let transport: StreamableHTTPServerTransport | null = null;
        try {
          const activeUserAuthorization =
            createProductionActiveUserAuthorizer(userId);
          const server = createMcpServer({ activeUserAuthorization }, userId);
          registerProductionNotionExplicitWriteTools(
            server,
            userId,
            activeUserAuthorization,
          );
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (initializedSessionId) => {
              initializedRecord = registry.commit(reservation, {
                sessionId: initializedSessionId,
                server,
                transport: transport!,
                userId,
                namespace,
                inFlightCount: 1,
              });
            },
          });

          transport.onclose = () => {
            if (!reservation.committed) registry.release(reservation);
            else registry.handleTransportClose(transport!);
          };
          await server.connect(transport);
          await transport.handleRequest(request, response, request.body);
        } finally {
          if (initializedRecord) registry.finishRequest(initializedRecord);
          if (!reservation.committed) {
            registry.release(reservation);
            if (transport) await transport.close().catch(() => undefined);
          }
        }
        return;
      }

      if (!activeSession) {
        sendError(response, 400, -32000, "Invalid or missing MCP session.");
        return;
      }

      await runRequest(activeSession, request, response, request.body);
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
    const knownSession = readSession(sessionId);

    if (!knownSession || knownSession.namespace !== namespace) {
      response.status(400).send("Invalid or missing MCP session.");
      return;
    }

    if (!request.mcpUserId || knownSession.userId !== request.mcpUserId) {
      response.status(403).send("MCP session belongs to another user.");
      return;
    }

    const activeSession = await registry.acquire(sessionId!, namespace, request.mcpUserId);
    if (!activeSession) {
      response.status(400).send("Invalid or missing MCP session.");
      return;
    }
    await runRequest(activeSession, request, response);
  });

  router.delete("/", async (request: Request, response: Response) => {
    const sessionId = request.header("mcp-session-id");
    const knownSession = readSession(sessionId);

    if (!knownSession || knownSession.namespace !== namespace) {
      response.status(400).send("Invalid or missing MCP session.");
      return;
    }

    if (!request.mcpUserId || knownSession.userId !== request.mcpUserId) {
      response.status(403).send("MCP session belongs to another user.");
      return;
    }

    const activeSession = await registry.acquire(sessionId!, namespace, request.mcpUserId);
    if (!activeSession) {
      response.status(400).send("Invalid or missing MCP session.");
      return;
    }
    registry.expectClose(activeSession);
    try {
      await runRequest(activeSession, request, response);
    } finally {
      registry.clearExpectedClose(activeSession);
    }
  });

  return router;
}
