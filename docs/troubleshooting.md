# Leilei OS Troubleshooting

This document covers recurring build, deployment, and MCP Apps problems in the current repository. It is not a phase-specific acceptance checklist.

## pnpm version mismatch

### Symptoms

- Local installation and Docker use different pnpm major versions.
- pnpm reports an unexpected store location or attempts to recreate `node_modules`.
- A frozen-lockfile install behaves differently locally and in CI/Railway.

### Resolution

- Use the version pinned in `package.json` (`pnpm@11.9.0`).
- Keep local development, CI, Docker, and Railway on the same pinned version.
- Reinstall dependencies when an existing `node_modules` directory belongs to an incompatible store/version.
- Do not disable frozen-lockfile checks to work around a version mismatch.

## esbuild lifecycle script blocked

### Symptoms

- pnpm reports an ignored build/lifecycle script.
- `tsx`, esbuild, or the Note Card bundle step cannot execute the platform-specific binary.

### Resolution

- Keep the repository's explicit esbuild build-script policy in `pnpm-workspace.yaml`/runtime configuration.
- Ensure `pnpm-workspace.yaml` is present before dependency installation in Docker.
- Reinstall with the pinned pnpm version and verify `pnpm build` completes.

## Docker dependency metadata mismatch

The Docker build must copy all dependency metadata before `pnpm install`:

```dockerfile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
```

The build stage must include `scripts/build-mcp-browser.mjs` before `pnpm build`; it produces the Note Card browser bundle.

If local build succeeds but Docker/Railway fails, compare the Docker dependency/build inputs with the root scripts before changing application code.

## Note Card renders stale UI

1. Confirm `pnpm build` regenerated the browser bundle.
2. Confirm the deployed server runs the intended commit SHA.
3. Reconnect the MCP client so it rediscovers resources.
4. For a material UI change, use a new resource URI.

## MCP tool schema is unexpectedly empty

For tools whose public schema must expose named fields, verify that the registered input schema remains representable by the MCP SDK's `tools/list` conversion.

`read_notion_page` intentionally registers a plain strict object with optional `page_id` and `page_url`; the exactly-one-reference rule is enforced inside the handler. If its surfaced schema regresses, test the actual `tools/list` result rather than relying only on TypeScript/Zod types.

## Migration head disagreement

The checked-in migration source of truth is:

```text
drizzle/meta/_journal.json
```

Do not copy a migration-head value from an old plan, milestone, or runbook. Read the final journal entry directly; current documentation intentionally does not duplicate the head value.

## Railway deployment does not start immediately

A merge to `main` and a Railway deployment are separate events. If Railway has not created a deployment yet:

1. Confirm GitHub `main` contains the intended merge SHA.
2. Confirm Railway is still configured to source the `main` branch.
3. Inspect Railway deployment history before manually redeploying.
4. Respect any platform account/region deployment restrictions; a blocked trigger is not an application build failure.

Never report a change as production-live until Railway reports the expected commit and the service health check succeeds.

## Quick diagnosis sequence

When root Docker/Railway or MCP Apps behavior fails:

1. Identify the exact Git commit being tested/deployed.
2. Confirm the pinned pnpm version and dependency metadata.
3. Run `pnpm typecheck` and `pnpm build`.
4. Run the focused failing test before the full suite.
5. For Note Card issues, verify the resource URI and generated browser bundle.
6. For schema issues, inspect the actual MCP `tools/list` surface.
7. After deployment, verify `/health` and the authenticated MCP handshake.

Never paste production tokens, authorization headers, database URLs, bridge keys, or complete Railway environment dumps into troubleshooting logs.
