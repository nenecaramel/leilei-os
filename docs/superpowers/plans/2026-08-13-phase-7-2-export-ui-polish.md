# Phase 7.2 Export UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the existing System → Data export controls into one compact Account-style card without changing export behavior.

**Architecture:** Keep all API/download state and handlers in `SystemDataPageContent.tsx`. Replace only the export markup/classes and add narrowly scoped System-page CSS that reuses existing Account/System typography and card tokens. No backend, schema, MCP, or JSON changes.

**Tech Stack:** React, TypeScript, CSS, Node test runner + JSDOM.

## Global Constraints

- Work only on `feat/phase-7-2-export-ui-polish`.
- Keep the Data summary card unchanged.
- Export card gap from Data card: 12px.
- Export card: existing System card border/background/shadow/radius/inset language.
- No separator lines inside Export card.
- Left label `Export`: Account label style, 14px, weight 500.
- Right actions: `All`, `Memory`, `Diary`, `Task`, `Todo`; pure text, 14px, weight 400, right aligned, no chrome.
- Audit copy uses Account `.system-note` typography: 12px, weight 400, #8a8a8a.
- Audit control is a compact 19×19px checkbox with 5px radius and theme accent.
- Existing scopes, download behavior, loading disable behavior, error behavior, and `include_audit=true` semantics must not change.
- Do not touch backend, DB/migrations, MCP, Notion, PWA, Health, Toy, or export JSON.

---

### Task 1: Lock the new UI contract in tests

**Files:**
- Modify: `tests/system-data-export-ui.test.ts`

**Interfaces:**
- Consumes: `SystemDataPageContent` and existing `WebApiClient` behavior.
- Produces: assertions for `.system-export-card`, `.system-export-action`, `.system-export-audit`, and unchanged request paths.

- [ ] **Step 1: Write the failing test changes**

Replace selectors that expect `.system-export-actions button` with selectors for `.system-export-action`. Assert action text is exactly `["All", "Memory", "Diary", "Task", "Todo"]`. Assert the card contains one `.system-export-label` with `Export`, one `.system-export-audit` label, and no legacy `.system-export-actions` container.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm exec tsx --test --test-concurrency=1 tests/system-data-export-ui.test.ts
```

Expected: FAIL because the production component still renders the legacy export actions/classes/text.

- [ ] **Step 3: Commit the test-only RED state**

```bash
git add tests/system-data-export-ui.test.ts
git commit -m "test: define export card visual contract"
```

### Task 2: Replace export markup with the approved Account-style card

**Files:**
- Modify: `web/src/pages/SystemDataPageContent.tsx`

**Interfaces:**
- Consumes: existing `runExport(scope)` and `includeAudit` state.
- Produces: `.system-export-card`, `.system-export-row`, `.system-export-label`, `.system-export-action-list`, `.system-export-action`, `.system-export-audit` markup.

- [ ] **Step 1: Implement minimal markup**

Render a separate `<section className="system-section system-export-card">`. Inside it, render one two-column export row: left `Export`, right a vertical stack of five `<button type="button" className="system-export-action">` items with labels `All`, `Memory`, `Diary`, `Task`, `Todo`. Keep current scopes and loading `disabled` behavior.

Render the audit control below as `<label className="system-export-audit">` with the text and checkbox. Keep `checked={includeAudit}` and the existing state update. Keep export error inside the card.

- [ ] **Step 2: Run focused test**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/system-data-export-ui.test.ts
```

Expected: markup/behavior assertions pass except any styling-source assertions added in Task 3.

### Task 3: Apply existing System visual language only

**Files:**
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: existing `.system-section`, `.system-detail-row`, `.system-note`, and project checkbox treatment.
- Produces: export-specific layout without altering global System card behavior.

- [ ] **Step 1: Add narrow export styles**

Use `margin-top: 12px` on `.system-export-card`. Remove legacy export grid/flex/gap rules. Make `.system-export-row` an Account-like two-column grid using the same mobile column widths/gaps as `.system-detail-row`. Make the action list a right-aligned vertical stack with no separators. Reset `.system-export-action` with no border/background/shadow/padding chrome, 14px/400, #171717, right aligned. Keep disabled opacity/cursor semantics.

Use `.system-export-audit` as a compact row below the actions with Account-note typography (12px/400/#8a8a8a); align checkbox on the right. Scope the checkbox override to `.system-export-audit input[type="checkbox"]` with width/height/min dimensions 19px, margin/padding 0, 5px radius, and `accent-color: var(--theme-strong)` so the global input height rule cannot enlarge it.

- [ ] **Step 2: Verify GREEN**

Run:

```bash
pnpm exec tsx --test --test-concurrency=1 tests/system-data-export-ui.test.ts
pnpm typecheck
pnpm build
cd web && pnpm typecheck && pnpm build && cd ..
git diff --check
```

Expected: all PASS.

- [ ] **Step 3: Commit production/UI changes**

```bash
git add web/src/pages/SystemDataPageContent.tsx web/src/styles.css tests/system-data-export-ui.test.ts
git commit -m "fix: align data export card with system ui"
```

### Task 4: Final branch review

- [ ] Compare against the accepted production baseline and confirm only spec/plan/test/component/CSS files changed.
- [ ] Confirm no backend/API/export schema changes.
- [ ] Confirm branch is clean.
- [ ] Push the branch and wait for preview/build status before production merge.
