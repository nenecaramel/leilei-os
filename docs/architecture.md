# Leilei OS Architecture

## Purpose

Leilei OS is a remote Model Context Protocol (MCP) service that gives ChatGPT
access to explicitly defined personal capabilities. It is not a standalone chat
application and does not call the OpenAI API.

The responsibility boundary is:

- ChatGPT handles conversation, intent understanding, tool selection, and the
  final natural-language response.
- Leilei OS exposes tools, validates requests, performs operations, and returns
  structured results.

## Current Phase 1 architecture

```text
ChatGPT Web
    │
    │ Developer Mode / Custom App
    │ MCP over HTTPS
    ▼
Railway public endpoint
    │
    ▼
Docker container
    │
    ▼
TypeScript + Express service
    │
    ▼
MCP Streamable HTTP endpoint (/mcp)
    │
    ▼
hello tool
```

### Components

#### ChatGPT Developer Mode

ChatGPT is the MCP client and the user-facing interface. The custom app stores
the remote MCP endpoint configuration, discovers available tools, and invokes a
tool when the conversation requires it.

#### Remote MCP Server

Leilei OS exposes a Streamable HTTP MCP endpoint at `/mcp`. Production access is
through HTTPS. Local stdio transport is not part of the production architecture.

Phase 1 exposes only `hello`, a read-only, non-destructive, idempotent
connectivity tool.

#### TypeScript service

The service runs on Node.js and uses:

- TypeScript for application code;
- Express for HTTP routing;
- the MCP TypeScript SDK for protocol handling and tool registration;
- Zod for runtime input and environment validation.

The service also exposes `/health` for platform health checks. This route does
not return credentials or private data.

#### Docker

The multi-stage Docker build compiles TypeScript in a build image and copies the
compiled output into a smaller runtime image. The runtime process executes as
the non-root `node` user and listens on the configured `PORT`.

#### Railway

Railway builds the repository's Dockerfile, runs the resulting container, and
provides the public HTTPS domain. Railway forwards requests to the application
port supplied through its environment.

## MCP tool call flow

```text
1. User sends a message in ChatGPT.
2. ChatGPT decides whether an enabled Leilei OS tool is relevant.
3. ChatGPT sends an MCP request to the Railway HTTPS /mcp endpoint.
4. Express routes the request through authentication middleware.
5. The MCP server validates the protocol request and tool input.
6. The selected tool executes.
7. The server returns MCP text content and structuredContent.
8. ChatGPT uses the tool result in its natural-language reply.
```

ChatGPT does not receive server credentials, internal errors, or deployment
configuration through a tool result.

## Future architecture

Future phases will add capabilities behind the same MCP boundary:

```text
                    ┌─ Memory tools ── Memory service ─┐
ChatGPT ─ MCP Server├─ Diary tools ─── Diary service  ─┼─ Database
                    └─ Task tools ──── Task service   ─┘
```

### Memory

Read stable personal information, preferences, goals, and current projects.
Authorization and visibility filtering must occur on the server. ChatGPT must
not be allowed to select an arbitrary user identity.

### Diary

Create and retrieve diary entries. Write operations will require strict input
validation, idempotency, and audit records.

### Task

Create and inspect tasks using explicit timestamps and time zones. Ambiguous
natural-language dates must be resolved before persistence.

### Database

PostgreSQL will hold durable state. Domain services will sit between MCP tools
and database repositories so that tool handlers do not query the database
directly. Database credentials will be supplied only through deployment
environment variables.

## Architectural constraints

- Do not build a second chat interface.
- Do not store ChatGPT conversation history in Phase 1.
- Do not call the OpenAI API from the MCP server unless a later phase explicitly
  requires background AI processing.
- Keep tools narrow, schema-validated, and explicit about side effects.
- Preserve user isolation and apply permissions on the server, not in prompts.
- Never expose tokens, connection strings, stack traces, or private logs through
  MCP responses.
