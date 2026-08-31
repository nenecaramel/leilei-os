# Desktop Page Unification Implementation Plan

> **Execution:** Use `superpowers:subagent-driven-development` for implementation, with an independent implementer and task review for each task, followed by a whole-branch review. Use `superpowers:using-git-worktrees` before touching product code and `verification-before-completion` before reporting completion.

**Goal:** Bring Memory, Diary, Task, Day Space, and Global Search into the production-accepted desktop visual system in one low-risk batch where practical, while preserving mobile behavior and all product/domain semantics. Universe is regression-only except for already-shared outer shell behavior; do not redesign its internals.

**Architecture:** Keep the accepted `AppShell` / shared `NavigationPanel` untouched. Add one desktop-only page presentation layer, `web/src/desktop-page-unification.css`, imported after the accepted shell/navigation foundation and before feature-specific correction styles. Reuse the already-accepted compact paper presentation instead of inventing another desktop design. Memory and Global Search should remain markup/behavior-stable and receive desktop CSS only. Diary and Task currently fork into modern mobile paper presentation versus legacy desktop presentation; refactor those render paths so the modern paper presentation is the common presentation while retaining genuinely mobile-only behavior conditions. Day Space stays structurally unique and gets outer-frame/surface/spacing alignment only if that is safely achievable without interaction or structural changes; otherwise defer it from this batch.

**Tech stack:** React 19, TypeScript, Vite, React Router, existing CSS architecture, Node `tsx` test runner, pnpm.

**Starting point:** `main` at `161eb988f39afe78f82132e844abbaf388dea1d8` (PR #260 merge). Implementation branch should be `style/desktop-page-unification` in an isolated worktree.

## Non-negotiable boundaries

- Do not modify the accepted desktop/mobile navigation visual system (`NavigationPanel`, sidebar geometry/content, mobile drawer behavior).
- Do not redesign Home, Sentinel, or any System page; they are visual references/regression surfaces.
- Do not change Domain, API, database, migrations, Auth0, MCP, routing, ownership/visibility, lifecycle, CAS/idempotency, or durable-data semantics.
- Mobile at 320px and 390px is protected behavior and presentation.
- Do not target `.universe-*` in the new page-unification stylesheet and do not touch Universe internal presentation, known small errors, or dark identity.
- Do not add more desktop override piles to `web/src/styles.css`; new batch styling belongs in `web/src/desktop-page-unification.css`.
- Keep feature-specific correction styles later in the import order so accepted targeted corrections can still win.
- If Day Space needs component restructuring, interaction changes, or domain behavior changes to look right, defer it instead of expanding this batch.

## Task 1: Establish the isolated desktop page-unification layer

**Files:**
- Create: `tests/desktop-page-unification.test.ts`
- Create: `web/src/desktop-page-unification.css`
- Modify: `web/src/main.tsx`

### Step 1: Write the failing architecture regression

Create `tests/desktop-page-unification.test.ts` using source-level assertions consistent with the existing desktop shell tests. It must assert all of the following:

1. `web/src/main.tsx` imports the new stylesheet immediately after `./layout/navigation-panel.css`.
2. `web/src/desktop-page-unification.css` contains only desktop rules under `@media (min-width: 761px)`.
3. It contains scoped selectors for the intended page families: `.memory-page`, `.diary-page`, `.task-page`, `.day-space-page`, `.global-search-page`.
4. It does **not** contain `.universe-`, `.sidebar`, `.navigation-panel`, or any `@media (max-width` rule.
5. It does not redefine `.app-shell` or mobile drawer/topbar classes.

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test tests/desktop-page-unification.test.ts
```

Expected: FAIL because the stylesheet/import do not exist yet.

### Step 2: Add the smallest desktop-only layer

In `web/src/main.tsx`, import in this order:

```ts
import "./styles.css";
import "./desktop-foundation.css";
import "./layout/navigation-panel.css";
import "./desktop-page-unification.css";
```

Create `web/src/desktop-page-unification.css` with a single `@media (min-width: 761px)` block and only target-page selectors. Start with shared neutral page variables/helpers only as needed; do not prematurely style every page in this task.

### Step 3: Make the test green and verify shell isolation

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test \
  tests/desktop-page-unification.test.ts \
  tests/desktop-shell-foundation.test.ts \
  tests/desktop-sidebar-mobile-parity.test.ts \
  tests/app-shell-mobile.test.ts \
  tests/universe-home-dark-surface.test.ts
pnpm --dir web typecheck
```

Expected: PASS.

### Step 4: Commit

```bash
git add tests/desktop-page-unification.test.ts web/src/desktop-page-unification.css web/src/main.tsx
git commit -m "style: add desktop page unification layer"
```

## Task 2: Align Memory and Global Search through CSS only

**Files:**
- Modify: `tests/desktop-page-unification.test.ts`
- Modify: `web/src/desktop-page-unification.css`
- Read but do not change unless a test proves unavoidable: `web/src/pages/MemoryPage.tsx`, `web/src/pages/MemoryPageHeader.tsx`, `web/src/pages/GlobalSearchPage.tsx`, `web/src/pages/GlobalSearchPageHeader.tsx`

### Step 1: Extend the failing desktop-presentation assertions

Add assertions that require the desktop stylesheet to provide the compact paper language to Memory and Global Search without route-specific global hacks. Cover durable properties rather than pixels:

- page headers use the sans system stack / restrained hierarchy rather than the old Newsreader hero treatment;
- filter/search surfaces are flat white/light-neutral with restrained borders and radii;
- list rows/results remain row-oriented and do not become oversized legacy cards;
- desktop content stays bounded and fluid inside the accepted `.page` frame;
- no green theme token is used as the default surface/focus/accent for these page families.

Run the new test and confirm RED.

### Step 2: Implement Memory desktop paper parity

In `desktop-page-unification.css`, style existing Memory markup only. Preserve all JSX and behavior. Target the existing page/header/filter/list/detail paper classes beneath `.memory-page`.

Desktop intent:

- same visual language as accepted compact/mobile Memory: system sans, black/gray text, flat white surfaces, fine borders, modest radius;
- header and actions remain compact, not a large editorial hero;
- search/category/tag controls read as one quiet tool surface rather than a giant legacy panel;
- month groups and `.memory-row` remain readable paper/list rows with bounded text measure;
- archived/detail/create/edit behavior and dialogs are untouched.

Do not alter API calls, filters, history, scroll restoration, archive/delete flows, author metadata, or mutation gates.

### Step 3: Implement Global Search desktop paper parity

Style the existing all-width modern markup (`.global-search-page`, `.global-search-page-header`, `.global-search-compact-form`, `.global-search-domain-list`, `.search-result-list`) for desktop. Do not restructure search logic.

Desktop intent:

- compact search header and form, not an oversized hero;
- domain filters and result rows use the same neutral paper language as Memory;
- long-result content remains bounded/readable;
- existing loading/empty/error spacing semantics remain intact.

### Step 4: Focused regression

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test \
  tests/desktop-page-unification.test.ts \
  tests/memory-page.test.ts \
  tests/memory-list-styles.test.ts \
  tests/memory-paper-styles.test.ts \
  tests/memory-visual-acceptance.test.ts \
  tests/mobile-memory-diary-final-polish.test.ts \
  tests/mobile-memory-diary-final-visual-round.test.ts \
  tests/mobile-memory-diary-final-visual-round-v3.test.ts \
  tests/global-search-mobile-redesign.test.ts \
  tests/global-search-state-spacing.test.ts \
  tests/global-search-web.test.ts \
  tests/global-search-long-content.test.ts \
  tests/global-search.test.ts
pnpm --dir web typecheck
```

Expected: PASS.

### Step 5: Commit

```bash
git add tests/desktop-page-unification.test.ts web/src/desktop-page-unification.css
git commit -m "style: align memory and search desktop presentation"
```

## Task 3: Reuse Diary's paper presentation on desktop

**Files:**
- Modify: `tests/desktop-page-unification.test.ts`
- Modify: `web/src/pages/DiaryPage.tsx`
- Modify: `web/src/desktop-page-unification.css`
- Keep behavior contract of: `web/src/pages/DiaryPageHeader.tsx`, `web/src/pages/DiaryPaperEditor.tsx`, detail/dialog/filter/history utilities

### Step 1: Write a failing common-presentation regression

Add source assertions proving Diary no longer has two unrelated presentation systems. The regression should require:

- desktop can render the same `DiaryPageHeader` / paper list presentation used by the current modern branch;
- the legacy desktop `PageHeader` with `eyebrow="Personal journal"` is gone;
- the old desktop-only `quiet-panel` search/filter presentation is no longer the primary Diary render path;
- no test requires `isMobile` to be artificially forced true.

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test tests/desktop-page-unification.test.ts
```

Expected: FAIL on current branch.

### Step 2: Refactor presentation, not behavior

In `DiaryPage.tsx`, collapse the visual fork so the modern paper presentation is the common presentation at all widths. Preserve `isMobile` only where it controls genuinely mobile-specific interaction/geometry, if any. Do not duplicate the mobile branch into a second desktop copy and do not set/fake `isMobile = true`.

Preserve exactly:

- list/detail/archive routes and return targets;
- search/filter/history and scroll restoration;
- create/edit/archive/restore/permanent-delete flows;
- unsaved-change protection, submission/mutation gates;
- author/mood/tags/date semantics;
- existing dialog behavior.

Use desktop CSS to let the common paper markup fit the wide content frame naturally.

### Step 3: Run Diary regressions

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test \
  tests/desktop-page-unification.test.ts \
  tests/diary-page.test.ts \
  tests/diary-mobile-page.test.ts \
  tests/diary-mobile-styles.test.ts \
  tests/diary-page-header.test.ts \
  tests/diary-memory-visual-consistency.test.ts \
  tests/mobile-memory-diary-final-polish.test.ts \
  tests/mobile-memory-diary-final-visual-round.test.ts \
  tests/mobile-memory-diary-final-visual-round-v3.test.ts \
  tests/mobile-diary-date-rounded-surface.test.ts \
  tests/mobile-diary-date-vertical-centering.test.ts
pnpm --dir web typecheck
```

Expected: PASS.

### Step 4: Commit

```bash
git add tests/desktop-page-unification.test.ts web/src/pages/DiaryPage.tsx web/src/desktop-page-unification.css
git commit -m "style: reuse diary paper presentation on desktop"
```

## Task 4: Reuse Task's paper presentation on desktop

**Files:**
- Modify: `tests/desktop-page-unification.test.ts`
- Modify: `web/src/pages/TaskPage.tsx`
- Modify: `web/src/desktop-page-unification.css`
- Preserve behavior contract of Task detail/filter/lifecycle/date helpers

### Step 1: Write the failing common-presentation regression

Require that Task's modern `TaskPageHeader` / paper-group presentation is common to desktop, and that the old desktop `PageHeader` with `eyebrow="Execution queue"` plus legacy large-panel presentation is removed from the primary render path. Again, do not make the test depend on pretending the viewport is mobile.

Run the new test and confirm RED.

### Step 2: Refactor Task visual branching only

Collapse the visual fork in `TaskPage.tsx` so the paper presentation is shared across desktop/mobile. Retain `isMobile` only for genuinely mobile-specific behavior if necessary.

Preserve exactly:

- task list/detail/archive/location/history behavior;
- status transitions/reopen/later handling;
- date/time/timezone rules;
- tags and filters;
- create/edit/archive/restore/permanent-delete semantics;
- mutation/submission guards and unsaved-change behavior.

Use desktop CSS for wide layout rather than creating a second desktop component tree.

### Step 3: Run Task regressions

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test \
  tests/desktop-page-unification.test.ts \
  tests/task-detail-view.test.ts \
  tests/task-filter-history.test.ts \
  tests/task-list-request.test.ts \
  tests/task-location.test.ts \
  tests/task-mobile-redesign.test.ts \
  tests/task-mobile-visual-polish.test.ts \
  tests/task-mobile-acceptance-round2.test.ts \
  tests/task-mobile-acceptance-round3.test.ts \
  tests/task-mobile-acceptance-round4.test.ts \
  tests/task-paper-date-parity.test.ts
pnpm --dir web typecheck
```

Expected: PASS.

### Step 4: Commit

```bash
git add tests/desktop-page-unification.test.ts web/src/pages/TaskPage.tsx web/src/desktop-page-unification.css
git commit -m "style: reuse task paper presentation on desktop"
```

## Task 5: Align Day Space outer frame only, or explicitly defer it

**Files:**
- Modify only if safe: `tests/desktop-page-unification.test.ts`, `web/src/desktop-page-unification.css`
- Read-only by default: `web/src/pages/DaySpacePage.tsx`, `web/src/pages/DaySpaceDatePicker.tsx`, `web/src/pages/DaySpaceDiaryDialog.tsx`

### Step 1: Make a bounded implementation decision

Inspect the rendered component structure and existing Day Space tests. The allowed implementation is CSS-only outer presentation:

- `.day-space-page` wide frame rhythm;
- `.day-space-header` typography/spacing;
- `.day-space-stage` outer spacing/surface alignment;
- restrained neutral treatment around the existing rail/context/panels where it can be done without changing interactions.

Do **not** force Day Space into Memory/Diary/Task list geometry. It has its own rail/stage interaction model.

If acceptable alignment requires React structure changes, interaction changes, or rewiring panel behavior, stop this task and record `Day Space deferred` in the final reviewer/ruling report. Do not expand scope.

### Step 2A: If CSS-only is sufficient, write RED assertions and implement

Add durable assertions for desktop outer-frame alignment, then style only the existing Day Space classes in `desktop-page-unification.css`.

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test \
  tests/desktop-page-unification.test.ts \
  tests/day-space-layout.test.ts \
  tests/day-space-mobile-page.test.ts \
  tests/day-space-v2-regression.test.ts \
  tests/day-space-v3-polish.test.ts \
  tests/day-space-real-data.test.ts \
  tests/universe-detail-dayspace-header-polish.test.ts \
  tests/universe-home-dark-surface.test.ts
pnpm --dir web typecheck
```

Expected: PASS.

Commit:

```bash
git add tests/desktop-page-unification.test.ts web/src/desktop-page-unification.css
git commit -m "style: align day space desktop frame"
```

### Step 2B: If not safely CSS-only, defer

Make no product-code change for Day Space. Record the deferral and reason in the SDD progress/review ledger. Continue to Task 6. No placeholder commit is required.

## Task 6: Whole-batch verification and Preview gate

### Step 1: Run shell/mobile/Universe protection regressions

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test \
  tests/desktop-page-unification.test.ts \
  tests/desktop-shell-foundation.test.ts \
  tests/desktop-sidebar-mobile-parity.test.ts \
  tests/app-shell-mobile.test.ts \
  tests/universe-home-dark-surface.test.ts \
  tests/universe-detail-dayspace-header-polish.test.ts
```

Expected: PASS.

### Step 2: Run canonical verification

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm --dir web typecheck
pnpm --dir web build
git diff --check
```

Expected: all PASS. Integration tests that are intentionally environment-skipped may remain skipped exactly as the canonical harness already defines; do not claim an unavailable external integration ran.

### Step 3: Whole-branch review

Use the most capable reviewer for a whole-branch review against this plan and the production-accepted shell baseline. Explicit review checklist:

- no Domain/API/DB/Auth/MCP/routing/durable semantics changed;
- no accepted sidebar/NavigationPanel changes;
- no Home/Sentinel/System redesign;
- no `.universe-*` selectors or Universe internal changes;
- no mobile regressions introduced;
- Diary/Task visual forks were collapsed without changing behavior;
- Day Space remained within the CSS-only boundary or was deferred;
- no unrelated cleanup.

Address blocking findings through the SDD fix loop, then rerun affected focused tests and the canonical verification.

### Step 4: Push and open one PR

Push `style/desktop-page-unification` and open a PR to `main` titled:

`Unify desktop page presentation`

Do not merge.

### Step 5: Verify Vercel Preview exact head SHA

Wait until Vercel Preview is `READY` and verify its Git metadata points to the exact PR head SHA.

Visual gate routes:

- `/memory`
- `/diary`
- `/task`
- `/day-space` only if Task 5 was implemented
- `/search`
- `/universe` regression check only

Reference/regression routes:

- `/`
- `/sentinel`
- `/system/account` or `/system/data`

Check desktop at approximately 1024, 1280, and 1440 widths. Check mobile at 320 and 390 widths on every changed page. On wide desktop, page content should use the sidebar's remaining space naturally while internal reading/form widths stay bounded rather than stretching indefinitely.

Stop before merge and report:

- branch;
- base SHA and head SHA;
- commits;
- focused/canonical/typecheck/build/diff results;
- PR URL;
- Vercel Preview URL and exact-SHA confirmation;
- reviewer findings/rulings;
- whether Day Space was completed or deferred.
