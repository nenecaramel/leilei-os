# Universe Editor Scrolling Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On mobile Universe create/edit only, keep the small context row and edit management control fixed while the large create/edit title scrolls away with the form, without changing the accepted title styling, title-to-first-field spacing, fixed footer, desktop UI, detail UI, or connection editor.

**Architecture:** Preserve the existing three-row mobile editor shell (`fixed heading → scrollable body → fixed footer`). The current defect is purely DOM ownership: the large `<h2>` lives in the fixed heading together with the context row. Move only that `<h2>` to the beginning of `.universe-standalone-editor-body`. Keep the context row and edit `···` menu in `.universe-standalone-editor-heading`. Because the accepted pre-change gap from the title to the first field is supplied by the body's `24px` top padding, transfer that spacing to the first field after the DOM move while letting the existing `5px` title top offset remain unchanged. No data or interaction contract changes are required.

**Tech Stack:** React, TypeScript, CSS, Node test runner, existing Leilei OS Web source-level visual contract tests.

**Spec:** GitHub Issue #208 is the frozen product contract. No separate design document is required.

## Global Constraints

- Audited source baseline: `main@a7fc341e167809be174c157344ca0f3659bc001f`.
- Implementation must start from fresh `origin/main` **after this plan is present on main**; do not implement from the pre-plan baseline above.
- Implementation branch exactly: `fix/universe-editor-scrolling-title`.
- TDD: add and run the focused failing title-ownership regression before changing production code; observe the intended RED.
- Mobile Universe create/edit only.
- Keep title copy exactly `点亮一颗新星` / `调整这颗星球`.
- Do not change the large title's font family, `24px` size, `500` weight, `#f5f2e9` color, `-0.035em` letter spacing, `1.08` line-height, or horizontal alignment.
- Keep the existing `5px` top offset owned by `web/src/pages/universe-detail-dayspace-header-polish.css`.
- Preserve the current `24px` visual gap between the large title and the first field (`它叫什么？`) after the DOM move.
- Small context row (`新星 · 待点亮` / `当前思想 · <title>`) remains outside the scrollable body.
- Edit `···` management remains fixed with the context row and retains its existing two-step destructive behavior.
- Footer remains outside the scrollable body and fixed in the shell.
- Create and edit must use the same DOM/CSS contract.
- Existing mobile detail title behavior remains unchanged: detail title is already inside `.universe-standalone-detail-scroll`.
- Existing iOS form-control protection (`font-size: 16px !important` in focused mobile polish) must remain unchanged.
- Desktop Universe, relation/connection editor, Universe map/home, domain/service/API/DB/MCP/schema/migration behavior are out of scope.
- Do not add a new wrapper, sticky title, JavaScript scroll handler, duplicated title, or separate create/edit implementation.

---

### Task 1: Reproduce the fixed-title defect with a failing source contract test

**Files:**
- Modify: `tests/universe-node-editor-card-system.test.ts`
- Production code: none in this task

**Interfaces:**
- Consumes: current mobile editor JSX in `web/src/pages/universe/UniverseNodePaper.tsx`.
- Produces: a regression proving the fixed heading owns context/management only, while the large title is the first semantic item in the scrollable editor body before `它叫什么？`.

- [ ] **Step 1: Add a focused DOM-ownership regression**

Add one test alongside the existing mobile editor hierarchy tests. Extract the editor heading and the opening portion of the editor body from `nodePaper` source, then assert:

```ts
test("mobile create/edit keeps context fixed while the large title belongs to the scrollable form body", () => {
  const heading = nodePaper.match(
    /<header className="universe-standalone-editor-heading">([\s\S]*?)<\/header>/,
  )?.[1] ?? "";
  const bodyLead = nodePaper.match(
    /<div className="universe-standalone-editor-body">([\s\S]*?)<div className="universe-standalone-form-field">/,
  )?.[1] ?? "";

  assert.match(heading, /universe-standalone-editor-context/);
  assert.match(heading, /universe-standalone-editor-management/);
  assert.doesNotMatch(heading, /<h2>/);
  assert.match(
    bodyLead,
    /<h2>\{isCreate \? "点亮一颗新星" : "调整这颗星球"\}<\/h2>/,
  );
});
```

The management assertion is intentionally source-level: create renders no menu because of the existing `!isCreate` condition, while edit renders the same menu in the fixed heading.

- [ ] **Step 2: Run only this focused suite and verify RED**

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 \
  tests/universe-node-editor-card-system.test.ts
```

Expected before production change: FAIL because the heading still contains `<h2>` and the scrollable body begins directly with the first form field.

If the failure is caused by the regex/harness rather than those two ownership assertions, fix the test first and rerun until RED specifically proves the current title is fixed.

- [ ] **Step 3: Commit the RED test only**

```bash
git add tests/universe-node-editor-card-system.test.ts
git commit -m "test: reproduce fixed Universe editor title"
```

---

### Task 2: Move only the large title into the scrollable editor body

**Files:**
- Modify: `web/src/pages/universe/UniverseNodePaper.tsx`
- Modify: `web/src/pages/universe/universe-node-detail-memory-shell.css`
- Test: `tests/universe-node-editor-card-system.test.ts`

**Interfaces:**
- Fixed row: `.universe-standalone-editor-heading` contains context + edit management only.
- Scroll row: `.universe-standalone-editor-body` starts with the existing large `<h2>`, then the existing form fields.
- Fixed row: `.universe-standalone-editor-footer` remains a sibling after the scroll body.

- [ ] **Step 1: Make the minimal JSX ownership move**

In `mobileStandaloneBody`, change only the large-title location:

Before:

```tsx
<header className="universe-standalone-editor-heading">
  <p className="universe-standalone-editor-context">...</p>
  <h2>{isCreate ? "点亮一颗新星" : "调整这颗星球"}</h2>
  {!isCreate ? renderManagementMenu("universe-standalone-editor-management") : null}
</header>

<div className="universe-standalone-editor-body">
  <div className="universe-standalone-form-field">...</div>
```

After:

```tsx
<header className="universe-standalone-editor-heading">
  <p className="universe-standalone-editor-context">...</p>
  {!isCreate ? renderManagementMenu("universe-standalone-editor-management") : null}
</header>

<div className="universe-standalone-editor-body">
  <h2>{isCreate ? "点亮一颗新星" : "调整这颗星球"}</h2>
  <div className="universe-standalone-form-field">...</div>
```

Do not alter title copy, context copy, management rendering, form order, field values, callbacks, save/cancel behavior, or desktop JSX.

- [ ] **Step 2: Transfer the existing title-to-first-field spacing without restyling the title**

In `web/src/pages/universe/universe-node-detail-memory-shell.css`, the pre-change editor body uses:

```css
.universe-standalone-editor-body {
  ...
  padding-top: 24px;
  padding-bottom: 4px;
  ...
}
```

After the title becomes the body's first child, change only the spacing ownership needed to preserve geometry:

```css
.universe-standalone-editor-body {
  ...
  padding-top: 0;
  padding-bottom: 4px;
  ...
}

.universe-standalone-editor-body > h2 + .universe-standalone-form-field {
  margin-top: 24px;
}
```

Why this is frozen:
- the existing `.universe-standalone-editor h2` typography remains untouched;
- the existing later mobile polish rule keeps `margin-top: 5px`, preserving the title's accepted offset below the fixed context row;
- the old body's `24px` top padding becomes the new explicit `24px` gap below the title, preserving the title → `它叫什么？` rhythm.

Do not compensate with transforms, negative margins, sticky positioning, shell height changes, or edits to relation/detail CSS.

- [ ] **Step 3: Run the RED suite again and verify GREEN**

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 \
  tests/universe-node-editor-card-system.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit the minimal production change**

```bash
git add \
  web/src/pages/universe/UniverseNodePaper.tsx \
  web/src/pages/universe/universe-node-detail-memory-shell.css
git commit -m "fix: scroll Universe editor title with form"
```

---

### Task 3: Lock the accepted mobile visual/non-regression contract

**Files:**
- Modify only if needed for assertions: `tests/universe-node-editor-card-system.test.ts`
- Existing regression suites: `tests/universe-detail-dayspace-header-polish.test.ts`, `tests/universe-mobile-node-paper.test.ts`
- Production code expected: no additional files

- [ ] **Step 1: Add spacing ownership assertions to the editor-card regression**

In the existing `mobile editor shell exactly matches accepted card geometry and compact controls` test, add assertions that lock the new scroll-body geometry while leaving existing title styling under its current selectors:

```ts
assert.match(
  shellCss,
  /\.universe-standalone-editor-body\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?padding-top:\s*0;/,
);
assert.match(
  shellCss,
  /\.universe-standalone-editor-body > h2 \+ \.universe-standalone-form-field\s*\{[\s\S]*?margin-top:\s*24px;/,
);
```

Do not move the title-style contract into a new selector. The existing `.universe-standalone-editor h2` selector must continue to own the accepted typography, and the later focused polish must continue to own the `5px` top offset.

- [ ] **Step 2: Run the three focused Universe mobile visual-contract suites**

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 \
  tests/universe-node-editor-card-system.test.ts \
  tests/universe-detail-dayspace-header-polish.test.ts \
  tests/universe-mobile-node-paper.test.ts
```

Expected: PASS.

This run must specifically preserve existing assertions for:
- mobile detail title remaining in `.universe-standalone-detail-scroll`;
- create/edit title `5px` top offset;
- fixed edit management placement;
- fixed footer geometry/action typography;
- iOS `>=16px` focus-safe editor controls;
- desktop Paper presentation remaining intact;
- relation/connection behavior and presentation remaining intact.

If any of those existing tests fail, do not broaden the implementation automatically; report the exact failure and inspect whether the DOM move violated a frozen contract.

- [ ] **Step 3: Commit any final regression-only assertion change**

If Step 1 added assertions after the production commit:

```bash
git add tests/universe-node-editor-card-system.test.ts
git commit -m "test: lock Universe scrolling editor title geometry"
```

---

### Task 4: Full verification and Draft PR

**Files:**
- No additional implementation files expected.

- [ ] **Step 1: Run the deterministic canonical suite**

```bash
CI=true pnpm test
```

Expected: 0 failed. Record total/pass/skipped counts.

- [ ] **Step 2: Run root and Web type/build gates**

```bash
pnpm typecheck
pnpm build
pnpm --dir web typecheck
pnpm --dir web build
```

Expected: PASS for all four commands. Existing non-blocking build warnings may remain unchanged.

- [ ] **Step 3: Run diff hygiene and scope inventory**

```bash
git diff --check
git status --short
git diff --name-only origin/main...HEAD
```

Expected implementation/test scope:

```text
docs/plans/2026-08-21-universe-editor-scroll-title.md
tests/universe-node-editor-card-system.test.ts
web/src/pages/universe/UniverseNodePaper.tsx
web/src/pages/universe/universe-node-detail-memory-shell.css
```

The plan file may already be on `main` and therefore absent from the implementation branch diff; that is expected. No other production file should be required. In particular, do not edit `web/src/pages/universe-detail-dayspace-header-polish.css`, `UniverseRelationPaper.tsx`, desktop-only Universe code, backend/API/DB/MCP files, or migration/schema files unless a failing frozen-contract test proves the plan itself is wrong; if so, stop and report instead of improvising.

- [ ] **Step 4: Open a Draft PR against fresh `main`**

Title equivalent to:

```text
fix: scroll Universe editor title with form
```

PR body must report:
- Issue #208 and plan path;
- implementation base SHA and final head SHA;
- RED evidence: title initially owned by fixed heading;
- exact JSX move and spacing transfer;
- mobile create result;
- mobile edit result, including fixed `···` management;
- detail/connection/desktop non-regression result;
- iOS focus-safe assertion result;
- focused test counts;
- canonical test counts;
- root/Web typecheck + build results;
- `git diff --check`;
- production DB touched: NO;
- API/DB/MCP/schema/migration behavior changed: NO.

Keep the PR Draft. Do not merge and do not deploy.

## Review Acceptance

Reject the PR if any of these are true:
- the large create/edit title remains inside `.universe-standalone-editor-heading`;
- the context row enters the scrollable body;
- edit management enters the scrollable body or changes behavior;
- create and edit use different title ownership/layout paths;
- title copy or accepted typography changes;
- the title → first-field gap is no longer `24px`;
- the footer becomes scrollable;
- detail title scrolling behavior changes;
- the existing iOS `16px` focus-safe rule is weakened or removed;
- desktop Universe, connection editor, map/home, API/domain/DB/MCP/schema/migration files appear in the implementation diff;
- RED was not observed before production changes.

## Mobile Visual Acceptance After Merge

1. Open mobile Universe create. Confirm `新星 · 待点亮` remains visible at the fixed top while `点亮一颗新星` scrolls away together with the form; footer stays fixed.
2. Confirm the gap from `点亮一颗新星` to `它叫什么？` matches the pre-change editor.
3. Open mobile Universe edit. Confirm `当前思想 · <original title>` and `···` remain fixed while `调整这颗星球` scrolls away with the form; footer stays fixed.
4. Open the edit management menu before and after scrolling; restore/delete behavior and two-step destructive confirmation are unchanged.
5. Focus title/summary/content/type controls on iOS/Safari-class mobile behavior; no viewport auto-zoom regression.
6. Spot-check mobile detail: its title still scrolls with detail content.
7. Spot-check mobile connection editor and desktop Universe: unchanged.
