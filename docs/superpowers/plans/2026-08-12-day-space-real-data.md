# Day Space Real Data Implementation Plan

**Goal:** Replace Day Space prototype/localStorage data with authenticated, server-backed Todo + Diary composition while preserving the accepted Day Space UI, Todo revision semantics, Diary author rules, deterministic paper layout, and explicit partial-failure behavior.

**Architecture:** Day Space remains a Web composition view. Diary owns new narrow exact-date/date-discovery reads through `DiaryService -> DiaryRepository -> diary_entries`; Todo reuses the already accepted Package B API. The Web client loads the two modules independently, composes successful results into the existing layout, and keeps module-scoped refresh/error state. There is no Day Space backend domain, aggregate endpoint, table, repository, service, or migration.

**Tech stack:** TypeScript, React, React Router, existing `WebApiClient`, Express, Drizzle ORM/PostgreSQL, Node test runner + JSDOM where behavioral mounting is required.

## Global constraints

- Frozen design source of truth: `docs/superpowers/specs/2026-08-10-day-space-real-data-design.md` on this branch. It is the unchanged approved design from commit `2da38e1c6c787f4efbb8f201d86a89874f658599`.
- Accepted production code baseline: `45b836641c4b79f5b69f36c647ed296ba485c117` on `codex/phase-6-web-ui-foundation`.
- This implementation branch: `feat/day-space-real-data`.
- Documentation bootstrap commit restoring the frozen spec: `3f355addd31a468366492bd904d33f7c7f4f46dc`.
- Current migration head: `drizzle/0016_todo_foundation.sql`.
- **No database migration in this package.** Do not modify `drizzle/`, `src/database/schema.ts`, or production DB state.
- Do not add `DaySpaceService`, `DaySpaceRepository`, Day Space persistence, or `/api/v1/day-space/*`.
- Day Space contains exactly Todo + Diary. Do not add Memory or Task.
- Do not add create controls, Calendar markers, Global Search integration, MCP changes, PWA changes, Safari/P0 work, or unrelated visual redesign/refactors.
- Todo must reuse the accepted Package B read/write/revision/conflict contract. Do not fork Todo persistence or read localStorage as Day Space truth.
- Diary author follows Package A: `L | G | null` on reads; content edits require explicit L/G; never infer legacy-null author.
- Use TDD for each behavioral change. Write a failing test first, verify the failure is for the intended reason, implement the smallest change, rerun green, then commit the task.
- Keep one implementation branch/worktree for all tasks. Separate task commits are encouraged; do not create a branch per task.
- Stop before production deployment. The final report must say `PRODUCTION_TOUCHED=NO`.

---

## Task 1: Add complete Diary content-date and exact-date domain reads

**Files:**
- Modify: `src/domains/diary/diary-repository.ts`
- Modify: `src/domains/diary/diary-service.ts`
- Modify: `tests/diary-service.test.ts`
- Modify: `tests/diary-repository.integration.test.ts`

### Step 1: Write failing repository/service tests

Add tests proving all frozen contracts:

1. content dates are unique and descending;
2. only `active` Diary rows contribute dates;
3. an archived-only date is absent;
4. an active legacy `author = null` Diary still contributes its date;
5. queries are user-scoped;
6. exact-date read returns every active Diary for that user/date;
7. exact-date read excludes archived rows and other users;
8. exact-date read preserves `id`, `title`, `content`, `date`, `author`, `tags`, `mood`, `created_at`, `updated_at`;
9. exact-date read is not truncated at the generic Diary MAX_LIMIT (seed >100 matching active rows in disposable PostgreSQL and assert every row is returned);
10. strict invalid calendar dates such as `2026-02-30` are rejected by the service before repository use.

Use real PostgreSQL integration coverage for the no-truncation/user/lifecycle query semantics rather than a source-regex assertion.

### Step 2: Run RED

Run the focused service and Diary repository integration tests using the repository's existing disposable/test PostgreSQL pattern. Confirm the new tests fail because the methods/contracts do not exist yet.

### Step 3: Implement the narrow repository methods

Extend `DiaryRepository` and `DrizzleDiaryRepository` with explicit unpaginated methods, for example:

```ts
listActiveContentDates(userId: string): Promise<string[]>;
findActiveByDate(userId: string, date: string): Promise<DiaryEntryRecord[]>;
```

Required query behavior:

- filter by authenticated `userId` and `status = active`;
- content dates use distinct Diary business `date`, sorted descending;
- exact-date rows filter by exact business `date` and return all matches without `.limit(...)`;
- use a deterministic order for same-day rows, consistent with current Diary ordering (`created_at DESC` plus a stable id tie-breaker where needed).

Do not widen or change the existing generic list limit.

### Step 4: Implement DiaryService methods

Add narrow service methods that:

- require an active authenticated user through the existing user guard;
- reuse the existing strict real-calendar date normalization/validation logic;
- map repository records through the same public Diary result shape, preserving nullable author, tags, mood, and timestamps.

Do not create a Day Space service abstraction.

### Step 5: Run GREEN and commit

Run the focused unit + disposable DB tests until green.

Suggested commit:

```text
feat: add complete Diary date reads
```

---

## Task 2: Expose Diary-owned `/dates` and `/by-date/:date` Web API routes

**Files:**
- Modify: `src/web-api/diary-router.ts`
- Modify: `tests/diary-api.test.ts`

### Step 1: Write failing API tests

Cover:

- unauthenticated requests return 401;
- `GET /api/v1/diary/dates` calls only the authenticated user's content-date service method and returns `{ dates }`;
- `GET /api/v1/diary/by-date/2026-08-12` returns the exact-date payload with all fields required by Day Space;
- invalid date such as `2026-02-30` fails safely through the existing Diary domain-error mapping;
- literal `GET /diary/dates` and `GET /diary/by-date/:date` are not swallowed by `GET /diary/:id`;
- existing `GET /diary/:id`, generic list, archive, restore, create, and update contracts remain unchanged.

### Step 2: Run RED

Run `tests/diary-api.test.ts` and confirm the new route tests fail for the expected missing-route/dependency reason.

### Step 3: Implement routes with correct precedence

Extend `DiaryApiDependencies` only with the new Diary service methods.

Register these **before** `router.get("/:id", ...)`:

```text
GET /dates
GET /by-date/:date
```

Keep user identity exclusively from `request.webUserId`; do not accept `user_id` from query/body/path.

Use the existing safe Diary error mapping. Do not leak DB/private errors.

### Step 4: Run GREEN and commit

Suggested commit:

```text
feat: expose Diary exact-date reads
```

---

## Task 3: Add typed Day Space Web data helpers and injectable page container

**Files:**
- Create: `web/src/pages/day-space-api.ts`
- Create: `web/src/pages/day-space-data.ts`
- Create: `web/src/pages/DaySpacePageContainer.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/pages/day-space-location.ts` only if a small pure resolver belongs there; do not overload it with React state
- Modify: `tests/day-space-location.test.ts`
- Create: `tests/day-space-data.test.ts`

### Step 1: Define Web-owned read/write shapes without duplicating backend domains

Create a narrow Diary Web shape containing the durable fields Day Space must preserve:

```ts
type DaySpaceDiary = {
  id: string;
  title: string;
  content: string;
  date: string;
  author: "L" | "G" | null;
  tags: string[];
  mood: string | null;
  created_at: string;
  updated_at: string;
};
```

`day-space-api.ts` may own only the small client wrappers needed by this surface:

- list Diary content dates;
- load all Diary rows by exact date;
- update one Diary through the existing `PATCH /diary/:id` contract.

For Todo, import/reuse `listTodoDates`, `loadTodoDay`, and the existing `TodoPaperDialog`/Todo API. Do not duplicate Todo request code.

### Step 2: Write pure default-date-resolution tests

Create a typed resolver for the no-explicit-date discovery result and test exactly:

1. both discovery sources succeed, union nonempty -> latest union, complete discovery;
2. both succeed empty -> browser-local today, complete discovery;
3. Todo succeeds nonempty, Diary fails -> Todo latest, discovery incomplete;
4. Diary succeeds nonempty, Todo fails -> Diary latest, discovery incomplete;
5. one succeeds empty, other fails -> today, discovery incomplete, not global-empty truth;
6. both fail -> unresolved/failure, no silent today fallback.

Keep existing strict `YYYY-MM-DD` explicit-date parsing and local business-date navigation tests.

Remove the Day Space-specific test that treats `listPersistedTodoPaperDates(localStorage)` as date discovery. The storage helper can keep its own Package B tests; Day Space must not use it.

### Step 3: Add API injection boundary

Create `DaySpacePageContainer.tsx` following existing `DiaryPageContainer`/`DashboardPageContainer` style:

```tsx
const api = useWebApiClient();
return <DaySpacePageContent api={api} />;
```

Change `App.tsx` to route through the container. Export a testable `DaySpacePageContent` from `DaySpacePage.tsx` in the later task.

### Step 4: Run focused tests and commit

Suggested commit:

```text
refactor: prepare Day Space real-data composition
```

---

## Task 4: Replace Day Space initial/date loading with independent real Todo + Diary orchestration

**Files:**
- Modify: `web/src/pages/DaySpacePage.tsx`
- Modify: `web/src/pages/day-space-data.ts`
- Create: `tests/day-space-real-data.test.ts`
- Modify: `tests/day-space-mobile-page.test.ts`
- Preserve: `web/src/pages/day-space-layout.ts`

### Step 1: Write mounted behavioral tests first

Use JSDOM + React mounting with a controllable `WebApiClient` and route/location. Avoid source-regex as the primary proof for async behavior.

Cover the initial-date contract:

- valid explicit `?date=YYYY-MM-DD` starts exact-date Todo + Diary reads directly and makes **zero** `/todo/dates` or `/diary/dates` discovery calls;
- invalid explicit date behaves like no valid explicit date and uses real discovery, never prototypes;
- Todo and Diary discovery start independently/concurrently;
- every full/partial/both-fail discovery combination from Task 3 is reflected correctly;
- both discovery failures show retry/failure and do not silently route/render today as trustworthy default.

Cover selected-date reads:

- Todo + Diary exact-date reads start independently for the selected date;
- one source failure preserves the other source's successful real papers and shows partial/incomplete state;
- both failures show failure/retry, not empty;
- “这一天还没有内容” appears **only** when both exact-date reads succeeded and both produce no visible papers;
- switching date clears the previous date's displayed papers while new reads are pending;
- a slow success or failure from an older selected date cannot overwrite the newer date (generation id and/or AbortController behavior must be mounted and demonstrated);
- multiple same-day Diary records render as independent papers;
- active Diary `author = null` remains visible with `—`;
- missing or durable-empty Todo papers are omitted;
- stable paper ids are exactly `diary:${id}` and `todo:${businessDate}:${author}` and do not collide.

### Step 2: Implement explicit module state

Model Todo and Diary separately, with enough state to distinguish at minimum:

- loading;
- success/known data;
- initial selected-date failure;
- post-save refresh-needed/failure (later tasks);
- retry.

Keep discovery incompleteness logically separate from selected-date partial failure even if they share a compact visual warning primitive.

### Step 3: Implement race-safe orchestration

- Use the explicit URL date immediately when valid.
- Otherwise perform both date-discovery requests concurrently and resolve via the tested pure resolver.
- For each selected date, initiate exact-date Todo + Diary reads independently.
- Use `AbortController`, request generation ids, or both. `WebApiClient.request` accepts standard `RequestInit`, including `signal`.
- On date change, invalidate the old generation before applying any response.
- Do not render old date papers under the new date while pending.

### Step 4: Compose only successful real data

- Diary: each active returned row becomes one paper.
- Todo: only L/G papers whose `entries.length > 0` become visible papers.
- Keep the accepted deterministic `layoutDaySpacePapers` algorithm, density heuristics, ellipsis treatment, paper styling, date navigation, and no-create-CTA design.
- Do not alter the date picker into a marker calendar.

### Step 5: Run tests and commit

Suggested commit:

```text
feat: load real Day Space data
```

---

## Task 5: Make Day Space Diary editing persist the durable Diary record safely

**Files:**
- Modify: `web/src/pages/DaySpaceDiaryDialog.tsx`
- Modify: `web/src/pages/DaySpacePage.tsx`
- Modify: `web/src/pages/day-space-api.ts`
- Use: `web/src/pages/PaperAuthorSignature.tsx`
- Use existing paper/editor primitives rather than creating a parallel visual system
- Create: `tests/day-space-diary-dialog-server.test.ts`
- Extend: `tests/day-space-real-data.test.ts`

### Step 1: Write RED tests for the dialog

Cover:

- initial values come from the real durable Diary record;
- editable fields are exactly title, content, author;
- date is known/displayed but cannot be edited here;
- tags and mood are not editable;
- save payload preserves the loaded durable `date`, `tags`, and `mood` exactly;
- authored records may deliberately change L <-> G;
- legacy-null author displays `—` and a changed content draft cannot save until L/G is selected;
- a bypassed/server `AUTHOR_REQUIRED` remains an inline save failure rather than closing or silently guessing author;
- one in-flight mutation gate prevents duplicate PATCHes;
- unsaved-change close protection remains;
- failed persistence keeps the dialog/draft available for retry.

### Step 2: Replace prototype/local callback persistence with the existing Diary PATCH

The dialog/page must call the existing Diary update contract with the full content payload required by that endpoint:

```ts
{
  title,
  content,
  author,
  date: loaded.date,
  tags: loaded.tags,
  mood: loaded.mood,
}
```

Use `PaperAuthorSignature` for editable L/G/null-author presentation. Never infer author.

### Step 3: Implement successful-save reconciliation semantics

On PATCH success:

1. treat the committed response as immediate known server truth and patch the edited record in current Diary state;
2. close/complete the accepted dialog interaction;
3. re-read **Diary only** for the currently selected date;
4. do not reload Todo solely because Diary changed.

If the Diary re-read fails after the successful PATCH:

- retain the committed record in the visible Diary data;
- mark Diary as needing retry/incomplete reconciliation;
- do not erase the successful save;
- do not call that locally retained module snapshot fully refreshed truth.

Mounted tests must prove this behavior and that Todo successful state survives a Diary failure.

### Step 4: Run tests and commit

Suggested commit:

```text
feat: persist Day Space Diary edits
```

---

## Task 6: Reuse Package B Todo editor with loaded paper/revision and module-scoped refresh

**Files:**
- Modify: `web/src/pages/DaySpacePage.tsx`
- Reuse without semantic fork: `web/src/pages/TodoPaperDialog.tsx`
- Reuse: `web/src/pages/todo-api.ts`
- Extend: `tests/day-space-real-data.test.ts`
- Existing Todo tests remain authoritative for dialog/editor conflict internals

### Step 1: Write integration RED tests

Cover:

- opening a visible L/G Day Space Todo passes the actual loaded `TodoPaper` and `api` to `TodoPaperDialog`, not legacy `entries`/localStorage fallback;
- save uses the loaded paper `revision` via Package B's existing complete-paper PUT;
- successful Todo save updates the committed paper immediately, then re-reads **Todo only** for the selected date;
- Diary is not reloaded because Todo changed;
- a successful edit that yields `entries: []` removes the Todo card while staying on the same selected date;
- if the post-save Todo re-read fails, preserve the just-committed paper as known server truth and expose Todo retry/incomplete reconciliation without erasing successful Diary state;
- `409 TODO_PAPER_CONFLICT` does not trigger an automatic Day Space refresh/overwrite and the existing dialog remains responsible for preserving draft + inline conflict.

Do not reimplement the conflict algorithm inside Day Space. Existing `TodoPaperDialog` behavior already preserves dirty edits and only calls `onSaved` after an actual commit.

### Step 2: Wire actual Package B data into the existing dialog

Pass:

- `api`;
- selected business date;
- author;
- loaded `paper` including revision;
- existing trigger ref;
- `onSaved(committedPaper)` reconciliation callback.

Do not use Day Space `entries` compatibility props as persistence truth.

### Step 3: Run tests and commit

Suggested commit:

```text
feat: persist Day Space Todo edits
```

---

## Task 7: Remove Day Space runtime prototype/localStorage fallback and preserve accepted visual invariants

**Files:**
- Modify: `web/src/pages/DaySpacePage.tsx`
- Delete if no longer referenced: `web/src/pages/day-space-prototype-data.ts`
- Modify: `tests/day-space-mobile-page.test.ts`
- Modify: `tests/day-space-v2-regression.test.ts`
- Modify: `tests/day-space-v3-polish.test.ts` only if mechanical assertions require adaptation
- Preserve: `web/src/pages/day-space-layout.ts`
- Preserve Package B Home migration/storage files unless independently required by Home

### Step 1: Add/adjust regression assertions

Assert Day Space runtime no longer imports or calls:

- `DAY_SPACE_DIARY_PROTOTYPES`;
- `DAY_SPACE_TODO_SEEDS`;
- `getDaySpacePrototypeDates`;
- `listPersistedTodoPaperDates`;
- `readTodoPaperEntries`;
- `window.localStorage` as a Day Space read source.

Do not delete Package B Home legacy migration/storage support merely because Day Space stops consuming it.

### Step 2: Update visual regression inputs to stable real-data ids

Current older tests use ids like `todo:L:2026-08-05`. Update those test-only layout ids to the frozen real-data convention:

```text
todo:2026-08-05:L
todo:2026-08-05:G
```

Keep the layout algorithm unchanged and rerun overlap/scatter tests.

### Step 3: Preserve UI scope

Regression tests must still prove:

- active `/day-space` route + navigation destination;
- accepted `memory-page-heading`/title primitive;
- no create CTA;
- plain date picker with no content markers;
- Todo and Diary share one scatter stage;
- signatures are displayed;
- no redundant paper type labels;
- existing ellipsis/no-fade treatment;
- no ruled-paper texture/custom giant editor regression.

If `day-space-prototype-data.ts` has no remaining runtime or test use, delete it. If any isolated test fixture remains useful, move it under tests rather than leaving a production runtime fixture module that can be accidentally reintroduced.

### Step 4: Run all Day Space + Todo + Diary focused tests and commit

Suggested commit:

```text
chore: remove Day Space prototype fallback
```

---

## Task 8: Final package integration, self-review, and stop-before-production gates

**Files:**
- No scope expansion; only corrections required by failing package tests/review

### Step 1: Run focused package suite

At minimum run all:

```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/day-space-*.test.ts \
  tests/diary-api.test.ts \
  tests/diary-service.test.ts \
  tests/todo-api.test.ts \
  tests/todo-home-api.test.ts \
  tests/todo-paper-dialog-server.test.ts
```

Run Diary repository integration against a disposable/test PostgreSQL instance and include the >100 same-date no-truncation case. Never point integration tests at production.

### Step 2: Run deterministic full gates

```bash
pnpm exec tsx --test --test-concurrency=1 tests/**/*.test.ts
pnpm typecheck
pnpm build
(cd web && npm run typecheck)
(cd web && npm run build)
git diff --check
```

Use the repository's actual package manager command if Web scripts are invoked through the workspace; do not create or update lockfiles unnecessarily.

### Step 3: Perform scope and invariant audit against the frozen spec

Freshly review `BASE..HEAD` and explicitly confirm:

- no files under `drizzle/` changed;
- `src/database/schema.ts` unchanged;
- migration head remains `0016_todo_foundation.sql`;
- no Day Space backend service/repository/table/aggregate route was introduced;
- no MCP files changed;
- no PWA-specific branch/service-worker scope changes;
- no Calendar marker implementation;
- no Memory/Task Day Space composition;
- no Day Space create CTA;
- no runtime prototype/localStorage fallback;
- Todo still uses Package B APIs/revision/conflict behavior;
- Diary hidden fields are preserved on Day Space update;
- partial/error/true-empty semantics match the frozen design;
- no production secrets in diff/logs;
- working tree clean.

### Step 4: Self-review behavioral edge cases

Before final handoff, deliberately inspect/test these failure sequences rather than relying only on happy-path snapshots:

1. explicit date with one selected source failing;
2. both discovery sources failing;
3. date A request resolves after navigation to date B;
4. Diary PATCH succeeds but Diary re-read fails;
5. Todo PUT succeeds but Todo re-read fails;
6. Todo conflict occurs while Diary data is successfully visible;
7. legacy-null Diary title/content edit before author selection;
8. emptying the only Todo on a date while Diary is empty — remain on same date and show true empty only after both module states are trustworthy.

### Step 5: Commit any narrowly required corrections, push feature branch, and stop

Do not merge or deploy production.

Final report must include:

```text
BRANCH=feat/day-space-real-data
BASE=45b836641c4b79f5b69f36c647ed296ba485c117
FINAL_SHA=<sha>
MIGRATION_HEAD=0016_todo_foundation.sql
DATABASE_MIGRATION_ADDED=NO
PRODUCTION_TOUCHED=NO
```

Also report:

- commit list;
- changed files;
- focused Day Space/Diary/Todo test counts;
- disposable PostgreSQL integration result;
- deterministic full-suite count/pass/skip/fail;
- root typecheck/build;
- Web typecheck/build;
- `git diff --check`;
- scope/invariant audit result;
- any unresolved discrepancy from the frozen spec.

---

## Implementation notes for Codex

- Read the frozen spec completely before Task 1 and re-read it before Task 8 self-review.
- The final production code already has Package B Todo APIs at `/todo/dates`, `/todo/:date`, and `PUT /todo/:date/:author`; bind to those actual types rather than the older prototype model.
- The current Day Space runtime still reads Todo seeds/localStorage and keeps Diary prototypes in local state. Removing that path is intentional; do not preserve it as a fallback.
- `WebApiClient.request` accepts `RequestInit`, so `AbortController.signal` may be used without changing the shared API client contract.
- `layoutDaySpacePapers` already sorts deterministically by stable id/hash; real-data composition should supply stable ids and leave the algorithm alone.
- Existing `TodoPaperDialog` already owns one-in-flight save gating and `TODO_PAPER_CONFLICT` inline behavior. Day Space should integrate with it rather than wrapping it in a second mutation/conflict implementation.
- Existing Diary generic listing is capped; the new exact-date repository/service path must bypass that cap by design.
- If actual accepted A/B APIs differ in naming but preserve the frozen semantics, adapt the plan to the real API. If a semantic dependency has materially changed, stop and report the discrepancy instead of silently inventing compatibility behavior.
