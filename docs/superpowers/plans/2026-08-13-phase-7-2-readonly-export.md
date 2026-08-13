# Phase 7.2 Read-only Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal authenticated read-only JSON export for Memory, Diary, Task, and Todo from `System → Data`, with optional sanitized audit data and a stable schema-versioned contract suitable for later import/recovery work.

**Architecture:** Add an isolated `export` domain with explicit export contract types, an `ExportService`, and a `DrizzleExportRepository` that SELECTs only allowed fields. Expose it through a dedicated `/api/v1/system/export` Web API router. Reuse the existing authenticated `WebApiClient.request<T>()` on the web: fetch the export JSON, serialize it into a browser Blob, and download it locally. Do not change database schema, MCP tools, or `SystemService`.

**Tech Stack:** TypeScript, Node 20+, Express 5, Drizzle ORM/PostgreSQL, React 19, JSDOM/node:test, pnpm.

## Global Constraints

- Work only on `feat/phase-7-2-readonly-export` until the final rollout checkpoint.
- Do not move `codex/phase-6-web-ui-foundation` until all focused/full verification is green.
- No database migration or schema change.
- No Health, Toy, account/profile/settings, Auth0 identity, MCP export tool, ZIP, background job, import, restore, or server-side export-file persistence.
- Do not export `user_id`, Auth0 subject, tokens/secrets, Diary idempotency/request hashes, MCP idempotency rows, lifecycle raw `metadata`, tool request/result summaries, tool idempotency keys, or `duration_ms`.
- Export reads must not create lifecycle events, tool-call audit rows, or any other database mutation.
- Do not modify the separate PWA branch/worktree or unrelated preview files.
- Do not update Notion during this work.
- Use test-driven development: create the failing focused test before each production change.

---

## Task 1: Define the stable export contract and service orchestration

**Files:**
- Create: `src/domains/export/export-types.ts`
- Create: `src/domains/export/export-service.ts`
- Create: `tests/export-service.test.ts`

- [ ] **Step 1: Write the failing service/contract tests.**

Create `tests/export-service.test.ts` with a fake repository and fixed clock. Cover:

1. `schema_version` is exactly `1`.
2. top-level keys are exactly `schema_version`, `exported_at`, `data` when audit is off.
3. `scope="memory"|"diary"|"task"|"todo"` calls only the matching repository method and emits only that `data` key.
4. `scope="all"` emits all four keys.
5. audit repository methods are not called when audit is off.
6. audit is present only when requested and contains only `lifecycle` and `tool_activity`.
7. fixed clock `2026-08-13T05:42:00.000Z` serializes exactly to that UTC ISO string.
8. repository exceptions propagate to the API layer; the service does not convert them into partial documents.

Run:

```bash
pnpm exec tsx --test --test-concurrency=1 tests/export-service.test.ts
```

Expected: FAIL because the export domain does not exist.

- [ ] **Step 2: Add the contract types.**

In `src/domains/export/export-types.ts`, define:

```ts
export type ExportScope = "all" | "memory" | "diary" | "task" | "todo";

export type ExportMemoryRecord = {
  id: string;
  category: string;
  key: string;
  content: string;
  tags: string[];
  visibility: string;
  source: string;
  author: "L" | "G" | null;
  status: "active" | "archived";
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ExportDiaryRecord = {
  id: string;
  title: string;
  content: string;
  date: string;
  tags: string[];
  mood: string | null;
  source: string;
  author: "L" | "G" | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

export type ExportTaskRecord = {
  id: string;
  title: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  resume_status: "pending" | "in_progress" | "completed" | "cancelled" | null;
  lifecycle_status: "active" | "archived";
  author: "L" | "G" | null;
  priority: "low" | "normal" | "high" | "urgent";
  due_time: string | null;
  timezone: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type ExportTodoPaper = {
  date: string;
  author: "L" | "G";
  revision: number;
  created_at: string;
  updated_at: string;
  entries: Array<{
    id: string;
    kind: "pending" | "completed" | "record";
    text: string;
  }>;
};

export type ExportLifecycleEvent = {
  id: string;
  resource_type: string;
  resource_id: string;
  action: string;
  actor_type: string;
  channel: string;
  created_at: string;
};

export type ExportToolActivity = {
  id: string;
  tool_name: string;
  operation: string;
  resource_type: string;
  resource_id: string | null;
  status: string;
  error_code: string | null;
  created_at: string;
};

export type ExportDataV1 = {
  memory?: ExportMemoryRecord[];
  diary?: ExportDiaryRecord[];
  task?: ExportTaskRecord[];
  todo?: ExportTodoPaper[];
};

export type ExportDocumentV1 = {
  schema_version: 1;
  exported_at: string;
  data: ExportDataV1;
  audit?: {
    lifecycle: ExportLifecycleEvent[];
    tool_activity: ExportToolActivity[];
  };
};
```

Keep the types tied to the approved export contract, not raw database rows.

- [ ] **Step 3: Implement the service against a narrow repository interface.**

In `src/domains/export/export-service.ts`, define and export:

```ts
export interface ExportRepository {
  listMemory(userId: string): Promise<ExportMemoryRecord[]>;
  listDiary(userId: string): Promise<ExportDiaryRecord[]>;
  listTasks(userId: string): Promise<ExportTaskRecord[]>;
  listTodo(userId: string): Promise<ExportTodoPaper[]>;
  listLifecycleAudit(userId: string): Promise<ExportLifecycleEvent[]>;
  listToolActivity(userId: string): Promise<ExportToolActivity[]>;
}

export class ExportService {
  constructor(
    private readonly repository: ExportRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createExport(
    userId: string,
    scope: ExportScope,
    includeAudit: boolean,
  ): Promise<ExportDocumentV1>;
}
```

Implementation rules:

- construct `data` only with the requested module keys;
- for `all`, fetch all four business modules;
- fetch audit only when `includeAudit === true`;
- create the final document only after all required reads resolve, so a failed read cannot return a partial export;
- set `exported_at` once from `this.now().toISOString()`;
- do not add `scope`, `counts`, `include_audit`, or application-version fields.

- [ ] **Step 4: Run the focused service tests.**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/export-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1.**

```bash
git add src/domains/export/export-types.ts src/domains/export/export-service.ts tests/export-service.test.ts
git commit -m "feat: add readonly export contract and service"
```

---

## Task 2: Implement privacy-safe, deterministic PostgreSQL export reads

**Files:**
- Create: `src/domains/export/export-repository.ts`
- Create: `tests/export-repository.integration.test.ts`

- [ ] **Step 1: Write the failing repository integration test.**

Create `tests/export-repository.integration.test.ts`, guarded by:

```ts
const runIntegration =
  process.env.RUN_EXPORT_DATABASE_TEST === "1" && Boolean(process.env.DATABASE_URL);
```

Use the same transaction-and-rollback style as `tests/todo-repository.integration.test.ts`. Seed two users and representative rows for every exported table. For user A seed:

- Memory: one active and one archived record with different `createdAt` values.
- Diary: one active and one archived record, with populated `idempotencyKey` and `requestHash` specifically to prove they never appear in the export DTO.
- Task: one active and one archived record, including nullable and non-null time fields.
- Todo: one paper with two entries inserted out of logical order in the test setup but distinct `position=0/1`, plus one durable empty paper.
- Lifecycle: at least two rows with non-empty raw `metadata`.
- Tool calls: at least two rows with populated `idempotencyKey`, `requestSummary`, `resultSummary`, and `durationMs`.
- User B: one distinctive private record in each relevant business/audit table.

Assertions:

1. every repository method returns only user A rows;
2. Memory order is `created_at`, then `id`;
3. Diary order is `date`, then `created_at`, then `id`;
4. Task order is `created_at`, then `id`;
5. Todo papers order is `date`, then `author`;
6. Todo entries follow `position` but returned entries omit `position` and DB UUIDs;
7. durable empty Todo paper is present with `entries: []`;
8. lifecycle order is `created_at`, then `id` and has no `metadata`;
9. tool activity order is `created_at`, then `id` and has no `idempotencyKey`, `requestSummary`, `resultSummary`, or `durationMs`;
10. serialized returned DTOs do not contain either user ID, Diary request hashes/idempotency keys, Todo DB IDs, or user B marker text.

Run in a configured PostgreSQL test environment:

```bash
RUN_EXPORT_DATABASE_TEST=1 pnpm exec tsx --test --test-concurrency=1 tests/export-repository.integration.test.ts
```

Expected: FAIL because `DrizzleExportRepository` does not exist.

- [ ] **Step 2: Implement `DrizzleExportRepository`.**

In `src/domains/export/export-repository.ts`:

- import only the tables needed: `coreMemories`, `diaryEntries`, `tasks`, `todoPapers`, `todoEntries`, `resourceLifecycleEvents`, `toolCalls`;
- do not query `users` for export payload construction;
- do not query `mcpWriteIdempotency`;
- use explicit Drizzle `.select({ ...allowedFields })` projections rather than `.select()` so prohibited columns cannot leak accidentally;
- every query must include `where(eq(table.userId, userId))` or be constrained through user-owned Todo paper IDs;
- use ascending deterministic order matching the spec;
- convert `Date` values to ISO strings at the repository boundary;
- keep nullable values as `null`.

Todo implementation should preserve empty papers. Use two reads:

1. fetch all user-owned papers ordered by `businessDate`, `author`, selecting paper DB `id` only as an internal join key plus approved output fields;
2. if papers are non-empty, fetch entries whose `paperId` is in those paper IDs, ordered by `paperId`, `position`, and group them in memory;
3. return each paper with `entries: groupedEntries.get(paper.id) ?? []` and omit the internal paper ID from the returned DTO.

Do not reuse `TodoService.listContentDates()`: it intentionally excludes durable empty papers and therefore cannot satisfy the export contract.

- [ ] **Step 3: Run the integration test.**

```bash
RUN_EXPORT_DATABASE_TEST=1 pnpm exec tsx --test --test-concurrency=1 tests/export-repository.integration.test.ts
```

Expected: PASS in a configured PostgreSQL environment. If `DATABASE_URL` is unavailable, the test must skip rather than fake a pass; run it later in the configured database gate.

- [ ] **Step 4: Run service tests again.**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/export-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2.**

```bash
git add src/domains/export/export-repository.ts tests/export-repository.integration.test.ts
git commit -m "feat: add privacy-safe export repository"
```

---

## Task 3: Add the authenticated export Web API and runtime wiring

**Files:**
- Create: `src/web-api/export-router.ts`
- Modify: `src/web-api/router.ts`
- Modify: `src/app/create-app.ts`
- Create: `tests/export-api.test.ts`

- [ ] **Step 1: Write failing API tests.**

Create `tests/export-api.test.ts` with an Express test server matching the pattern in `tests/system-api.test.ts`. Inject an export service stub through `createWebApiRouter` and cover:

1. unauthenticated `GET /api/v1/system/export?scope=all` returns `401` and never calls the service;
2. authenticated request passes the server-owned `request.webUserId`, ignoring any attacker-supplied `user_id`/`userId` query;
3. valid scopes: `all`, `memory`, `diary`, `task`, `todo`;
4. missing/unknown/repeated `scope` returns `400`;
5. `include_audit` accepts only omitted, `false`, or `true`; other/repeated values return `400`;
6. success returns the document directly, not `{ success, data }`;
7. success has `Content-Type: application/json; charset=utf-8` and a `Content-Disposition` attachment filename matching `leileios-export-<UTC timestamp>.json`;
8. service failure returns `503` JSON error and does not set `Content-Disposition`.

Run:

```bash
pnpm exec tsx --test --test-concurrency=1 tests/export-api.test.ts
```

Expected: FAIL because the route is not mounted.

- [ ] **Step 2: Implement `src/web-api/export-router.ts`.**

Define:

```ts
export type ExportApiDependencies = {
  exportService: Pick<ExportService, "createExport">;
};

export function createExportApiRouter(
  dependencies: ExportApiDependencies,
): Router;
```

Route: `GET /` when mounted at `/system/export`.

Parsing rules:

```ts
scope: exactly one string in ["all", "memory", "diary", "task", "todo"]
include_audit: undefined | "false" => false; "true" => true; anything else => invalid
```

Responses:

- `401`:
  `UNAUTHORIZED / Web API authentication is required.`
- `400`:
  `INVALID_EXPORT_REQUEST / Export request is invalid.`
- `503`:
  `EXPORT_UNAVAILABLE / Export data is temporarily unavailable.`

For success, call `createExport(request.webUserId, scope, includeAudit)` first. Only after it resolves, set attachment headers and `response.json(document)`.

Derive a filesystem-safe filename from `document.exported_at`, e.g. `2026-08-13T05:42:00.000Z` → `leileios-export-20260813T054200Z.json`. The JSON document itself remains unchanged.

- [ ] **Step 3: Mount the router without widening unrelated tests.**

In `src/web-api/router.ts`:

- import `createExportApiRouter` / `ExportApiDependencies`;
- add `export?: ExportApiDependencies` to `WebApiRouterDependencies`, mirroring the existing optional Todo/global-search integration style;
- mount only when provided:

```ts
if (dependencies.export) {
  router.use("/system/export", createExportApiRouter(dependencies.export));
}
```

Keep the existing `/system` router unchanged.

- [ ] **Step 4: Wire the service in `src/app/create-app.ts`.**

Add:

```ts
import { DrizzleExportRepository } from "../domains/export/export-repository.js";
import { ExportService } from "../domains/export/export-service.js";
import type { ExportApiDependencies } from "../web-api/export-router.js";
```

Extend `AppDependencies`:

```ts
webExportService?: ExportApiDependencies["exportService"];
```

In the Web API service setup:

- initialize `let webExportService = dependencies.webExportService;`
- include it in both service-completeness checks;
- when a DB must be created, construct `new ExportService(new DrizzleExportRepository(db))` if missing;
- pass `export: { exportService: webExportService }` to `createWebApiRouter`.

No new environment variable and no migration.

- [ ] **Step 5: Run focused API and auth regression tests.**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/export-api.test.ts tests/system-api.test.ts tests/web-api-auth.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3.**

```bash
git add src/web-api/export-router.ts src/web-api/router.ts src/app/create-app.ts tests/export-api.test.ts
git commit -m "feat: expose authenticated readonly export API"
```

---

## Task 4: Add System → Data export controls and browser download behavior

**Files:**
- Create: `web/src/system/export-types.ts`
- Create: `web/src/system/download-export.ts`
- Modify: `web/src/pages/SystemDataPageContent.tsx`
- Modify: `web/src/styles.css`
- Modify: `tests/system-data-activity-ui.test.ts`
- Create: `tests/system-data-export-ui.test.ts`

- [ ] **Step 1: Update the existing summary regression expectation.**

In `tests/system-data-activity-ui.test.ts`, remove the old assertion that Data must not contain `/Export/`; retain the assertions that the existing authenticated counts and Retry behavior remain unchanged.

Do not mix new export interaction coverage into the existing activity tests.

- [ ] **Step 2: Write failing export UI tests.**

Create `tests/system-data-export-ui.test.ts` using the existing JSDOM/React root setup. Mock `WebApiClient.request<T>()`, `URL.createObjectURL`, `URL.revokeObjectURL`, and anchor `.click()` as needed.

Cover:

1. page still requests `/system/data` on mount;
2. renders exactly five export actions: all, Memory, Diary, Task, Todo;
3. audit checkbox/switch is unchecked by default;
4. clicking `Export Memory` calls `/system/export?scope=memory` with audit omitted/false;
5. enabling audit then clicking `Export all` calls `/system/export?scope=all&include_audit=true`;
6. successful export creates one JSON Blob/download with a filename derived from `exported_at`;
7. the downloaded JSON exactly serializes the returned export document and does not add UI-only fields;
8. while an export request is pending, export actions are disabled; summary retry state remains independent;
9. failed export shows a local export error message and causes no anchor click/download;
10. a failed export does not erase an already-loaded data summary.

Run:

```bash
pnpm exec tsx --test --test-concurrency=1 tests/system-data-export-ui.test.ts tests/system-data-activity-ui.test.ts
```

Expected: FAIL before implementation.

- [ ] **Step 3: Add minimal web export types.**

Create `web/src/system/export-types.ts` with only what the UI needs:

```ts
export type WebExportScope = "all" | "memory" | "diary" | "task" | "todo";

export type WebExportDocument = {
  schema_version: 1;
  exported_at: string;
  data: Record<string, unknown[]>;
  audit?: {
    lifecycle: unknown[];
    tool_activity: unknown[];
  };
};
```

Do not duplicate every backend record field in the web bundle; the UI transports/downloads the document and does not interpret business records.

- [ ] **Step 4: Add a focused browser download helper.**

Create `web/src/system/download-export.ts`:

```ts
export function downloadExportDocument(document: WebExportDocument): void;
```

Behavior:

- `JSON.stringify(document, null, 2)`;
- create `Blob([json], { type: "application/json;charset=utf-8" })`;
- `URL.createObjectURL(blob)`;
- temporary `<a>` with `download="leileios-export-<sanitized exported_at>.json"`;
- trigger click;
- remove anchor and revoke object URL in `finally`.

Do not add a file-saver dependency.

- [ ] **Step 5: Add the controls to `SystemDataPageContent.tsx`.**

Preserve the current summary state machine. Add independent export state:

```ts
type ExportState =
  | { status: "idle" }
  | { status: "loading"; scope: WebExportScope }
  | { status: "error" };
```

Add local `includeAudit` boolean defaulting to `false`.

Add one `runExport(scope: WebExportScope)` function that:

1. sets export loading state;
2. builds `/system/export?scope=${scope}` plus `&include_audit=true` only when enabled;
3. calls `api.request<WebExportDocument>(path)`;
4. calls `downloadExportDocument(document)` only after success;
5. resets to idle on success;
6. sets local error state on failure.

Render the export section after the existing data summary with:

- `Export all`
- `Export Memory`
- `Export Diary`
- `Export Task`
- `Export Todo`
- checkbox/switch label `Include audit/lifecycle events`

No confirmation modal, progress bar, history, or extra settings.

- [ ] **Step 6: Add only the CSS needed for the new controls.**

In `web/src/styles.css`, add narrowly named rules near the existing `.system-data-*` rules, for example:

- `.system-export-section`
- `.system-export-actions`
- `.system-export-option`
- `.system-export-error`

Reuse existing `.secondary-button` and existing spacing/color tokens. Do not restyle the rest of the System page.

- [ ] **Step 7: Run focused UI tests and web typecheck.**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/system-data-export-ui.test.ts tests/system-data-activity-ui.test.ts
cd web && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4.**

```bash
git add web/src/system/export-types.ts web/src/system/download-export.ts web/src/pages/SystemDataPageContent.tsx web/src/styles.css tests/system-data-activity-ui.test.ts tests/system-data-export-ui.test.ts
git commit -m "feat: add System Data export controls"
```

---

## Task 5: Close contract gaps and prove no mutation/privacy regressions

**Files:**
- Modify if needed: `tests/export-service.test.ts`
- Modify if needed: `tests/export-repository.integration.test.ts`
- Modify if needed: `tests/export-api.test.ts`
- Modify if needed: `tests/system-data-export-ui.test.ts`

- [ ] **Step 1: Run the complete focused 7.2 test set serially.**

```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/export-service.test.ts \
  tests/export-api.test.ts \
  tests/system-api.test.ts \
  tests/web-api-auth.test.ts \
  tests/system-data-export-ui.test.ts \
  tests/system-data-activity-ui.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the configured PostgreSQL export integration gate.**

```bash
RUN_EXPORT_DATABASE_TEST=1 pnpm exec tsx --test --test-concurrency=1 tests/export-repository.integration.test.ts
```

Expected: PASS, not skipped, in the configured DB verification environment.

Before/after the export reads in this integration test, compare counts for the business tables plus `resourceLifecycleEvents`, `toolCalls`, and `mcpWriteIdempotency`. Assert all counts remain unchanged. This is the explicit no-mutation proof.

- [ ] **Step 3: Perform a prohibited-field string scan on representative export output in tests.**

Assert a serialized full export does not match case-sensitive/raw database field markers or seeded secret markers for:

```text
user_id
idempotency_key
request_hash
request_summary
result_summary
duration_ms
access_token
refresh_token
```

Also assert lifecycle test-only metadata marker text is absent.

Do not write a generic recursive sanitizer in production; privacy is enforced by explicit SQL projection. The scan is a regression test only.

- [ ] **Step 4: Fix only defects found by these tests, then rerun Steps 1–3.**

Expected: all green.

- [ ] **Step 5: Commit any closure fixes/tests.**

```bash
git add tests/export-service.test.ts tests/export-repository.integration.test.ts tests/export-api.test.ts tests/system-data-export-ui.test.ts src/domains/export src/web-api web/src/system web/src/pages/SystemDataPageContent.tsx web/src/styles.css
git commit -m "test: harden readonly export privacy and mutation guarantees"
```

Skip this commit if Step 4 required no changes.

---

## Task 6: Full verification before rollout

**Files:** none unless verification reveals a defect.

- [ ] **Step 1: Backend full serial test suite.**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/**/*.test.ts
```

Expected: 0 failures. DB-gated tests may skip only where their environment flags are intentionally absent; the Phase 7.2 export DB test must already have passed unskipped in Task 5.

- [ ] **Step 2: Backend typecheck/build/schema check.**

```bash
pnpm typecheck
pnpm build
pnpm db:check
```

Expected: all PASS. `db:check` must show no migration/schema work required.

- [ ] **Step 3: Web typecheck/build.**

```bash
cd web
pnpm typecheck
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Review the feature diff against the accepted base.**

```bash
git diff --check 807ba8993e2a4e15d249b211df4b2943d592d75e..HEAD
git diff --stat 807ba8993e2a4e15d249b211df4b2943d592d75e..HEAD
git diff 807ba8993e2a4e15d249b211df4b2943d592d75e..HEAD -- \
  src/domains/export \
  src/web-api \
  src/app/create-app.ts \
  web/src/system \
  web/src/pages/SystemDataPageContent.tsx \
  web/src/styles.css \
  tests/export-service.test.ts \
  tests/export-repository.integration.test.ts \
  tests/export-api.test.ts \
  tests/system-data-export-ui.test.ts \
  tests/system-data-activity-ui.test.ts
```

Confirm:

- no database schema/migration changes;
- no MCP changes;
- no Health/Toy/settings changes;
- no prohibited export fields;
- no production branch movement yet.

- [ ] **Step 5: Run a sensitive-field source scan limited to the export implementation.**

Inspect the export repository projections and ensure prohibited fields occur only in tests asserting absence, not in returned DTO construction.

- [ ] **Step 6: Commit any verification-driven fix and rerun all affected gates.**

Never claim completion from an earlier green run after changing code.

---

## Task 7: Roll out and run production smoke

**Prerequisite:** Task 6 is completely green and the feature branch is a strict fast-forward descendant of accepted production SHA `807ba8993e2a4e15d249b211df4b2943d592d75e`.

- [ ] **Step 1: Re-fetch and compare branches immediately before rollout.**

Confirm:

- merge base is exact accepted production SHA or a newer accepted SHA that contains it;
- feature branch is ahead and not behind;
- changed files are limited to the approved 7.2 implementation/spec/plan/tests;
- no force push is required.

If production moved independently, stop and rebase/reconcile safely before deployment.

- [ ] **Step 2: Fast-forward the accepted production branch only.**

Move `codex/phase-6-web-ui-foundation` to the verified feature SHA with `force=false`.

No DB migration and no DB backup are required specifically for 7.2 because this phase changes no schema and performs only reads.

- [ ] **Step 3: Wait for both production deployments to report success.**

Verify Railway and Vercel are both green on the exact deployed SHA before smoke testing.

- [ ] **Step 4: Production UI smoke in `System → Data`.**

With the authenticated user:

1. confirm the existing Memory/Diary/Task/Health summary still loads;
2. with audit OFF, export each of `Memory`, `Diary`, `Task`, `Todo`, and `all` once;
3. confirm each produces one `.json` download and no UI error;
4. inspect the `all` document: top-level keys exactly `schema_version`, `exported_at`, `data`; `schema_version=1`; `data` has exactly `memory`, `diary`, `task`, `todo`;
5. confirm archived Memory/Diary/Task records are present where production contains them;
6. confirm Todo revision and entry order match a readback sample, including any durable empty paper if present;
7. turn audit ON and export `all` once; confirm top-level `audit` appears with only `lifecycle` and `tool_activity`;
8. scan the downloaded JSON for prohibited identity/infrastructure keys and confirm none are present;
9. confirm normal app data is unchanged after export.

- [ ] **Step 5: Final acceptance record.**

Record exact deployed SHA and these results:

```text
PHASE_7_2_EXPORT=PASS
EXPORT_MEMORY=PASS
EXPORT_DIARY=PASS
EXPORT_TASK=PASS
EXPORT_TODO=PASS
EXPORT_ALL=PASS
EXPORT_AUDIT_OPTION=PASS
PROHIBITED_FIELDS_ABSENT=YES
PRODUCTION_DATA_MUTATED=NO
RAILWAY=PASS
VERCEL=PASS
```

Only after this production smoke passes is Phase 7.2 complete and the next import/recovery phase eligible to start.
