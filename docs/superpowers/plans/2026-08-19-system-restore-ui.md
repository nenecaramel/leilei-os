# System Restore UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make System → Data → Restore visually match the accepted Leilei OS System UI while preserving all import/recovery behavior.

**Architecture:** Keep the existing `ImportState` state machine and preview/execute API calls in `SystemDataPageContent.tsx`. Replace only the presentation layer with compact row-based states, add one narrow restore-specific stylesheet that reuses the existing System/Export geometry, and make error copy preserve safe backend messages when the API supplies `WebApiError`.

**Tech Stack:** React, TypeScript, existing Web API client, node:test + JSDOM, CSS.

**Spec:** `docs/superpowers/plans/2026-08-19-system-restore-ui-design.md`

## Global Constraints

- Mobile is the acceptance target; no desktop redesign.
- Do not change import domain/API/database semantics.
- Keep explicit preview before execute.
- No raw `create/duplicate/conflict/invalid` matrix in user-facing UI.
- No new icon, pill, modal, progress bar, or warning-card language.
- Export UI behavior and copy remain unchanged.

---

### Task 1: Lock the compact Restore behavior with failing tests

**Files:**
- Modify: `tests/system-data-import-ui.test.ts`

**Interfaces:**
- Consumes: `SystemDataPageContent` and `WebApiClient`.
- Produces: regression expectations for compact idle/selected/ready/success/error states.

- [ ] **Step 1: Rewrite the primary interaction test before production changes**

Assert that the initial Restore surface contains a `.system-import-card`, one row labelled `Export file`, and a plain `Choose` action; assert the old explanatory paragraph and `Choose export file` text are absent.

After selecting `backup.json`, assert the same action row contains `backup.json · 0.0 KB` and `Preview`, with no `Preview restore` button.

After preview, assert `Memory` + `1 new` and compact total copy are present; assert raw `create 1`, `duplicate 0`, `conflict 0`, `invalid 0` text is absent.

Execute restore and keep the existing API ordering assertion.

- [ ] **Step 2: Add focused tests for zero-new, blocked, and safe API error presentation**

Add cases proving:

```text
all duplicates -> "Everything is already here" and no Restore action
conflict/invalid -> human-facing blocked rows and no Restore action
WebApiError("IMPORT_OWNER_MISMATCH") -> backend safe message is shown
unknown Error -> generic validation fallback remains
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
pnpm exec tsx --test tests/system-data-import-ui.test.ts
```

Expected: FAIL because the current UI still renders the large secondary buttons, explanatory paragraph, and raw planner matrix.

---

### Task 2: Implement the row-based Restore presentation

**Files:**
- Modify: `web/src/pages/SystemDataPageContent.tsx`
- Create: `web/src/pages/system-restore-ui-polish.css`
- Modify: `web/src/main.tsx`

**Interfaces:**
- Consumes: existing `ImportState`, `WebImportPreview`, `WebApiError`, `.system-section`, `.system-export-header`, and the accepted Export action visual language.
- Produces: compact Restore row UI with unchanged preview/execute behavior.

- [ ] **Step 1: Add small presentation helpers**

In `SystemDataPageContent.tsx`, keep `countImport` and add helpers that:

```ts
const IMPORT_MODULE_LABELS = {
  memory: "Memory",
  diary: "Diary",
  task: "Task",
  todo: "Todo",
} as const;
```

Build only non-zero module rows, with human-facing values:

```text
create -> "N new"
duplicate -> "N already here"
conflict -> "Conflict"
invalid -> "Invalid"
```

Prioritize blocked state when any conflict/invalid count is non-zero.

- [ ] **Step 2: Preserve safe API error detail**

Import `WebApiError` from `../api/useWebApiClient` and use `error.message` for `WebApiError` failures. Unknown errors keep:

```text
Unable to validate this export file.
Unable to restore this export file.
```

The >10 MiB and local file-read messages remain unchanged.

- [ ] **Step 3: Replace the Restore JSX only**

Keep the section shell and hidden file input, but render:

```text
header row: Restore
idle: Export file | Choose
selected: filename · size | Preview
previewing: filename · size | Validating…
ready: filename · size | Change; non-zero module rows; compact summary/action row
restoring: filename; Restoring…
success: compact result text
error: compact error text plus Choose/Retry-style text action where useful
```

Use button text `Choose`, `Preview`, `Change`, and `Restore`; do not use `.secondary-button` inside Restore.

- [ ] **Step 4: Add narrow CSS matching accepted System/Export geometry**

Create `system-restore-ui-polish.css` with Restore-only selectors. Reuse:

```css
min-height: 60px;
border-top: 1px solid rgba(0, 0, 0, 0.08);
font-size: 14px;
muted status font-size: 12px;
plain transparent action buttons;
```

Do not override global System or Export selectors.

- [ ] **Step 5: Load the stylesheet after `system-export-ui-polish.css`**

Add:

```ts
import "./pages/system-restore-ui-polish.css";
```

in `web/src/main.tsx` directly after the Export polish import.

- [ ] **Step 6: Run focused test and verify GREEN**

Run:

```bash
pnpm exec tsx --test tests/system-data-import-ui.test.ts
```

Expected: PASS.

---

### Task 3: Regression and release gate

**Files:**
- Review only; no unrelated code changes.

**Interfaces:**
- Consumes: final branch diff.
- Produces: merge-ready evidence.

- [ ] **Step 1: Run focused System Data tests**

```bash
pnpm exec tsx --test tests/system-data-import-ui.test.ts tests/system-data-export-ui.test.ts tests/system-data-activity-ui.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run canonical verification**

```bash
CI=true pnpm test
pnpm typecheck
pnpm build
cd web && npm run typecheck && npm run build
cd .. && git diff --check
```

Expected: all exit 0 with zero failures.

- [ ] **Step 3: Review the final PR diff**

Confirm:

```text
no import/recovery API/domain/database changes
no Export UI regression
no raw planner matrix in Restore UI
no unrelated frontend refactor
no ` 2` suffix files
```

- [ ] **Step 4: Verify deployment checks, then merge with expected HEAD**

Use the exact reviewed HEAD SHA when merging PR #167. Do not force merge a moved head.

- [ ] **Step 5: Verify production deployment and mobile acceptance**

Confirm production deploy corresponds to the merged SHA. The mobile System → Data page is the final visual acceptance target; desktop is checked only for obvious breakage.
