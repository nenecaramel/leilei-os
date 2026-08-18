# Universe Mobile Acceptance Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the mobile Universe/Day Space acceptance issues reported from production without changing Universe data, API, repository, search, or Phase 8.5 behavior.

**Architecture:** Keep changes scoped to the existing mobile Universe page components and focused polish stylesheet. Reuse the existing transient Universe notice state for mutation feedback, while removing/normalizing obsolete always-on guidance UI. Keep the existing iOS anti-zoom strategy and preserve accepted #136/#138/#137 behavior.

**Tech Stack:** React, TypeScript, CSS, node:test static regression tests, Vercel Preview build.

## Global Constraints

- Mobile-only UI polish; desktop behavior stays unchanged.
- No data model, API, repository, migration, Global Search, MCP, or Phase 8.5 changes.
- Keep relation cancel -> source detail behavior and one-shot `/universe?node=` deep-link behavior.
- Keep iOS focus-safe real/computed form font sizes >= 16px.
- Do not disable browser zoom through viewport metadata.
- Do not merge or deploy automatically; stop at Draft PR.

---

### Task 1: Lock the acceptance behaviors in focused regression tests

**Files:**
- Modify: `tests/universe-detail-dayspace-header-polish.test.ts`

**Interfaces:**
- Consumes: existing mobile Universe component/CSS source files.
- Produces: static assertions covering the requested layout/copy/interaction contract.

- [ ] **Step 1: Add failing assertions** for the Memory-style sticky white Day Space top bar, all three lifted titles, connection copy rename/removal, management menu in edit only, aligned footer actions, centered transient feedback, map text-selection prevention, and galaxy percentage spacing.
- [ ] **Step 2: Verify the new assertions target behavior absent from the current base.**
- [ ] **Step 3: Keep earlier #136/#138 regression assertions intact where they still describe accepted behavior.**

### Task 2: Fix Universe node/relation mobile card structure and copy

**Files:**
- Modify: `web/src/pages/universe/UniverseNodePaper.tsx`
- Modify: `web/src/pages/universe/UniverseRelationPaper.tsx`

**Interfaces:**
- Consumes: existing `onRestore`, `onDelete`, `onSave`, `onRequestClose`, and node/relation state.
- Produces: edit-only management menu, renamed relation title, no relation intro copy, consistent bottom actions.

- [ ] **Step 1: Move recovery/removal management out of mobile detail and into the edit heading area.** Keep restore conditional on available revisions and keep the two-step delete confirmation.
- [ ] **Step 2: Change mobile relation title to `连接另一个思想`.**
- [ ] **Step 3: Remove the explanatory sentence below the mobile relation title.**
- [ ] **Step 4: Keep create/edit/relation footer markup simple so CSS can match detail footer typography and spacing.**

### Task 3: Normalize mobile layout, hints, and gestures

**Files:**
- Modify: `web/src/pages/universe-detail-dayspace-header-polish.css`
- Modify if required: `web/src/pages/universe/universe-home-polish.css`
- Modify if required: `web/src/pages/universe-state-polish.css`
- Modify if required: `web/src/pages/universe/UniverseMobileMap.tsx`
- Modify if required: `web/src/pages/UniversePage.tsx`

**Interfaces:**
- Consumes: `UniverseNotice`, `.universe-map-mode-hint`, placement popover, existing mobile shell classes.
- Produces: horizontally centered transient feedback, non-selectable map gestures, fixed percentage spacing, Memory-style sticky white Day Space top bar, unified footer visual contract.

- [ ] **Step 1: Keep Day Space mobile top bar sticky at the top, give it an opaque white surface like Memory, and remove the gray separator.**
- [ ] **Step 2: Lift `点亮一颗新星`, `调整这颗星球`, and `连接另一个思想` titles by 10px from the accepted shell.**
- [ ] **Step 3: Match create/edit/relation footer text controls to detail footer positions, font size, weight, and color; save uses the same muted color as cancel.**
- [ ] **Step 4: Keep the 16px Safari anti-zoom input size while visually moving galaxy percentage digits left and preserving a gap before `%`.**
- [ ] **Step 5: Add `user-select: none` / `-webkit-user-select: none` / `-webkit-touch-callout: none` to Universe map gesture surfaces.**
- [ ] **Step 6: Horizontally center existing three-second mutation feedback.**
- [ ] **Step 7: Audit ready-state guidance/status UI. Convert transient action guidance to the same centered lightweight treatment and remove obsolete always-on framed hints; keep real loading/error/import states persistent.**

### Task 4: Review and open a Draft PR

**Files:**
- Review all changed files above.

**Interfaces:**
- Produces: one isolated Draft PR against `codex/phase-6-web-ui-foundation`.

- [ ] **Step 1: Review the final diff for scope creep and preservation of #136/#138/#137 behavior.**
- [ ] **Step 2: Check Vercel Preview/build status for the branch.**
- [ ] **Step 3: Record any tests that could not be executed in the current tool environment instead of claiming they passed.**
- [ ] **Step 4: Create a Draft PR and stop without merge/deploy.**
