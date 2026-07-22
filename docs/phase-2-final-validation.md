# Phase 2 Final Validation

This runbook applies the Phase 2 schema, initializes one low-sensitivity test
user, deploys `read_memory`, and verifies the complete ChatGPT-to-PostgreSQL
path.

Never paste actual values from Railway variables into commits, screenshots, or
support messages.

## 1. Required Railway services

The Railway project must contain:

- the existing Leilei OS application service;
- a PostgreSQL service linked to the application service;
- a public HTTPS domain for the application service.

## 2. Required application variables

Confirm that the application service defines all three variables without
printing their values:

- `DATABASE_URL` — reference the linked PostgreSQL service variable;
- `MCP_AUTH_TOKEN` — a long random bearer token;
- `MCP_USER_ID` — one stable UUID for the Phase 2 user.

The `MCP_USER_ID` value used by the application and the seed command must be
identical. Do not allow a tool input to override it.

## 3. Pre-deployment checks

From the repository root:

```bash
pnpm typecheck
pnpm build
pnpm db:check
```

## 4. Apply the migration

Authenticate and link the Railway CLI to the existing project and application
service. Then run the local Drizzle migration command with Railway variables:

```bash
railway run pnpm db:migrate
```

This uses the repository's versioned SQL migration and the linked
`DATABASE_URL`. Application startup does not run migrations automatically.

## 5. Initialize the validation user and memories

Run the idempotent operational seed:

```bash
railway run pnpm db:seed:phase2
```

The seed creates or updates:

- one active user identified by `MCP_USER_ID`;
- three low-sensitivity `assistant` memories;
- one low-sensitivity `private` record used to verify visibility filtering.

Re-running the seed updates the same records rather than creating duplicates.
This script is not exposed as an MCP tool and is not a general memory-write API.

## 6. Deploy

Commit the reviewed Phase 2 files and push the deployment branch used by
Railway. Wait for the Railway deployment and health check to succeed.

Verify:

```text
https://<public-domain>/health
```

## 7. Refresh ChatGPT tools

In ChatGPT Developer Mode:

1. Open the Leilei OS custom app configuration.
2. Confirm the authentication configuration matches `MCP_AUTH_TOKEN`.
3. Refresh or rescan tools.
4. Confirm both `hello` and `read_memory` are listed.

## 8. Acceptance prompts

Run these checks with the Leilei OS app enabled:

1. Ask ChatGPT to call `hello`. It must still succeed.
2. Ask ChatGPT to call `read_memory` without filters.
3. Ask for only the `preference` category.
4. Ask for key `preferred_name`.
5. Attempt to supply `user_id`, `visibility`, or `status`. Input validation must
   reject these fields.

Expected unfiltered memory result:

- `preferred_name`;
- `response_style`;
- `phase_2_validation_goal`.

The `private_visibility_test` record must not appear.

## Completion criteria

- Railway deployment is healthy.
- ChatGPT lists `hello` and `read_memory`.
- `read_memory` returns the three PostgreSQL-backed assistant memories.
- The private test memory is absent.
- `hello` remains operational.
- No token, user ID, connection string, or internal database error appears in an
  MCP response.
