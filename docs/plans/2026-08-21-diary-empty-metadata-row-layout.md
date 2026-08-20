# Diary Empty Metadata Row Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Diary list dates in the shared left metadata slot even when a Diary has no mood and no tags, while proving Memory and Task retain the same two-slot row contract.

**Architecture:** Fix the Diary row DOM contract rather than shared CSS. The shared `.memory-row-meta` styling assumes two children: a protected left date/deadline slot and a flexible right metadata slot. Diary currently removes the right slot when `formatDiaryRowMeta()` returns an empty string, causing the date span to also become `:last-child` and inherit the right-side flex/text rules. Always render the Diary right metadata span, allowing it to be empty. Memory and Task already render two spans unconditionally; add rendered regression assertions without changing their implementation unless those assertions expose a real defect.

**Tech Stack:** React, TypeScript, JSDOM, Node test runner, existing Leilei OS Web test harness.

**Spec:** This plan is the frozen bug-fix contract. No separate design document is required.

## Global Constraints

- Base exactly: `main@6d8fa146481adb3570ac312e6d96231580942551`.
- Branch exactly: `fix/diary-empty-metadata-row-layout`.
- TDD: write and run the failing Diary regression before changing production code.
- Do not change shared `.memory-row-meta` CSS unless the RED test proves the DOM-only fix cannot satisfy the contract.
- Do not change `formatDiaryRowMeta()`; its existing empty-string behavior is correct.
- Do not change Memory or Task production code unless a rendered regression assertion demonstrates an actual defect.
- No API, MCP, session lifecycle, database, migration, Universe, auth, or production-data changes.
- Preserve all existing Diary/Memory/Task visual copy and metadata formatting.
- Keep the fix valid for both active and archived Diary list rows if they share the same row renderer/contract.

---

### Task 1: Reproduce the empty-Diary metadata layout defect with a failing rendered test

**Files:**
- Modify: `tests/diary-mobile-page.test.ts`
- Production code: none in this task

**Interfaces:**
- Consumes: existing `julyDiary` fixture with `tags: []` and `mood: null`; existing `renderMobile()` / `listApi()` harness.
- Produces: a regression test proving every populated Diary row keeps exactly two `.memory-row-meta` child spans even when the right metadata text is empty.

- [ ] **Step 1: Extend the existing mobile list test with the empty-metadata row assertion**

Inside `test("mobile Diary matches Memory header and month-row hierarchy", ...)`, after the current assertions for `diary-1`, query the existing `diary-2` row and assert the exact DOM contract:

```ts
const emptyMetadataRow = page.container.querySelector<HTMLElement>(
  '[data-diary-id="diary-2"]',
);
assert.ok(emptyMetadataRow);

const emptyMetadata = emptyMetadataRow.querySelector(".memory-row-meta");
assert.ok(emptyMetadata);

const slots = [...emptyMetadata.children];
assert.equal(slots.length, 2);
assert.equal(slots[0]?.textContent, "7/31");
assert.equal(slots[1]?.textContent, "");
```

Do not replace this with a source-text assertion. Render the actual component so the test captures the user-visible DOM contract.

- [ ] **Step 2: Run only the Diary test and verify RED**

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 tests/diary-mobile-page.test.ts
```

Expected before production change: FAIL at `slots.length === 2`; current Diary DOM has only the date span when both mood and tags are empty.

If it fails for any unrelated harness reason, fix the test setup first and rerun until the failure is specifically the one-child/two-child contract mismatch.

- [ ] **Step 3: Commit the RED test only**

```bash
git add tests/diary-mobile-page.test.ts
git commit -m "test: reproduce Diary empty metadata row shift"
```

---

### Task 2: Restore the Diary two-slot metadata DOM contract with the minimal production change

**Files:**
- Modify: `web/src/pages/DiaryPage.tsx`
- Test: `tests/diary-mobile-page.test.ts`

**Interfaces:**
- Consumes: `formatDiaryRowDate(diary.date)` and `formatDiaryRowMeta(diary)`.
- Produces: `.memory-row-meta` with exactly two spans for every Diary list row: left date slot + right metadata slot, where the right slot may contain an empty string.

- [ ] **Step 1: Make the minimal DOM fix**

In the Diary month-row renderer, keep the existing metadata calculation but replace conditional removal of the second span:

```tsx
<span className="memory-row-meta">
  <span>{formatDiaryRowDate(diary.date)}</span>
  {metadata ? <span>{metadata}</span> : null}
</span>
```

with:

```tsx
<span className="memory-row-meta">
  <span>{formatDiaryRowDate(diary.date)}</span>
  <span>{metadata}</span>
</span>
```

Apply the same correction to every active/archived Diary list-row path that contains the same conditional metadata-slot removal. Do not touch paper/detail metadata rendering.

Do not add placeholder text, non-breaking spaces, hidden labels, CSS overrides, or new formatter behavior. An empty right span is the intended layout slot.

- [ ] **Step 2: Run the Diary test and verify GREEN**

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 tests/diary-mobile-page.test.ts
```

Expected: PASS, including the empty `diary-2` two-slot assertion and all existing Diary mobile behavior.

- [ ] **Step 3: Inspect the production diff**

The production change should be limited to replacing conditional right-slot removal with an unconditional right metadata span. If a shared CSS edit appears necessary, stop and report the failing evidence before making it.

- [ ] **Step 4: Commit the minimal fix**

```bash
git add web/src/pages/DiaryPage.tsx
git commit -m "fix: keep Diary list date in left metadata slot"
```

---

### Task 3: Lock Memory and Task parity without changing their production implementation

**Files:**
- Modify: `tests/memory-page.test.ts`
- Modify: `tests/task-detail-view.test.ts`
- Production code expected: none

**Interfaces:**
- Consumes: current Memory and Task rendered list rows.
- Produces: regression proof that each shared list row retains two metadata children so the left date/deadline can never accidentally become `:last-child`.

- [ ] **Step 1: Add a Memory rendered two-slot assertion**

In `test("Memory populated list uses read-only month rows and empty list has no months", ...)`, after obtaining the populated row, assert:

```ts
const memoryMetadata = rows[0]?.querySelector(".memory-row-meta");
assert.ok(memoryMetadata);
assert.equal(memoryMetadata.children.length, 2);
```

The existing Memory implementation should already pass this; do not change `MemoryPage.tsx` to satisfy a test that already reflects current behavior.

- [ ] **Step 2: Add a Task rendered two-slot assertion**

In `test("normal Task list keeps header action order, exact summary, and read-only cards", ...)`, query the task list row/card's `.memory-row-meta` and assert:

```ts
const taskMetadata = page.container.querySelector(".task-row .memory-row-meta");
assert.ok(taskMetadata);
assert.equal(taskMetadata.children.length, 2);
```

If the exact existing Task row selector differs, use the narrowest existing rendered Task-row selector from `TaskPage.tsx`; do not introduce production selectors solely for the test.

- [ ] **Step 3: Run the three focused rendered suites**

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 \
  tests/diary-mobile-page.test.ts \
  tests/memory-page.test.ts \
  tests/task-detail-view.test.ts
```

Expected: PASS. Memory and Task assertions should pass without implementation changes.

If either parity assertion fails, stop and report the rendered DOM evidence before changing Memory/Task production code; do not broaden the hotfix spec automatically.

- [ ] **Step 4: Commit parity tests**

```bash
git add tests/memory-page.test.ts tests/task-detail-view.test.ts
git commit -m "test: lock shared list metadata slots"
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

Expected: PASS for all four commands. Existing non-blocking Web chunk-size warnings may remain unchanged.

- [ ] **Step 3: Run diff hygiene and inventory checks**

```bash
git diff --check
git status --short
git diff --name-only origin/main...HEAD
```

Expected implementation/test scope:

```text
docs/plans/2026-08-21-diary-empty-metadata-row-layout.md
web/src/pages/DiaryPage.tsx
tests/diary-mobile-page.test.ts
tests/memory-page.test.ts
tests/task-detail-view.test.ts
```

Fewer files are acceptable if one parity test is demonstrably redundant. Any production file beyond `web/src/pages/DiaryPage.tsx` requires explicit evidence and review before PR.

- [ ] **Step 4: Open a Draft PR against fresh `main`**

Title equivalent to:

```text
fix: preserve Diary empty metadata row layout
```

PR body must report:

- base SHA and final head SHA;
- screenshot/user-visible symptom: Diary date moves right only when both mood and tags are empty;
- root cause: conditional removal of the right `.memory-row-meta` span makes the date both first and last child under shared CSS;
- exact DOM fix;
- Memory/Task parity result and whether either production implementation changed;
- focused test result;
- canonical test counts;
- root/Web typecheck and build;
- `git diff --check`;
- production DB touched: NO;
- API/MCP/session/Universe behavior changed: NO.

Keep the PR Draft and do not merge.

## Review acceptance

Reviewer should reject the PR if any of these are true:

- Diary still conditionally removes the right metadata span.
- Shared CSS is changed without evidence the DOM-only fix is insufficient.
- Memory/Task production files are modified without a failing rendered test demonstrating an actual defect.
- Empty Diary metadata gains visible placeholder text.
- API/MCP/session/database/Universe files appear in the diff.
- The Diary RED test was not observed failing before the fix.

## Production/browser acceptance after merge

1. Confirm Production deploys the exact merge SHA.
2. Open Diary on mobile/narrow layout with a row whose `mood=null` and `tags=[]`.
3. Confirm its `M/D` date remains at the same left position as rows with mood/tags.
4. Add a tag, refresh, and confirm the date does not move horizontally.
5. Remove/clear the tag and mood again, refresh, and confirm the date still does not move.
6. Spot-check one Memory row and one Task row; their date/deadline + right metadata alignment must be unchanged.
7. No production data needs to be created solely for this hotfix; existing acceptance data may be used.
