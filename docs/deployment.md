# Leilei OS Deployment

This document describes the current `main`-based release path. It intentionally contains no credentials, connection strings, tokens, or private deployment URLs.

## Source of truth

- GitHub default branch: `main`.
- `main` is the only integration and release trunk.
- Railway Production watches `main` for the root API/MCP service.
- Vercel Production watches `main` for the Web SPA under `web/`.

A repository merge and a successful production deployment are separate facts. Always verify the platform-reported release SHA before treating a change as live.

## Railway API/MCP deployment

Railway builds the repository root `Dockerfile`. The build stage installs the pinned pnpm version, compiles TypeScript, and runs both MCP Apps browser bundle steps (Message Bridge and Thinking Block) through `pnpm build`. The runtime container starts:

```text
node dist/app/index.js
```

Before application promotion, the pre-deploy command in `.railway/railway.ts` runs:

```text
node dist/database/migrate.js
```

The pre-deploy runner performs database-readiness checks and applies pending checked-in migrations transactionally through the LeileiOS migration ledger. Application startup itself does not run migrations.

The authoritative checked-in migration record is `drizzle/meta/_journal.json`. Read its final entry when verifying the current migration head instead of duplicating that value in release documentation.

A successful deployment must report a healthy service before production smoke checks continue.

## Message Bridge release behavior

The current Message Bridge MCP Apps resource URI is:

```text
ui://leileios/message-bridge/v5
```

The resource uses a committed/generated browser bundle built from `src/mcp/tools/bridge-listener/browser-runtime.ts` by the unified `scripts/build-mcp-browser.mjs` step.

The Bridge listener remains manually started from its UI. Deploying a new server build must not be interpreted as automatically activating the listener in a host session.

For material Message Bridge UI/runtime changes, advance the resource URI so hosts can fetch a new resource identity instead of relying on cache invalidation of an existing URI.

After an MCP surface or resource change reaches production, refresh/reconnect the relevant MCP client only as a discovery/cache step; that action is not evidence that the server deployment itself succeeded.

## Thinking Block release behavior

The current canonical standard MCP Apps resource URI is:

```text
ui://widget/leileios-thinking-block-v3.html
```

ChatGPT's `openai/outputTemplate` compatibility pointer uses:

```text
ui://widget/leileios-thinking-block-chatgpt-v3.html
```

Both identifiers serve the same current HTML and generated browser runtime. The older v2 and v1 identifiers remain legacy aliases only; they do not restore a previous browser client. The committed/generated bundle is built from `src/mcp/tools/render-thinking-block/browser-runtime.ts` by the unified `scripts/build-mcp-browser.mjs` step.

Material standard MCP Apps UI/runtime changes should advance the canonical resource URI rather than relying on hosts to invalidate an existing resource. Any ChatGPT compatibility pointer change must be treated separately and verified on ChatGPT Web/Mobile without regressing other MCP Apps hosts.

## Vercel Web deployment

The Vercel project builds from the `web/` directory using:

```text
npm run build
```

The output directory is `web/dist`. `web/vercel.json` rewrites application routes to `index.html` so authenticated SPA routes can be refreshed directly. The Production Branch is `main`.

After deployment, verify the public homepage, `manifest.webmanifest`, and `sw.js` before authenticated Web checks. Auth0 callback, logout, and Web origin allowlists must contain the deployed Web origin.

## Local verification before release

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm db:check
```

For the Web package:

```bash
cd web
npm ci
npm run typecheck
npm run build
```

Use only a disposable/local PostgreSQL instance for migration integration tests. The manual Drizzle command is:

```bash
pnpm db:migrate
```

That command is separate from Railway's compiled pre-deploy runner. Never point either path at production without an approved backup and release procedure.

If a local environment prevents a verification command from actually executing, record that as an environment limitation rather than reporting the gate as passed.

## Production verification

After a successful `main` deployment:

1. Confirm Railway reports the expected `main` commit SHA.
2. Confirm the Railway service is healthy and call `/health` through the public HTTPS endpoint.
3. Confirm MCP protected-resource metadata and the authenticated `/mcp` handshake.
4. If MCP definitions/resources changed, refresh the client tool/resource discovery and run only the approved smoke checks.
5. Confirm Vercel reports the expected Web commit and verify representative routes/PWA assets when Web files changed.
6. Record the accepted release SHA and verification result separately from the pull-request merge record.

Never paste environment values, authorization headers, database URLs, or raw provider secrets into Git, logs, tickets, or screenshots.

## Optional CIMD authorization adapter

The repository contains an optional Auth0-backed local authorization adapter. Repository support for the adapter does not imply that it is enabled in production.

When enabled, configuration includes `OAUTH_AS_ENABLED=true`, an Auth0 public PKCE client id, the configured upstream redirect URI, and a nonempty static-client registry for existing clients. Dynamic CIMD metadata resolution is restricted to configured trusted client metadata URLs and uses the bounded HTTPS fetch path.

Static client authentication metadata must match the registered record exactly. The adapter preserves Auth0 as the identity/token issuer and does not replace the existing `/mcp` JWT verifier.

Any change to production authorization discovery or client registration requires a controlled deployment and explicit verification of metadata, consent, callback, token exchange, and existing client connectivity.

### Connector automatic renewal

`OAUTH_REFRESH_TOKEN_KEY` opts the adapter into `refresh_token` / `offline_access`.
Use a dedicated random 32-byte base64url key, identical across replicas and
redeploys. Store it as a secret; do not reuse an internal/relay credential, log
it, or generate a new key on startup. Without the key the adapter retains its
existing authorization-code-only behavior. Changing the key or issuer URL
invalidates existing connector refresh envelopes and requires authorization again.

Before enabling it, verify the specific upstream Auth0 public PKCE application
allows the refresh-token grant, the target API allows offline access, and Auth0
refresh-token rotation/reuse detection is enabled. Do not disable expiration or
rotation to make a smoke test pass. Preserve other application grants, callbacks,
clients and permissions. Downstream clients must declare `refresh_token`; an
explicit client scope allowlist must also permit `offline_access` to request it.

Refresh credentials are AES-256-GCM envelopes bound to the client, subject,
resource, audience and granted scope. Their absolute lifetime is 30 days from
initial consent, never extended by refreshing; Auth0 can expire/revoke the
upstream credential sooner. Auth0 owns rotation and replay/revocation decisions,
including its configured reuse interval. The adapter does not add an independent
refresh database or process-local grant registry. Token response `expires_in`
uses upstream validity with time consumed in exchange/verification/code redemption
deducted, rather than a fixed hour. Authorization response bodies remain no-store;
upstream token JSON is bounded to 64KiB and token requests to 64KiB.

All refresh requests repeat registered-client authentication, binding checks and
new access-token verification. Unknown/tampered/expired grants and explicit
upstream revocation fail closed. Trusted metadata/JWKS outages and upstream
network/rate/configuration failures return 503 `temporarily_unavailable`, without
credentials or private error details. There is no automatic upstream refresh
retry: a response lost after Auth0 rotates is ambiguous, and recovery depends on
Auth0's reuse interval; it can still require reauthorization. This is not a
promise that every interruption can be recovered invisibly.

After deployment, verify the exact SHA, readiness and advertised grants/scopes.
Existing access-only authorizations cannot acquire refresh credentials magically:
reconnect once to grant offline access. Then verify a real refresh after access
expiry and an authenticated MCP call, without printing tokens or invoking tools
that mutate product data. Local mocked HTTP tests do not prove the live Auth0
configuration or claude.ai renewal policy.
