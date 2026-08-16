# Universe Mobile Inner Pages Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Universe detail, create, and edit render the existing desktop Universe Paper UI on mobile, then leave only a thin mobile adaptation layer for later polish.

**Architecture:** Keep `UniverseNodePaper` as the single DOM/component source for desktop and mobile. Keep the existing Universe desktop rules in `universe-state-polish.css` as the visual source of truth; add one scoped mobile parity stylesheet that only cancels broad shared mobile Paper overrides for `universe-node-*` dialog IDs. Do not touch the Universe home/map.

**Tech Stack:** React, TypeScript, CSS, Node test runner.

## Global Constraints

- Universe home/map UI and behavior are frozen.
- Scope is only Universe detail, create, and edit Paper screens.
- Reuse the exact web Paper DOM, metadata, Connections, inputs, buttons, menus, and existing Universe CSS.
- Preserve weighted galaxy memberships and all existing mutation/relation semantics.
- Preserve edit Cancel/Save returning to the same detail Paper.
- Do not merge without explicit user authorization.

---

### Task 1: Lock the web-Paper DOM and mobile scope

**Files:**
- Modify: `tests/universe-mobile-node-paper.test.ts`

**Interfaces:**
- Consumes: `UniverseNodePaper.tsx`, `UniversePage.tsx`, the scoped parity stylesheet.
- Produces: source-level regression coverage for exact web-Paper reuse and frozen home/map scope.

- [ ] Assert the existing web DOM and metadata footer remain shared by detail/create/edit.
- [ ] Assert the dedicated mobile parity stylesheet is imported.
- [ ] Assert the stylesheet is scoped to `paper-detail-paper[id^="universe-node-"]` and contains no Universe home/map selectors.
- [ ] Assert accepted Cancel/Save and detail action behavior remains unchanged.

### Task 2: Cancel only the shared mobile Paper overrides

**Files:**
- Modify: `web/src/pages/universe/UniverseNodePaper.tsx`
- Create: `web/src/pages/universe/universe-node-paper-web-mobile.css`

**Interfaces:**
- Consumes: desktop `PaperDetailDialog` geometry and Universe styles already present in the app.
- Produces: phone rendering that keeps the web Paper visual rules instead of the generic mobile Paper restyle.

- [ ] Import the scoped stylesheet from `UniverseNodePaper.tsx`.
- [ ] On widths at or below 760px, restore desktop Paper `translateY(31px)` for Universe node papers.
- [ ] Restore desktop top-right container and button geometry (`height:auto`, `min-height:44px`, `padding:0 4px`, normal line-height).
- [ ] Add no home/map selectors and no new visual language.

### Task 3: Verify and open PR

**Files:**
- Verify the three implementation/test files above.

- [ ] Compare branch to production and confirm no home/map file changed.
- [ ] Confirm remote Vercel deployment status for the exact head SHA.
- [ ] When a local runner is available, run `pnpm exec tsx --test --test-concurrency=1 tests/universe-mobile-node-paper.test.ts`, `pnpm --dir web typecheck`, and `pnpm --dir web build`.
- [ ] Open a PR against `codex/phase-6-web-ui-foundation`; do not merge until explicitly authorized.
