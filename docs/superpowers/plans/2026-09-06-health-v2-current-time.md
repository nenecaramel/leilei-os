# Health v2 + Current Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a privacy-minimal Apple Health daily sync for steps + menstrual/cycle context, expose it read-only to ChatGPT/Claude through `get_health`, and add a read-only `get_current_time` tool fixed to China Standard Time (`Asia/Shanghai`).

**Architecture:** An iOS Shortcut POSTs a strict payload to a dedicated machine-authenticated `/api/v1/health-sync` endpoint. Health v2 converts the trailing 60-day menstruation-date window into one durable daily summary and performs a same-day atomic create/update; `get_health` reads those summaries through the authenticated public MCP surface. A shared Temporal helper owns fixed `Asia/Shanghai` calendar boundaries and powers both Health calculations and `get_current_time`.

**Tech Stack:** TypeScript, Node.js >=20, Express 5, Drizzle ORM/PostgreSQL, Zod 3, `@js-temporal/polyfill`, MCP SDK 1.29.x, Node test runner through `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-06-health-v2-current-time-design.md`

## Global Constraints

- This is Health v2. Do not restore the retired `/api/v1/health` runtime, old `health_records` table, or deleted old Health runtime files.
- Health scope is only daily steps plus menstrual/cycle context. No sleep, heart rate, calories, workouts, weight, location, device metadata, or arbitrary HealthKit samples.
- Product timezone is exactly `Asia/Shanghai`; this is the IANA technical identifier used for Beijing/China Standard Time (UTC+8), not a different local time from Beijing.
- Shortcut cadence is hourly automation plus manual run; same-day calls update one `(user_id,date)` row.
- Shortcut writes use only dedicated `LEILEI_HEALTH_SYNC_KEY` + server-side `LEILEI_HEALTH_SYNC_USER_ID`; request bodies never contain user identity.
- ChatGPT/Claude receive read-only `get_health`; there is no Health MCP write tool.
- `get_current_time` is read-only, accepts a strict empty object, uses an injectable clock, and returns fixed `Asia/Shanghai` time.
- Never log the sync key, request body, `menstruation_dates`, step counts, period/cycle values, or Health MCP result bodies.
- Do not add Health to Global Search, Web UI, System Data UI, export/import, Calendar, or MCP write-idempotency.
- Every Health write is owner-scoped and checks active-user state inside the same DB transaction as the write.
- Health reads are owner-scoped and active-user guarded.
- Migration is additive only. No existing business-table rewrite/drop and no production DB access during implementation.
- Register `get_health` and `get_current_time` on the **public production MCP namespace only**; do not silently expand the internal MCP namespace.
- `get_current_time` has no Health/business-data DB dependency, but its normal active-user authorization may consult durable user status.
- TDD for each task: RED test -> verify failure -> minimal implementation -> focused GREEN -> commit.

---

## File Structure

Create:

- `src/domains/time/current-time.ts` — fixed product-timezone primitives and current-time formatting.
- `src/domains/health-v2/health-types.ts` — Health v2 DTOs and error codes.
- `src/domains/health-v2/health-service.ts` — payload normalization, Beijing-date/window validation, menstrual-run derivation, active-user read guard.
- `src/domains/health-v2/health-repository.ts` — Drizzle atomic create/update, transaction-scoped active-user write guard, owner-scoped reads.
- `src/web-api/health-sync-auth.ts` — dedicated constant-time key middleware.
- `src/web-api/health-sync-router.ts` — Shortcut POST endpoint and safe HTTP mapping.
- `src/mcp/tools/get-health/register.ts` — read-only Health MCP tool.
- `src/mcp/tools/get-current-time/register.ts` — read-only current-time MCP tool.
- `tests/health-v2-time.test.ts`
- `tests/health-v2-service.test.ts`
- `tests/health-v2-migration.test.ts`
- `tests/health-v2-repository.integration.test.ts`
- `tests/health-sync-api.test.ts`
- `tests/mcp-get-health.test.ts`
- `tests/mcp-get-current-time.test.ts`
- `tests/health-v2-mcp-inventory.test.ts`
- `docs/operations/health-v2-shortcut-and-rollout.md`

Modify:

- `src/database/schema.ts`
- generated `drizzle/0033_health_v2_daily_summaries.sql`
- generated `drizzle/meta/_journal.json`
- generated `drizzle/meta/0033_snapshot.json`
- `src/config/env.ts`
- `.env.example`
- `src/app/process-runtime.ts`
- `src/app/create-app.ts`
- `src/mcp/server/production-server-factory.ts`

Do not modify `src/mcp/server/create-server.ts` merely to expose these tools: public-only registration belongs in `production-server-factory.ts`, beside the existing public-only Thinking Block/Sentinel/Bridge registrations.

---

### Task 1: Fixed China-time primitives and Health derivation rules

**Files:**
- Create: `src/domains/time/current-time.ts`
- Create: `src/domains/health-v2/health-types.ts`
- Create: `src/domains/health-v2/health-service.ts`
- Create: `tests/health-v2-time.test.ts`
- Create: `tests/health-v2-service.test.ts`

**Interfaces:**

```ts
export const PRODUCT_TIMEZONE = "Asia/Shanghai";

export type CurrentTimeSnapshot = {
  date: string;
  time: string;
  datetime: string;
  timezone: typeof PRODUCT_TIMEZONE;
  weekday: string;
};

export function getProductDate(now?: Date): string;
export function formatCurrentTime(now?: Date): CurrentTimeSnapshot;

export type HealthDailySummary = {
  date: string;
  steps: number;
  menstruating: boolean;
  periodStartDate: string | null;
  cycleDay: number | null;
  updatedAt: Date;
};

export type NormalizedHealthSync = Omit<HealthDailySummary, "updatedAt">;
export type HealthSyncResult = { created: boolean; summary: HealthDailySummary };

export interface HealthRepository {
  findUserById(userId: string): Promise<{ status: "active" | "disabled" } | null>;
  upsertDaily(userId: string, summary: NormalizedHealthSync): Promise<HealthSyncResult>;
  readDay(userId: string, date: string): Promise<HealthDailySummary | null>;
  readRange(userId: string, dateFrom: string, dateTo: string): Promise<HealthDailySummary[]>;
}
```

- [ ] **Step 1: Write RED time tests**

`tests/health-v2-time.test.ts` must include:

```ts
assert.equal(PRODUCT_TIMEZONE, "Asia/Shanghai");
assert.equal(getProductDate(new Date("2026-09-05T16:00:00.000Z")), "2026-09-06");
assert.deepEqual(formatCurrentTime(new Date("2026-09-06T04:33:10.000Z")), {
  date: "2026-09-06",
  time: "12:33:10",
  datetime: "2026-09-06T12:33:10+08:00",
  timezone: "Asia/Shanghai",
  weekday: "Sunday",
});
```

Run:

```bash
pnpm exec tsx --test tests/health-v2-time.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement `current-time.ts` minimally**

Use:

```ts
import { Temporal } from "@js-temporal/polyfill";

export const PRODUCT_TIMEZONE = "Asia/Shanghai";

function toProductZonedDateTime(now: Date) {
  return Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(PRODUCT_TIMEZONE);
}
```

Use Temporal formatting/calendar APIs; do not import Task-domain time code.

Run the time test; expected PASS.

- [ ] **Step 3: Write RED Health normalization/service tests**

Use deterministic `now = new Date("2026-09-06T04:00:00.000Z")` and assert:

```ts
assert.deepEqual(
  normalizeHealthSyncPayload({
    date: "2026-09-06",
    steps: 6842,
    menstruation_dates: ["2026-09-05", "2026-09-04", "2026-09-05"],
  }, now),
  {
    date: "2026-09-06",
    steps: 6842,
    menstruating: false,
    periodStartDate: "2026-09-04",
    cycleDay: 3,
  },
);
```

Also cover: empty history; today menstruating; multiple runs choose the latest run; duplicate/unsorted input; future request date; malformed date; negative/non-integer steps; >60 input values; menstruation date after request date; menstruation date before `date - 59 days`.

For reads, fake `findUserById()` and assert disabled/missing users fail before `readDay/readRange` return data.

Run:

```bash
pnpm exec tsx --test tests/health-v2-service.test.ts
```

Expected: FAIL before implementation.

- [ ] **Step 4: Implement domain types, normalization, and service**

Rules are exact:

1. validate request date against current `Asia/Shanghai` date;
2. validate every menstruation date in inclusive `[date-59 days, date]`;
3. dedupe + ascending sort;
4. split into consecutive-day runs;
5. use the most recent run;
6. `periodStartDate = first day of latest run`;
7. `cycleDay = date - periodStartDate + 1` with Temporal calendar arithmetic;
8. `menstruating = normalizedDates.includes(date)`;
9. no history -> both cycle fields null and menstruating false.

`HealthService.readDay/readRecent` call `requireActiveUser(repository, userId)` before owner-scoped reads. `syncDaily` normalizes and delegates to repository `upsertDaily`; the repository provides the transaction-scoped write authorization in Task 3.

- [ ] **Step 5: Focused GREEN + commit**

```bash
pnpm exec tsx --test tests/health-v2-time.test.ts tests/health-v2-service.test.ts
git add src/domains/time/current-time.ts src/domains/health-v2/health-types.ts src/domains/health-v2/health-service.ts tests/health-v2-time.test.ts tests/health-v2-service.test.ts
git commit -m "feat: define Health v2 time and cycle rules"
```

---

### Task 2: Additive Health v2 schema and migration

**Files:**
- Modify: `src/database/schema.ts`
- Create/generated: `drizzle/0033_health_v2_daily_summaries.sql`
- Modify/generated: `drizzle/meta/_journal.json`
- Create/generated: `drizzle/meta/0033_snapshot.json`
- Create: `tests/health-v2-migration.test.ts`

**Interfaces:** `healthDailySummaries` maps to `health_daily_summaries`, unique on `(user_id,date)`.

- [ ] **Step 1: Write RED migration/source contract**

Assert current schema does not contain `healthDailySummaries`, then lock the intended table name/columns/check names in the test. Also assert historical `drizzle/0003_phase_5_health_schema.sql` remains a historical file and current `schema.ts` does not reintroduce `health_records`.

```bash
pnpm exec tsx --test tests/health-v2-migration.test.ts
```

Expected: FAIL on missing v2 schema.

- [ ] **Step 2: Add exact Drizzle table**

```ts
export const healthDailySummaries = pgTable(
  "health_daily_summaries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    date: date("date", { mode: "string" }).notNull(),
    steps: integer("steps").notNull(),
    menstruating: boolean("menstruating").notNull(),
    periodStartDate: date("period_start_date", { mode: "string" }),
    cycleDay: integer("cycle_day"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("health_daily_summaries_user_date_uidx").on(table.userId, table.date),
    check("health_daily_summaries_steps_nonnegative", sql`${table.steps} >= 0`),
    check("health_daily_summaries_cycle_day_positive", sql`${table.cycleDay} IS NULL OR ${table.cycleDay} >= 1`),
    check("health_daily_summaries_cycle_pair", sql`(${table.periodStartDate} IS NULL) = (${table.cycleDay} IS NULL)`),
    check("health_daily_summaries_period_not_future", sql`${table.periodStartDate} IS NULL OR ${table.periodStartDate} <= ${table.date}`),
    check("health_daily_summaries_cycle_consistent", sql`${table.periodStartDate} IS NULL OR ${table.cycleDay} = (${table.date} - ${table.periodStartDate}) + 1`),
  ],
);
```

- [ ] **Step 3: Generate and inspect 0033**

Against disposable/local PostgreSQL only:

```bash
DATABASE_URL="$DISPOSABLE_DATABASE_URL" pnpm db:generate -- --name health_v2_daily_summaries
```

Required generated result: index 0033; CREATE new table/FK/checks/unique index only. If SQL contains `DROP`, unrelated `ALTER`, business-data rewrite, or recreation of `health_records`, stop and investigate.

- [ ] **Step 4: GREEN + commit**

```bash
pnpm exec tsx --test tests/health-v2-migration.test.ts
DATABASE_URL="$DISPOSABLE_DATABASE_URL" pnpm db:check
git add src/database/schema.ts drizzle/0033_health_v2_daily_summaries.sql drizzle/meta/_journal.json drizzle/meta/0033_snapshot.json tests/health-v2-migration.test.ts
git commit -m "feat: add Health v2 daily summary schema"
```

---

### Task 3: Atomic repository create/update and owner-scoped reads

**Files:**
- Create: `src/domains/health-v2/health-repository.ts`
- Create: `tests/health-v2-repository.integration.test.ts`

**Interfaces:** Implements `HealthRepository`; `readRange` returns date ascending.

- [ ] **Step 1: Write RED disposable-Postgres integration tests**

Cover: first write `created=true`; second same-day write `created=false` and one row; updated fields replace old values while `created_at` is preserved; cross-user reads return nothing; range is bounded/sorted; disabled-user write mutates nothing; DB constraints reject inconsistent direct rows.

```bash
RUN_HEALTH_V2_DATABASE_TEST=1 DATABASE_URL="$DISPOSABLE_DATABASE_URL" \
  pnpm exec tsx --test --test-concurrency=1 tests/health-v2-repository.integration.test.ts
```

Expected: FAIL before repository exists.

- [ ] **Step 2: Implement repository with one transaction**

Inside `db.transaction(...)`:

1. lock/check `users` row using the repo's established durable mutation authorization pattern (`FOR SHARE` semantics);
2. attempt `INSERT ... ON CONFLICT DO NOTHING ... RETURNING` for `(user_id,date)`;
3. if insert returned a row, return `{ created: true, summary }`;
4. otherwise `UPDATE health_daily_summaries SET steps, menstruating, period_start_date, cycle_day, updated_at` with owner+date predicate and return `{ created: false, summary }`.

This avoids a race-prone pre-read and avoids relying on PostgreSQL system-column tricks to detect insert-vs-update.

Every read predicate contains `user_id = authenticatedUserId`. `readRange` also contains inclusive `dateFrom/dateTo` and `ORDER BY date ASC`.

- [ ] **Step 3: GREEN + commit**

```bash
RUN_HEALTH_V2_DATABASE_TEST=1 DATABASE_URL="$DISPOSABLE_DATABASE_URL" \
  pnpm exec tsx --test --test-concurrency=1 tests/health-v2-repository.integration.test.ts
git add src/domains/health-v2/health-repository.ts tests/health-v2-repository.integration.test.ts
git commit -m "feat: persist Health v2 daily summaries"
```

---

### Task 4: Dedicated iPhone Shortcut sync endpoint

**Files:**
- Create: `src/web-api/health-sync-auth.ts`
- Create: `src/web-api/health-sync-router.ts`
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Modify: `src/app/process-runtime.ts`
- Modify: `src/app/create-app.ts`
- Create: `tests/health-sync-api.test.ts`

**Interfaces:**

```ts
LEILEI_HEALTH_SYNC_KEY?: string; // min 32
LEILEI_HEALTH_SYNC_USER_ID?: string; // UUID
```

Route: `POST /api/v1/health-sync`, header `x-leilei-health-sync-key`.

Add this injectable app dependency:

```ts
healthSyncService?: Pick<HealthService, "syncDaily">;
```

`process-runtime.ts` supplies the real `HealthService`; tests supply a fake without contacting PostgreSQL.

- [ ] **Step 1: Write RED API/auth tests**

Assert: unconfigured key/user -> 503; missing/wrong key -> 401; valid dedicated key works without Auth0 Web token; unknown body key -> 400; invalid steps/date/window -> 400; first sync -> 201; same-day update -> 200; response contains normalized summary only; `/health` infrastructure response is unchanged; retired `/api/v1/health` is not restored; captured logger output contains neither key nor body/Health values.

Strict body schema:

```ts
const healthSyncBodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  steps: z.number().int().nonnegative(),
  menstruation_dates: z.array(
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  ).max(60),
}).strict();
```

- [ ] **Step 2: Implement dedicated auth**

Follow the existing Toy bridge security shape but use independent config/header. SHA-256 both supplied/configured strings and compare fixed-length digests through `timingSafeEqual`. Do not reuse Toy/OAuth/MCP secrets.

- [ ] **Step 3: Implement router and deterministic status**

Call `healthSyncService.syncDaily(configuredUserId, parsedBody)` and use repository-derived `result.created`:

```ts
response.status(result.created ? 201 : 200).json({
  success: true,
  data: serializeHealthSummary(result.summary),
});
```

Safe mapping: payload/domain validation 400; key failure 401; missing config or missing/disabled bound owner or DB readiness 503; unexpected failure generic 500.

- [ ] **Step 4: Wire env/runtime/app**

`process-runtime.ts` creates `HealthService(new DrizzleHealthRepository(db))`, passes it to `createProductionMcpSessionServerFactory`, and passes `healthSyncService: healthService` in app dependencies.

In `create-app.ts`, mount `/api/v1/health-sync` **before** the Auth0 Web `/api/v1` middleware stack, but after global JSON parsing/observability. Apply dedicated Health auth then database-readiness middleware then handler. Do not add CORS because this is a Shortcut machine endpoint, not browser Web API.

- [ ] **Step 5: GREEN + commit**

```bash
pnpm exec tsx --test tests/health-sync-api.test.ts tests/health-v2-service.test.ts
pnpm typecheck
git add src/web-api/health-sync-auth.ts src/web-api/health-sync-router.ts src/config/env.ts .env.example src/app/process-runtime.ts src/app/create-app.ts tests/health-sync-api.test.ts
git commit -m "feat: add authenticated Health v2 Shortcut sync"
```

---

### Task 5: Public read-only `get_health` MCP tool

**Files:**
- Create: `src/mcp/tools/get-health/register.ts`
- Modify: `src/mcp/server/production-server-factory.ts`
- Create: `tests/mcp-get-health.test.ts`
- Create: `tests/health-v2-mcp-inventory.test.ts`

**Interfaces:**

```ts
export type GetHealthToolDependencies = {
  healthService: Pick<HealthService, "readDay" | "readRecent">;
  getAuthenticatedUserId: () => string;
};
```

- [ ] **Step 1: Write RED tool tests**

Accepted strict inputs: `{}`, `{ "date": "2026-09-06" }`, `{ "days": 7 }`.

Rejected: date+days together, days 0/61, malformed date, `user_id`, `userId`, arbitrary fields.

Annotations exactly:

```ts
{
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}
```

Missing stored day returns no fabricated zero-step row. Output row fields are `date`, `steps`, `menstruating`, `period_start_date`, `cycle_day`, `updated_at`.

- [ ] **Step 2: Implement tool**

Get identity only from `getAuthenticatedUserId()`, delegate to HealthService, and map safe errors through existing MCP error contract. Never emit Health result values to console/logging.

- [ ] **Step 3: Register on public production namespace only**

Extend `createProductionMcpSessionServerFactory` input with:

```ts
healthService: HealthService;
```

After `const server = createMcpServer(...)`, register `get_health` only when `namespace === "public"`. Do not modify OAuth/session routing and do not expose it in the internal namespace.

- [ ] **Step 4: Lock interim MCP inventory + GREEN + commit**

`tests/health-v2-mcp-inventory.test.ts` compares production public vs internal namespace registration and proves Task 5 adds exactly public `get_health`, with no existing tool removed/renamed and no internal Health tool.

```bash
pnpm exec tsx --test tests/mcp-get-health.test.ts tests/health-v2-mcp-inventory.test.ts
pnpm typecheck
git add src/mcp/tools/get-health/register.ts src/mcp/server/production-server-factory.ts tests/mcp-get-health.test.ts tests/health-v2-mcp-inventory.test.ts
git commit -m "feat: expose read-only Health v2 MCP"
```

---

### Task 6: Public read-only `get_current_time` MCP tool

**Files:**
- Create: `src/mcp/tools/get-current-time/register.ts`
- Modify: `src/mcp/server/production-server-factory.ts`
- Modify: `tests/health-v2-mcp-inventory.test.ts`
- Create: `tests/mcp-get-current-time.test.ts`

**Interfaces:**

```ts
export type GetCurrentTimeToolDependencies = {
  requireActiveUser: () => Promise<string>;
  now?: () => Date;
};
```

- [ ] **Step 1: Write RED tests**

Strict `{}` succeeds; any input property fails. With `now = () => new Date("2026-09-06T04:33:10.000Z")`, exact structured data is:

```json
{
  "date": "2026-09-06",
  "time": "12:33:10",
  "datetime": "2026-09-06T12:33:10+08:00",
  "timezone": "Asia/Shanghai",
  "weekday": "Sunday"
}
```

Use the same read-only annotations as `get_health`.

- [ ] **Step 2: Implement tool**

Call `requireActiveUser()` first, then `formatCurrentTime((now ?? (() => new Date()))())`. The tool does not query Health/business data and has no DB write; the authorization guard may read user status.

- [ ] **Step 3: Register public-only and finalize inventory**

In production factory, register it only for `namespace === "public"`, using the already-created `activeUserAuthorization` function. Final inventory regression proves the feature adds exactly two public tools — `get_health`, `get_current_time` — and zero internal tools.

- [ ] **Step 4: GREEN + commit**

```bash
pnpm exec tsx --test tests/mcp-get-current-time.test.ts tests/health-v2-mcp-inventory.test.ts tests/health-v2-time.test.ts
pnpm typecheck
git add src/mcp/tools/get-current-time/register.ts src/mcp/server/production-server-factory.ts tests/mcp-get-current-time.test.ts tests/health-v2-mcp-inventory.test.ts
git commit -m "feat: add current time MCP tool"
```

---

### Task 7: Runbook, full verification, and security gate

**Files:**
- Create: `docs/operations/health-v2-shortcut-and-rollout.md`
- Modify focused test/runtime files only if verification finds a real defect.

- [ ] **Step 1: Write operator + Shortcut runbook**

Document the exact Shortcut shape without any real secret:

1. query today's Health Steps and sum them;
2. query Menstruation records for trailing 60 calendar days;
3. format sample dates to unique `yyyy-MM-dd` strings;
4. format current China business date `yyyy-MM-dd`;
5. `Get Contents of URL` -> POST `${LEILEI_OS_BASE_URL}/api/v1/health-sync`;
6. JSON body contains only `date`, numeric `steps`, `menstruation_dates`;
7. header is `x-leilei-health-sync-key` configured privately on device;
8. manual smoke first, hourly iOS Automation only after smoke passes.

Document rollout order: backup/restore readiness -> configure the two Health env values -> deploy reviewed exact SHA -> `/health` + `/ready` + safe logs -> confirm ChatGPT/Claude public MCP schemas -> real Shortcut manual run -> `get_health` readback from both -> `get_current_time` readback -> enable hourly automation.

- [ ] **Step 2: Run all focused tests**

```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/health-v2-time.test.ts \
  tests/health-v2-service.test.ts \
  tests/health-v2-migration.test.ts \
  tests/health-sync-api.test.ts \
  tests/mcp-get-health.test.ts \
  tests/mcp-get-current-time.test.ts \
  tests/health-v2-mcp-inventory.test.ts
```

Expected: 0 failures.

- [ ] **Step 3: Run disposable PostgreSQL gates**

Apply the full checked-in migration chain to a fresh disposable PostgreSQL, then:

```bash
RUN_HEALTH_V2_DATABASE_TEST=1 DATABASE_URL="$DISPOSABLE_DATABASE_URL" \
  pnpm exec tsx --test --test-concurrency=1 tests/health-v2-repository.integration.test.ts
DATABASE_URL="$DISPOSABLE_DATABASE_URL" pnpm db:check
```

Read back: latest ledger is 0033; new table has exact columns/checks/unique index; historical `health_records` remains absent after its old create/drop sequence; unrelated durable counts unchanged by 0033.

- [ ] **Step 4: Run canonical repo gates**

```bash
CI=true pnpm test
pnpm typecheck
pnpm build
pnpm --dir web run typecheck
pnpm --dir web run build
git diff --check
```

Expected: all pass. Existing Vite >500k warning is non-blocking. If `tsx` hits the known IPC/socket `EPERM` or `EINVAL`, stop after the first controlled attempt and report the environment exception; do not retry temp-dir tricks.

- [ ] **Step 5: Security/privacy review exact feature diff**

Blocking checks:

- no key/request/Health-value logging;
- no client-supplied identity;
- constant-time key comparison;
- active-user write guard inside same transaction;
- owner-scoped reads;
- no Health MCP write;
- only public MCP gains the two new tools;
- no Global Search/export/import/Web UI additions;
- no OAuth/CIMD/Bridge/Sentinel behavior change;
- additive migration only;
- root `/health` unchanged;
- retired `/api/v1/health` remains retired.

Fix any finding, rerun affected focused tests, then rerun canonical gates.

- [ ] **Step 6: Commit runbook and open Draft PR**

```bash
git add docs/operations/health-v2-shortcut-and-rollout.md
git commit -m "docs: add Health v2 rollout and Shortcut runbook"
```

Draft PR body must include exact BASE/HEAD, changed files, focused/full test results, disposable DB evidence, public/internal MCP inventory delta, migration SQL summary, and Security Review. Do not claim `DEPLOYED` or `PRODUCTION_ACCEPTED`.

---

## Self-Review Result

- Spec coverage: all approved architecture, data, sync auth, cycle derivation, public MCP reads, current-time behavior, privacy, tests, and rollout boundaries map to Tasks 1-7.
- Placeholder scan: no `TBD`, `TODO`, "implement later", or undefined follow-up requirement remains.
- Type consistency: `HealthSyncResult`, `HealthRepository`, `healthSyncService`, `healthService`, `GetHealthToolDependencies`, and `GetCurrentTimeToolDependencies` use one stable signature across tasks.
- Scope check: this remains one coherent delivery because the tiny `get_current_time` tool shares the same fixed-time primitive and public MCP rollout; it does not require a separate subsystem plan.

## Codex Execution Contract

Use a fresh implementation branch carrying this reviewed spec + plan:

- branch: `feat/health-v2-current-time`;
- base it on the exact reviewed docs head supplied in the task package;
- TDD every task and commit each independently reviewable GREEN step;
- do not merge, deploy, configure Railway production secrets, access production DB, or send a real iPhone Health payload;
- open a Draft PR only after local/disposable verification;
- stop on any production-impact ambiguity and report it rather than guessing.

Production rollout and the first real Shortcut write are later, separately authorized stages.