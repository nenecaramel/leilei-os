# Universe Node Editor Card System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mobile Universe create/edit node papers use the same accepted card shell and control system as detail/relation papers, including percentage galaxy-weight editing without changing canonical persisted values.

**Architecture:** Keep node state and save behavior in `UniverseNodePaper.tsx`; introduce only mobile-specific structure/helpers needed for the approved UI and percentage display. Extend the accepted mobile paper-shell override file rather than changing detail/relation behavior or shared desktop presentation.

**Tech Stack:** React/TypeScript, CSS, Node built-in test runner.

## Global Constraints

- Exact accepted mobile shell geometry: `min(665px, calc(100vw - 46px))`, `clamp(506px, calc(78dvh - 54px), 666px)`, 14px radius, `translateY(16px)`, short height `calc(100dvh - 50px)`, veil `rgba(3, 4, 9, 0.5)` + blur 4px.
- Normal editor controls use warm black/white/gray only; galaxy semantic colors remain.
- Canonical memberships remain `{id, weight}` with decimal weights.
- Do not alter detail, relation, homepage/map, desktop editor, API, persistence, or reconciliation behavior.

---

### Task 1: Lock approved mobile editor structure and weight conversion

**Files:**
- Create: `tests/universe-node-editor-card-system.test.ts`
- Read: `web/src/pages/universe/UniverseNodePaper.tsx`
- Read: `web/src/pages/universe/universe-node-detail-memory-shell.css`

**Interfaces:**
- Consumes existing node editor source/CSS.
- Produces source-level regression assertions for header copy, field removal, shell geometry, control sizes, footer copy, and percentage/canonical conversion.

- [ ] Write failing assertions for `新星 · 待点亮`, `当前思想 ·`, no eyebrow/close/reason field, 44px controls, 62px summary, 96px content, text footer actions, and percentage conversion helpers.
- [ ] Verify RED against pre-change production source.
- [ ] Commit the failing test.

### Task 2: Restructure mobile create/edit markup

**Files:**
- Modify: `web/src/pages/universe/UniverseNodePaper.tsx`

**Interfaces:**
- Consumes existing `title`, `summary`, `content`, `type`, `tags`, `memberships`, save/cancel/restore/delete callbacks.
- Produces fixed header / scroll body / fixed footer mobile markup.

- [ ] Remove mobile eyebrow and in-card close button.
- [ ] Add create/edit context lines and keep 24px titles.
- [ ] Wrap form fields in a dedicated scroll body.
- [ ] Remove disabled reason field.
- [ ] Update summary/content/tag placeholders.
- [ ] Move edit-only restore/delete actions into the bottom of the scroll body.
- [ ] Keep footer only `取消` plus `点亮星球`/`保存星球`.

### Task 3: Display galaxy weights as percentages without changing canonical data

**Files:**
- Modify: `web/src/pages/universe/UniverseNodePaper.tsx`
- Test: `tests/universe-node-editor-card-system.test.ts`

**Interfaces:**
- Input canonical text such as `0.55`, `1`, `0.9`.
- UI percentage text such as `55`, `100`, `90` plus visible `%` suffix.
- Output canonical text through existing `updateMembershipWeight` state path.

- [ ] Add deterministic canonical→percent and percent→canonical helpers with blank/finite handling.
- [ ] Render the weight input with percentage text and `%` suffix.
- [ ] Convert edits back to canonical decimal strings before saving.
- [ ] Keep `toCanonicalMemberships` and save payload unchanged.

### Task 4: Apply accepted shell and unified control styling

**Files:**
- Modify: `web/src/pages/universe/universe-node-detail-memory-shell.css`

**Interfaces:**
- Consumes `.universe-standalone-editor` mobile markup.
- Produces exact accepted shell plus editor-only control/layout overrides.

- [ ] Extend exact shell width/height/radius/veil/shadow/transform to editor.
- [ ] Use three-row grid, `16px 20px 14px` padding, fixed footer and scroll body.
- [ ] Set 12px context/labels, 24px title, 44px inputs/selects, 62px summary, 96px content.
- [ ] Use `#101119`, `#f5f2e9`, `#d7d5d0`, `#7d7f8c`, `#343640`, `#555763` for normal UI.
- [ ] Preserve selected galaxy chip semantic colors; style percentage weight compactly inside chip.
- [ ] Use text-only footer actions and weak edit secondary actions.

### Task 5: Verify scope and merge

**Files:**
- Test: `tests/universe-node-editor-card-system.test.ts`
- Review branch diff against fresh `codex/phase-6-web-ui-foundation`.

**Interfaces:**
- Produces merge-ready PR.

- [ ] Run focused Node test from exact branch source and require zero failures.
- [ ] Confirm title validation, membership canonical payload, save/cancel/restore/delete callbacks remain intact.
- [ ] Confirm branch touches only spec/plan, focused test, `UniverseNodePaper.tsx`, and accepted mobile shell CSS.
- [ ] Re-fetch production base, create PR, and merge with expected-head locking.
- [ ] Check merge SHA deployment status separately; Vercel rate limiting is not a merge blocker and does not count as production visual acceptance.