# Leilei OS

Leilei OS is a remote Model Context Protocol (MCP) server for validating the connection between ChatGPT Developer Mode and a privately operated service.

Phase 1 intentionally contains only one read-only, side-effect-free tool: `hello`. It does **not** contain memory, diary, task, OpenAI API, agent orchestration, or chat UI functionality.

## Phase 1 architecture

```text
ChatGPT Web
    ↓
Developer Mode / Custom App
    ↓ HTTPS
Remote MCP endpoint: /mcp
    ↓
hello tool
```

The production MCP transport is Streamable HTTP. Local stdio is not used.

## Requirements

- Node.js 20 or newer
- pnpm 10 or newer

## Local setup

```bash
cp .env.example .env
pnpm install
pnpm dev
```

The service starts on port `3000` by default:

- Health check: `http://localhost:3000/health`
- MCP endpoint: `http://localhost:3000/mcp`

Check the health endpoint:

```bash
curl http://localhost:3000/health
```

## Build and run

```bash
pnpm build
pnpm start
```

## Optional Phase 1 bearer token

Set a value of at least 16 characters:

```env
MCP_AUTH_TOKEN=replace-with-a-long-random-secret
```

When set, requests to `/mcp` must include:

```http
Authorization: Bearer replace-with-a-long-random-secret
```

Leave it unset only while validating connectivity in a controlled development environment. `/health` remains public and never returns secrets.

## Docker

```bash
docker build -t leilei-os .
docker run --rm -p 3000:3000 --env-file .env leilei-os
```

The hosting platform must provide a stable public HTTPS URL and forward requests to the container's `PORT`. After deployment, the MCP URL will look like:

```text
https://your-domain.example/mcp
```

Do not expose a local development server directly to the public internet without an appropriate secure tunnel or hosting platform.

## Connect from ChatGPT

Availability of Developer Mode depends on the ChatGPT account and current rollout.

1. Open ChatGPT on the web.
2. Open **Settings → Apps → Advanced settings** and enable Developer Mode if the option is present.
3. Create a custom app.
4. Enter the public HTTPS MCP endpoint, ending in `/mcp`.
5. Select the matching authentication option. For the first unauthenticated connectivity test, `MCP_AUTH_TOKEN` must be unset. If the ChatGPT setup supports a static bearer token, configure the same token there.
6. Scan the tools and confirm that `hello` appears.
7. Start a new chat with the app enabled and ask: “Call the Leilei OS hello tool.”

A successful response contains `Hello from Leilei OS!` and an ISO timestamp.

## Validation boundary

Phase 1 is complete only when all of the following are true:

- `/health` responds successfully over HTTPS.
- ChatGPT scans and displays the `hello` tool.
- ChatGPT invokes `hello` successfully.
- The response contains no private data and causes no side effects.

Do not implement Memory, Diary, or Task until this connection is proven.

## Security notes

- Never commit `.env`.
- Never log credentials or authorization headers.
- `hello` is explicitly marked read-only, non-destructive, and idempotent.
- Replace the Phase 1 token approach with OAuth/OIDC before supporting multiple users or sensitive personal data.
- Keep error messages generic at the public boundary.
