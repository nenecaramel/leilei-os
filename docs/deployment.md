# Leilei OS Deployment

## Current deployment

Phase 1 is deployed to Railway from the project repository using the included
multi-stage Dockerfile. Railway provides the public HTTPS address used by the
ChatGPT custom app.

No real token, database password, private domain, or other credential belongs in
this document or in the repository.

## Railway deployment flow

1. Create or select a Railway project.
2. Add a service connected to the Leilei OS repository.
3. Configure Railway to build the repository Dockerfile.
4. Add the required environment variables in Railway's variable settings.
5. Deploy the service.
6. Generate or attach a public Railway domain.
7. Confirm that `https://<public-domain>/health` returns a successful status.
8. Configure ChatGPT with `https://<public-domain>/mcp`.

Railway supplies `PORT` at runtime. The service binds to `0.0.0.0`, allowing the
platform proxy to reach the container.

## Docker build and run

Build the image from the repository root:

```bash
docker build -t leilei-os .
```

Run it locally with an environment file:

```bash
docker run --rm -p 3000:3000 --env-file .env leilei-os
```

Verify the health endpoint:

```bash
curl http://localhost:3000/health
```

The production MCP endpoint must use HTTPS. A local HTTP endpoint is suitable
only for local protocol testing and is not the URL entered into ChatGPT.

## MCP endpoint configuration

The ChatGPT custom app endpoint has this form:

```text
https://<public-domain>/mcp
```

In ChatGPT Web:

1. Enable Developer Mode for the account.
2. Create or edit the custom app.
3. Enter the public `/mcp` HTTPS endpoint.
4. Configure the authentication mode to match the server.
5. Scan or refresh tools.
6. Confirm that the expected tools appear.
7. Invoke `hello` in a new chat as a deployment smoke test.

After changing tool definitions, refresh the app's tool list before testing.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | Platform-provided | HTTP listening port. Defaults to `3000` locally. |
| `HOST` | No | Bind address. Defaults to `0.0.0.0`. |
| `LOG_LEVEL` | No | Application log level. |
| `MCP_SERVER_URL` | No | Canonical public MCP URL for documentation or future configuration. |
| `MCP_AUTH_TOKEN` | Recommended for protected data | Bearer token used by the MCP authentication middleware. |
| `DATABASE_URL` | Future database phases | PostgreSQL connection string supplied by Railway or the database provider. |
| `MCP_USER_ID` | Future single-user phase | Server-controlled user UUID associated with authenticated MCP requests. |

Rules:

- Store production values in Railway variables, not source files.
- Keep `.env` local and untracked.
- Never print authorization headers, tokens, or connection strings in logs.
- Use placeholders in examples.
- Rotate a credential if it is exposed in a terminal recording, screenshot,
  commit, issue, or chat.

## Deployment verification

After each deployment:

- confirm Railway reports a healthy running service;
- call `/health` through the public HTTPS domain;
- refresh the custom app's tools in ChatGPT when tool definitions changed;
- call `hello` and verify its structured response;
- inspect logs for errors without copying secrets into support messages.

Phase 1 is considered deployed successfully when ChatGPT can discover and call
`hello` through the Railway HTTPS MCP endpoint.
