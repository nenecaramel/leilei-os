# Web Permanent Delete — Memory / Diary / Task Implementation Plan

> Execute this plan on `feature/web-permanent-delete-memory-diary-task-v2`.
> Approved design: `docs/superpowers/specs/2026-08-20-web-permanent-delete-memory-diary-task-design.md`.

## Goal

Implement Web-only irreversible deletion for already-archived Memory, Diary, and Task resources while preserving the existing archive/restore contract, retaining the generic MCP write-idempotency ledger, removing resource-linked content-bearing audit traces, leaving one minimal `permanent_delete` lifecycle tombstone, and proving the deleted resource is absent from Search, Export, and existing MCP reads.

## Non-negotiable boundaries

Do not:
- add an MCP delete tool, schema, permission, registration, or ChatGPT tool-list change;
- change ordinary archive `DELETE` semantics;
- add permanent delete for active resources;
- touch Todo, Universe, or Notion behavior;
- add a database migration or schema redesign;
- delete matching `mcp_write_idempotency` rows;
- introduce unrelated refactors or a new UI design system.

Use TDD for backend/API behavior: add the smallest failing test, run it to see the expected failure, implement only enough production code to pass, rerun the target test, then commit the green checkpoint. Do not commit a knowingly red branch.

---

## Task 1 — Memory repository/domain permanent delete contract

**Files**
- Modify: `src/domains/memory/memory-repository.ts`
- Test: `tests/memory.test.ts`
- Test: `tests/user-state-hardening.test.ts`

### 1.1 Add failing repository tests

Add cases proving that permanent deletion:
1. succeeds only for an archived assistant-visible Memory owned by the active current user;
2. physically removes the business row;
3. removes prior `resource_lifecycle_events` for `resourceType = memory` and that `resourceId`;
4. leaves exactly one new `permanent_delete` lifecycle tombstone with `metadata = {}` and no copied title/content/tags;
5. preserves matching `mcp_write_idempotency` rows for `resourceType = memory`;
6. returns existing not-found semantics and mutates nothing for active, wrong-owner, non-assistant, and missing IDs;
7. returns existing disabled-user semantics and mutates nothing for a disabled current user;
8. returns not-found semantics on a second permanent-delete attempt.

Run the smallest affected test first:

```bash
npx vitest run tests/memory.test.ts tests/user-state-hardening.test.ts
```

Confirm the new tests fail for the expected missing permanent-delete behavior, not because fixtures are broken.

### 1.2 Implement Memory permanent delete

Extend the Memory repository contract with one explicit permanent-delete operation. Follow the repository's existing transaction and active-user patterns rather than inventing a parallel access layer.

Within one transaction:
1. call the existing in-transaction active-user guard;
2. select the target by current `userId`, `id`, `status = archived`, and `visibility = assistant`;
3. if no eligible row exists, return the repository's existing not-found result without mutation;
4. do not delete or update any `mcp_write_idempotency` row;
5. delete prior lifecycle rows matching current `userId`, `resourceType = memory`, and the resource ID;
6. physically delete the exact eligible Memory row and require exactly one deleted row;
7. perform a fresh same-user/id read without a status filter and fail the transaction if the row still exists;
8. insert one lifecycle event using `WEB_USER_LIFECYCLE_CONTEXT`, action `permanent_delete`, the original resource ID, and `metadata = {}`;
9. commit only if every step succeeds.

Prefer the existing lifecycle audit repository/helper if it already supports inserting `permanent_delete`; do not broaden shared abstractions unless required by the three domain implementations.

### 1.3 Verify and checkpoint

```bash
npx vitest run tests/memory.test.ts tests/user-state-hardening.test.ts
```

Expected: green, including existing archive/restore behavior.

Checkpoint commit after green:

```bash
git add src/domains/memory/memory-repository.ts tests/memory.test.ts tests/user-state-hardening.test.ts
git commit -m "feat: add memory permanent delete"
```

---

## Task 2 — Diary permanent delete and content-bearing audit cleanup

**Files**
- Modify: `src/domains/diary/diary-repository.ts`
- Test: `tests/database.test.ts`
- Test: `tests/mcp-idempotency-enforcement.test.ts`
- Test: `tests/mcp-observability.test.ts`

### 2.1 Add failing Diary tests

Create/extend tests proving:
1. an archived Diary owned by the active current user can be permanently deleted;
2. active, wrong-owner, missing, disabled-user, and repeated-delete cases have the same safety semantics as Memory;
3. prior Diary lifecycle events are removed and exactly one content-free `permanent_delete` tombstone remains;
4. matching generic `mcp_write_idempotency` rows with `resourceType = diary_entry` remain untouched;
5. every directly linked `tool_calls` row for current `userId`, `resourceType = diary_entry`, and target `resourceId` is deleted before the Diary row is removed;
6. unrelated `tool_calls` rows remain;
7. replaying an old MCP write/idempotency key after permanent deletion does not recreate the Diary resource.

Run:

```bash
npx vitest run tests/database.test.ts tests/mcp-idempotency-enforcement.test.ts tests/mcp-observability.test.ts
```

### 2.2 Implement Diary permanent delete

Extend the Diary repository contract with an explicit permanent-delete operation.

Within one transaction:
1. run the existing active-user guard;
2. select by current `userId`, `id`, `status = archived`;
3. return existing not-found semantics with no mutation if ineligible;
4. preserve all generic `mcp_write_idempotency` matches;
5. delete `tool_calls` rows matching current `userId`, `resourceType = diary_entry`, and target `resourceId` so `request_summary`/`result_summary` cannot survive as detached content-bearing audit payloads;
6. delete prior lifecycle rows matching current user + `resourceType = diary` + target ID;
7. physically delete the exact eligible Diary row and require one deleted row;
8. fresh-read current user + ID without status filtering and fail if any row remains;
9. insert one minimal `permanent_delete` lifecycle tombstone with `WEB_USER_LIFECYCLE_CONTEXT` and `metadata = {}`;
10. commit only if all steps succeed.

Do not rely on the Diary FK's `ON DELETE SET NULL` for `tool_calls.resourceId`; the linked rows themselves must be deleted.

### 2.3 Verify and checkpoint

```bash
npx vitest run tests/database.test.ts tests/mcp-idempotency-enforcement.test.ts tests/mcp-observability.test.ts
```

Checkpoint after green:

```bash
git add src/domains/diary/diary-repository.ts tests/database.test.ts tests/mcp-idempotency-enforcement.test.ts tests/mcp-observability.test.ts
git commit -m "feat: add diary permanent delete cleanup"
```

---

## Task 3 — Task repository/domain permanent delete contract

**Files**
- Modify: `src/domains/task/task-repository.ts`
- Test: `tests/database.test.ts`
- Test: `tests/user-state-hardening.test.ts`

### 3.1 Add failing Task tests

Add cases proving:
1. an archived Task owned by the active current user can be permanently deleted;
2. active, wrong-owner, missing, disabled-user, and repeated-delete attempts do not mutate data and use existing error/not-found semantics;
3. prior Task lifecycle rows are removed;
4. exactly one minimal `permanent_delete` tombstone remains;
5. matching generic MCP idempotency rows with `resourceType = task` remain.

Run:

```bash
npx vitest run tests/database.test.ts tests/user-state-hardening.test.ts
```

### 3.2 Implement Task permanent delete

Extend the Task repository contract with an explicit permanent-delete operation.

Within one transaction:
1. run the active-user guard;
2. select by current `userId`, `id`, `lifecycleStatus = archived`;
3. return existing not-found semantics without mutation if no eligible row exists;
4. preserve generic `mcp_write_idempotency` rows;
5. delete prior lifecycle rows matching current user + `resourceType = task` + target ID;
6. physically delete the exact eligible Task and require one deleted row;
7. fresh-read current user + ID without lifecycle filtering and fail if any row remains;
8. insert one minimal `permanent_delete` lifecycle tombstone with `WEB_USER_LIFECYCLE_CONTEXT` and `metadata = {}`;
9. commit only on full success.

### 3.3 Verify and checkpoint

```bash
npx vitest run tests/database.test.ts tests/user-state-hardening.test.ts
```

Checkpoint after green:

```bash
git add src/domains/task/task-repository.ts tests/database.test.ts tests/user-state-hardening.test.ts
git commit -m "feat: add task permanent delete"
```

---

## Task 4 — Dedicated Web API endpoints without changing archive DELETE

**Files**
- Modify: `src/web-api/memory-router.ts`
- Modify: `src/web-api/diary-router.ts`
- Modify: `src/web-api/task-router.ts`
- Test: `tests/archive-restore-web-api.test.ts`
- Modify dependency/bootstrap wiring only where compile failures prove the new repository methods must be injected; keep that change narrowly scoped to the existing Web API composition path.

### 4.1 Add failing API contract tests

For each resource, add tests for:
- `DELETE /api/v1/memory/archived/:id/permanent`
- `DELETE /api/v1/diary/archived/:id/permanent`
- `DELETE /api/v1/task/archived/:id/permanent`

Prove:
1. successful owned archived deletion returns `204 No Content` with an empty body;
2. active/missing/wrong-owner targets use existing not-found mapping and do not mutate;
3. disabled-user behavior uses the existing mapping and does not mutate;
4. the same ID deleted twice returns existing not-found semantics on the second call;
5. no request body or Web idempotency key is required;
6. the existing ordinary resource `DELETE` routes still archive rather than physically delete;
7. existing restore endpoints still work for ordinary archived rows.

Run:

```bash
npx vitest run tests/archive-restore-web-api.test.ts
```

### 4.2 Implement route handlers

In each existing router:
- extend the existing dependency type with the corresponding permanent-delete domain/repository operation;
- add only the dedicated archived permanent route;
- use the existing authentication/current-user and error-mapping conventions;
- send `204` only after the domain operation has completed successfully;
- do not parse or require a request body;
- leave all existing archive/restore handlers and route semantics unchanged.

Do not add a generic `DELETE /:id` physical-delete path.

### 4.3 Verify and checkpoint

```bash
npx vitest run tests/archive-restore-web-api.test.ts
npm run build
```

Checkpoint after green:

```bash
git add src/web-api/memory-router.ts src/web-api/diary-router.ts src/web-api/task-router.ts tests/archive-restore-web-api.test.ts
git add <only-any-required-existing-web-api-composition-file>
git commit -m "feat: expose archived permanent delete api"
```

Replace the placeholder path in the `git add` command with a real modified composition file only if one was actually required; otherwise omit that line.

---

## Task 5 — Prove Search, Export, lifecycle-audit, and MCP read invariants

**Files**
- Test: `tests/global-search.test.ts`
- Test: `tests/export.test.ts`
- Test: `tests/mcp-archival.test.ts`
- Test: `tests/mcp-idempotency-enforcement.test.ts`
- Test: `tests/mcp-observability.test.ts`
- Production Search/Export/MCP files: modify only if a new invariant test exposes a real defect; canonical-table physical deletion should normally require no production change.

### 5.1 Add invariant tests

For representative Memory/Diary/Task deletes, prove after successful permanent deletion:
1. direct/archived resource reads cannot return the business row;
2. Global Search cannot return its business content;
3. business-resource Export cannot include it;
4. lifecycle-audit Export may include exactly the minimal `permanent_delete` tombstone and must not expose deleted title/content/tags in that event;
5. existing MCP read surfaces cannot return the deleted canonical row;
6. there is still no MCP permanent-delete tool/surface;
7. the retained generic MCP idempotency ledger prevents an old write key from silently recreating the deleted resource;
8. Diary's directly linked `tool_calls` are absent while unrelated audit rows remain.

Run:

```bash
npx vitest run tests/global-search.test.ts tests/export.test.ts tests/mcp-archival.test.ts tests/mcp-idempotency-enforcement.test.ts tests/mcp-observability.test.ts
```

If these pass with only test changes, do not modify Search/Export/MCP production code.

### 5.2 Checkpoint

After green:

```bash
git add tests/global-search.test.ts tests/export.test.ts tests/mcp-archival.test.ts tests/mcp-idempotency-enforcement.test.ts tests/mcp-observability.test.ts
git add <only-production-files-required-by-a-proven-gap>
git commit -m "test: verify permanent delete read invariants"
```

Omit the second `git add` if no production gap exists.

---

## Task 6 — Web archived-detail confirmation flow

**Files**
- Modify: `web/src/pages/MemoryPage.tsx`
- Modify: `web/src/pages/DiaryPage.tsx`
- Modify: `web/src/pages/TaskPage.tsx`
- Modify shared detail/action component or stylesheet only if the current page structure requires it; reuse existing components/classes before adding anything new.

There is no existing dedicated Web UI test script in `web/package.json`; do not introduce a new test framework for this feature. Verify the UI through typecheck/lint/build plus manual desktop/mobile acceptance.

### 6.1 Implement Memory archived-detail flow

On the archived Memory detail only:
- add `删除` beside the current Restore action in the existing top-right action area;
- reuse existing action styling;
- first click only enters local confirmation state; send no request yet;
- show concise irreversible-warning copy plus distinct `确认永久删除` and `取消` actions;
- on confirmation call `DELETE /api/v1/memory/archived/:id/permanent`;
- prevent duplicate submissions while pending;
- treat `response.status === 204` as success without calling `response.json()`;
- on success remove the record from archived client state and close the desktop detail dialog / return mobile detail to the archived list;
- on failure keep the item and current detail/confirmation context visible, using the page's existing error treatment.

### 6.2 Implement the same contract for Diary and Task

Use only their corresponding endpoints:
- `/api/v1/diary/archived/:id/permanent`
- `/api/v1/task/archived/:id/permanent`

Do not add controls to active detail views.

### 6.3 Static verification

From the repository root:

```bash
cd web
npm run lint
npm run build
cd ..
```

Fix only errors introduced by this feature.

### 6.4 Manual acceptance checklist

Check all three resource types in desktop and compact/mobile layouts:
- active detail: no permanent-delete control;
- archived detail: Restore and `删除` both present in the existing action area;
- first `删除`: no network DELETE yet;
- `取消`: returns to normal archived detail with no mutation;
- `确认永久删除`: one request only;
- pending state cannot double-submit;
- `204`: no JSON parsing error, item disappears, detail closes/returns to list;
- API failure: item stays visible and confirmation/detail remains recoverable;
- Restore still works unchanged.

Checkpoint after lint/build and manual review:

```bash
git add web/src/pages/MemoryPage.tsx web/src/pages/DiaryPage.tsx web/src/pages/TaskPage.tsx
git add <only-shared-component-or-style-files-actually-required>
git commit -m "feat(web): add archived permanent delete confirmation"
```

---

## Task 7 — Full regression, scope audit, and handoff

### 7.1 Run focused permanent-delete suites

```bash
npx vitest run tests/archive-restore-web-api.test.ts tests/memory.test.ts tests/user-state-hardening.test.ts
npx vitest run tests/database.test.ts tests/global-search.test.ts tests/export.test.ts tests/mcp-archival.test.ts tests/mcp-idempotency-enforcement.test.ts tests/mcp-observability.test.ts
```

### 7.2 Run full deterministic gates

```bash
npm test
npm run build
cd web
npm run lint
npm run build
cd ..
git diff --check
git status --short
```

All must pass/clean except intentional uncommitted work being reviewed at that exact moment.

### 7.3 Audit the branch against main

```bash
git diff --name-only origin/main...HEAD
git log --oneline --decorate origin/main..HEAD
```

Inspect the file list and reject any accidental changes to:
- MCP tool registration/schema/permissions/delete surface;
- Todo, Universe, or Notion implementation;
- database migrations/schema unrelated to the already-existing audit structures;
- ordinary archive/restore semantics;
- unrelated UI or refactors.

Also explicitly search the final diff for the two critical invariants:
- `mcp_write_idempotency` is never deleted by permanent-delete code;
- Diary permanent delete removes matching `tool_calls` before the business row deletion.

### 7.4 Final implementation report

Before opening or merging a PR, report:
- branch head SHA;
- changed-file list;
- focused test results;
- full `npm test`, root build, Web lint/build, and `git diff --check` results;
- confirmation that there is no MCP delete surface/schema migration/unrelated scope;
- confirmation that retained MCP idempotency and Diary `tool_calls` cleanup match the approved design;
- any deviations from this plan, with exact reason and evidence.

Stop before merge. Follow the repository's normal PR and expected-head merge governance only after review/approval.
