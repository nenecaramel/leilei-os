# Home Closure Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Home's remaining prototype Todo fixture/type dependency and Todo dialog legacy compatibility props without changing accepted Home behavior or visuals.

**Architecture:** Keep the current server-backed Home composition unchanged. Reuse canonical `TodoAuthor`, `TodoEntry`, and `TodoPaper` types end-to-end; tests own their sample Todo entries locally; `TodoPaperDialog` initializes only from `paper?.entries ?? []` and continues to save through the existing Todo API.

**Tech Stack:** React, TypeScript, Node test runner + tsx, jsdom, Vite.

## Global Constraints

- Start from accepted production baseline `3cb99f12b69cf2b555261ae835f2702a38726dc7` on isolated branch `feat/home-closure-cleanup`.
- No Home Records behavior change; Memory / Diary / Task quick-create and Universe navigation stay unchanged.
- No Todo, Calendar, Day Space, CSS visual, API, schema, migration, persistence, MCP, PWA, or production configuration change beyond the narrow cleanup.
- Delete `web/src/pages/home-prototype-data.ts` only after all runtime/test dependencies are removed.
- Remove deprecated `entries` and `storage` props from `TodoPaperDialog`; do not retain hidden fallback behavior.
- `web/preview.html` and `web/src/preview-main.tsx` remain untracked and uncommitted.
- No force push, baseline merge, deployment, or production action.

---

### Task 1: Lock the cleanup contracts in tests

**Files:**
- Modify: `tests/mobile-home-shell.test.ts`
- Modify: `tests/todo-paper-dialog.test.ts`

**Interfaces:**
- Consumes: canonical `TodoEntry` / `TodoPaper` shapes from `web/src/pages/todo-types.ts`.
- Produces: tests that reject runtime Home prototype fixtures and reject Todo dialog legacy entry/storage initialization.

- [ ] **Step 1: Replace Home runtime fixture imports with local canonical Todo samples**

Use local `TodoEntry[]` arrays with `{ id, kind, text }` only. Assert `DashboardPage.tsx` and `TodayPanel.tsx` no longer depend on `home-prototype-data`, and assert the runtime fixture file is absent.

- [ ] **Step 2: Update Todo dialog harness to pass a real `TodoPaper`**

The harness owns `paper` state, initializes it with revision `1`, updates it from `onSaved`, and passes `paper` to `TodoPaperDialog`. Remove test-local storage fallback setup from dialog behavior tests.

- [ ] **Step 3: Update save assertions to the real paper contract**

Existing-paper save must send `revision: 1`; closing a clean dialog must perform zero API requests; failed server save must keep the dialog open and preserve edits.

- [ ] **Step 4: Run focused tests and confirm the pre-cleanup implementation fails for the intended contract reasons**

Run:
```bash
pnpm exec tsx --test --test-concurrency=1 tests/mobile-home-shell.test.ts tests/todo-paper-dialog.test.ts
```
Expected before production edits: failures caused by the existing `home-prototype-data` runtime dependency and deprecated Todo dialog props/fallback.

### Task 2: Replace Home prototype Todo types with canonical Todo types

**Files:**
- Modify: `web/src/pages/TodayPanel.tsx`
- Modify: `web/src/pages/DashboardPage.tsx`
- Delete: `web/src/pages/home-prototype-data.ts`

**Interfaces:**
- `TodayPanel`: `author: TodoAuthor`, `notes: readonly TodoEntry[]`.
- `DashboardPage`: `dialogAuthor: TodoAuthor | null`; panels consume `paper?.entries ?? []` directly.

- [ ] **Step 1: Change `TodayPanel` to canonical Todo types**

Import `TodoAuthor` and `TodoEntry` from `./todo-types`; preserve markup, CSS classes, overflow measurement, and event behavior exactly.

- [ ] **Step 2: Remove Home note projection from `DashboardPage`**

Remove `HomeAuthor`, `HomeNote`, `previewNotes`, `selectedNotes`, and the now-unused `useMemo`; pass each paper's `entries` directly to `TodayPanel`; keep all load/save/calendar/rollover logic unchanged.

- [ ] **Step 3: Delete `home-prototype-data.ts`**

Delete only after no runtime/test import remains.

- [ ] **Step 4: Run Home-focused tests**

Run:
```bash
pnpm exec tsx --test --test-concurrency=1 tests/mobile-home-shell.test.ts tests/home-calendar-real-data.test.ts tests/todo-home-date-rollover.test.ts
```
Expected: PASS.

### Task 3: Remove Todo dialog compatibility props

**Files:**
- Modify: `web/src/pages/TodoPaperDialog.tsx`
- Test: `tests/todo-paper-dialog.test.ts`
- Test: `tests/day-space-real-data.test.ts`

**Interfaces:**
- `TodoPaperDialogProps` retains `paper?: TodoPaper | null`; removes `entries` and `storage`.
- Editor initialization is exactly `[...(paper?.entries ?? [])]`.
- Save continues to use `paper?.revision ?? null`.

- [ ] **Step 1: Remove deprecated props and fallback initialization**

Remove `entries`, `storage`, their comments, and the `TodoEntry` import if no longer needed. Do not alter save/error/focus/dirty semantics.

- [ ] **Step 2: Remove the obsolete Home dialog call-site prop**

`DashboardPage` must pass only `paper={selectedPaper}`; Day Space already passes a real paper.

- [ ] **Step 3: Run focused dialog and integration tests**

Run:
```bash
pnpm exec tsx --test --test-concurrency=1 tests/todo-paper-dialog.test.ts tests/mobile-home-shell.test.ts tests/day-space-real-data.test.ts
```
Expected: PASS.

### Task 4: Full verification without production changes

**Files:** none beyond Tasks 1–3.

- [ ] **Step 1: Run deterministic full test suite**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/**/*.test.ts
```
Expected: zero failures.

- [ ] **Step 2: Run root and web type/build gates**

```bash
pnpm typecheck
pnpm build
pnpm --dir web typecheck
pnpm --dir web build
```
Expected: all exit `0`.

- [ ] **Step 3: Run diff safety checks**

```bash
git diff --check
git status --short
```
Expected: no whitespace errors; only planned branch changes plus explicitly preserved untracked preview files if present.

- [ ] **Step 4: Verify branch scope**

Compare `3cb99f12b69cf2b555261ae835f2702a38726dc7...feat/home-closure-cleanup`; confirm no Records, Calendar behavior, CSS, API, DB, MCP, PWA, preview fixture, deployment, or production changes.
