# Railway Pre-Deploy Migrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run checked-in Drizzle migrations automatically in Railway pre-deploy before a new production application deployment serves traffic.

**Architecture:** Add a compiled migration CLI using existing `postgres` + `drizzle-orm`, package the `drizzle/` directory in the runtime image, and configure Railway Config-as-Code with a pre-deploy command. Application startup remains unchanged.

**Tech Stack:** Node 22, TypeScript, postgres-js, Drizzle ORM, Docker, Railway Config-as-Code, Node test runner.

## Global Constraints

- Do not log `DATABASE_URL` or other secrets.
- Do not add ad-hoc SQL.
- Do not change normal app startup behavior.
- Railway migration failure must fail pre-deploy.
- Use only checked-in Drizzle migrations.

---

### Task 1: Lock the deployment contract with tests

**Files:**
- Create: `tests/railway-migration-deploy.test.ts`

**Interfaces:**
- Consumes: repository files `Dockerfile`, `railway.json`, `src/database/migrate.ts`.
- Produces: regression contract for packaged migrations and Railway pre-deploy command.

- [ ] Write a failing test that requires `railway.json` to set `deploy.preDeployCommand` to `node dist/database/migrate.js`.
- [ ] Require the Docker runtime stage to copy `drizzle/` into `/app/drizzle`.
- [ ] Require `src/database/migrate.ts` to exist and use the Drizzle postgres-js migrator.
- [ ] Run the focused test and confirm failure before implementation.

### Task 2: Add the production migration runner and deployment config

**Files:**
- Create: `src/database/migrate.ts`
- Create: `railway.json`
- Modify: `Dockerfile`

**Interfaces:**
- Consumes: `DATABASE_URL`, `drizzle/` migration files.
- Produces: executable `dist/database/migrate.js` that exits non-zero on failure.

- [ ] Implement a migration runner that rejects missing `DATABASE_URL`, creates a postgres-js client with TLS required, runs `migrate(db, { migrationsFolder: "./drizzle" })`, and always closes the client.
- [ ] Copy `drizzle/` into the Docker runtime image.
- [ ] Configure `railway.json` with Dockerfile builder and `deploy.preDeployCommand = "node dist/database/migrate.js"`.
- [ ] Run the focused test and confirm PASS.

### Task 3: Verify and release

**Files:**
- No new source files.

**Interfaces:**
- Consumes: final branch HEAD and existing CI/deployment integrations.
- Produces: production deployment with automatic migration gate.

- [ ] Run root typecheck, root build, full test suite, and database schema check through CI.
- [ ] Review the exact diff against production.
- [ ] Merge only if the final branch HEAD is unchanged and CI is green.
- [ ] Verify Railway deployment succeeds; because pre-deploy failure blocks deployment, success is evidence the migration command completed successfully.
- [ ] Verify Vercel deployment and public backend `/health`.
- [ ] Keep production Restore execute disabled if Railway deployment or health verification fails.