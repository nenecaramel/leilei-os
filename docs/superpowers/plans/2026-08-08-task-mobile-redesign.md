# Task Mobile Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Task mobile UI on the accepted Memory/Diary visual language while preserving Task lifecycle, URL/navigation safety, and existing data compatibility.

**Architecture:** Keep persisted Task priority for compatibility but remove it from the Web experience. Reuse `memory-page-*`, `memory-month-*`, `memory-row`, and `PaperDetailDialog`; add Task-specific header, grouping/formatting, deadline editor, status action control, and the missing `later` due preset.

**Tech Stack:** React, TypeScript, Vite, Node test runner (`tsx --test`), existing Task domain service/repository.

## Global Constraints

- Base branch: `codex/phase-6-web-ui-foundation`.
- Mobile acceptance viewport: `393 × 852`.
- Header tools: time → status → tags → search → archive → create.
- Default groups: Overdue → Today → Next 7 Days → Later → No Deadline → Completed → Cancelled.
- Completed/Cancelled remain visible by default.
- New Task defaults to no deadline.
- Title and description remain required.
- Priority is absent from Web display/filter/create/edit, but persisted priority remains compatible.
- Preserve state machine, archive/restore, single-flight, unsaved-change protection, latest-request protection, URL/return/scroll behavior.
- `web/preview.html` and `web/src/preview-main.tsx` stay untracked.
- No commit/merge/push before visual acceptance.

---

### Task 1: Filter contract
- [ ] Add failing test for `due=later`.
- [ ] Add `later` to `TaskDueFilter` and TaskService normalization using `eighthDayStart`.
- [ ] Re-run focused test.

### Task 2: Presentation model
- [ ] Add failing tests for seven fixed groups and sort rules.
- [ ] Implement Task row/paper deadline and metadata formatting.
- [ ] Re-run focused test.

### Task 3: Header and status icon
- [ ] Add neutral status icon.
- [ ] Build six-tool Task header with Memory/Diary popovers and search row.
- [ ] Keep custom range valid while editing boundaries.

### Task 4: Paper UI
- [ ] Build Task title/description editor.
- [ ] Build compact deadline editor; create defaults to no deadline.
- [ ] Build status action menu limited to allowed state-machine actions.
- [ ] Build tags editor/read metadata.

### Task 5: Active + Archive mobile views
- [ ] Render grouped rows using Memory/Diary card language.
- [ ] Keep loaded list under detail paper.
- [ ] Archive header is Archive + count + Return.
- [ ] Archived detail is restore-only.

### Task 6: Verification + preview
- [ ] Focused tests.
- [ ] Task regression tests.
- [ ] Full serial suite.
- [ ] Root/web typecheck + build + diff check.
- [ ] Start LAN preview; no commit/merge/push.
