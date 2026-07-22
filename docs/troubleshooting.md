# Leilei OS Troubleshooting

This document records build and deployment problems encountered while bringing
the Phase 1 remote MCP server online.

## pnpm version mismatch

### Symptoms

- The local installation and Docker build use different pnpm major versions.
- pnpm reports an unexpected store location or attempts to recreate
  `node_modules`.
- A frozen lockfile install behaves differently locally and in Railway.
- Commands fail even though `pnpm-lock.yaml` exists.

### Cause

Corepack can activate a pnpm version different from the version used to create
the lockfile and `node_modules`. pnpm store formats and dependency policies can
change across major versions.

### Resolution

- Pin one pnpm version in `package.json` using `packageManager`.
- Activate that same version in every Docker stage.
- Regenerate or update the lockfile using the pinned version.
- Reinstall dependencies when an existing `node_modules` directory is linked to
  an incompatible pnpm store.
- Keep local development, CI, Docker, and Railway on the same pinned version.

Do not solve this by removing the frozen-lockfile check in production. The lock
file should remain reproducible.

## esbuild build script blocked

### Symptoms

- pnpm reports `ERR_PNPM_IGNORED_BUILDS`.
- Installation says the `esbuild` postinstall script was ignored.
- `tsx` or another build command cannot find or execute the platform-specific
  esbuild binary.

### Cause

Recent pnpm versions restrict dependency lifecycle scripts unless the package is
explicitly approved. esbuild uses a postinstall step to prepare its native
binary.

### Resolution

- Explicitly allow the `esbuild` build script in the project's pnpm workspace
  configuration.
- Ensure the workspace configuration is available before `pnpm install` runs.
- In the runtime Docker stage, preserve the same explicit dependency-build
  policy when installing production dependencies.
- Reinstall dependencies and verify that the esbuild postinstall step completes.

Only approve known dependencies that genuinely require a build script. Do not
enable all lifecycle scripts globally.

## Docker did not copy `pnpm-workspace.yaml`

### Symptoms

- Local installation succeeds but `docker build` or Railway fails.
- pnpm ignores the approved-build configuration.
- esbuild is blocked again inside the container.
- Docker reports lockfile or workspace configuration behavior that differs from
  the local project.

### Cause

The Dockerfile copied `package.json` and `pnpm-lock.yaml` before dependency
installation but omitted `pnpm-workspace.yaml`. pnpm therefore installed without
the repository's workspace-level build policy.

### Resolution

Copy all dependency metadata before running `pnpm install`:

```dockerfile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
```

Apply this in both build and runtime stages when both stages run pnpm. Keeping
the copy before the source-code layer also preserves useful Docker dependency
caching.

## Quick diagnosis sequence

When Railway or Docker fails:

1. Confirm the pnpm version printed by the failing environment.
2. Compare it with `packageManager` in `package.json`.
3. Confirm `pnpm-workspace.yaml` is copied before dependency installation.
4. Check whether the log says an esbuild build script was ignored.
5. Run the TypeScript type check and production build locally with the pinned
   pnpm version.
6. Rebuild the Docker image without changing application code.
7. After deployment, verify `/health` and call `hello` from ChatGPT.

Never paste production tokens, authorization headers, database URLs, or complete
Railway environment dumps into troubleshooting logs.
