# Universe Mobile Acceptance Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five production-visible mobile regressions after PR #140 while preserving Universe behavior and desktop presentation.

**Architecture:** Correct the existing source styles instead of stacking another broad visual override. Keep the shared `MobileTopBar` and existing Universe component structure, but normalize the exact mobile CSS contracts for stacking, footer geometry, placement popover visibility/bounds, transient notice positioning, and native select appearance.

**Tech Stack:** React, TypeScript, CSS, node:test static regression tests, Vercel build checks.

## Global Constraints

- Mobile-only visual/interaction corrections for Day Space and Universe create/edit/relation flows.
- No Universe data, API, repository, Global Search, MCP, Toy, migration, or Phase 8.5 changes.
- Day Space top bar stays sticky, opaque white, borderless, and above Day Space date controls/papers.
- Placement instruction remains a persistent visible popover while placement mode is active; it must not be converted to a three-second notice.
- Three-second mutation notices remain transient and pause while editor/relation dialogs are open.
- Preserve #140 title positions/copy, edit management menu, drag text-selection prevention, galaxy percentage spacing, relation cancel -> source detail, and Phase 8.4 deep-link behavior.
- Desktop presentation remains unchanged.

---

### Task 1: Lock the five production regressions in focused tests

**Files:**
- Modify: `tests/universe-detail-dayspace-header-polish.test.ts`

**Interfaces:**
- Consumes: source CSS/components already imported by the static regression test.
- Produces: assertions that reject the exact regressions reported in production.

- [ ] **Step 1: Add failing assertions for Day Space stacking.**

Assert that the Day Space-specific `.mobile-top-bar` rule is sticky, `background: #ffffff`, borderless, and has a z-index greater than the existing `.day-space-date-area { z-index: 30; }`. Use a fixed value of `40` so the contract is explicit.

- [ ] **Step 2: Add failing assertions for footer parity.**

Assert that editor and relation footers use the detail footer constants: `padding-top: 12px`, no extra bottom padding/margin, button `font-size: 12px`, `font-weight: 400`, `line-height: 1.35`, and `color: #777986`.

- [ ] **Step 3: Add failing assertions for the placement popover.**

Assert that `.universe-placement-popover` remains framed (`background: #ffffff`, border, shadow), uses viewport-bounded fixed positioning on mobile, has `max-width: calc(100vw - 32px)`, and does not use `universe-transient-status-fade`.

- [ ] **Step 4: Add failing assertions for viewport-centered transient notice.**

Assert that `.universe-header-notice` is positioned relative to the viewport with `position: fixed`, `left: 50vw`, and `transform: translateX(-50%)`.

- [ ] **Step 5: Add failing assertion for select-arrow parity.**

Assert that both editor and relation select rules include `color-scheme: dark` while preserving the existing mobile 16px focus-safe override.

- [ ] **Step 6: Run the focused test and confirm RED before implementation.**

Run:
```bash
node --test tests/universe-detail-dayspace-header-polish.test.ts
```
Expected: at least the new Round 2 assertions fail on the branch before CSS changes.

- [ ] **Step 7: Commit the red tests.**

```bash
git add tests/universe-detail-dayspace-header-polish.test.ts
git commit -m "test: lock Universe mobile acceptance round 2"
```

### Task 2: Fix Day Space stacking and exact footer geometry

**Files:**
- Modify: `web/src/pages/universe-detail-dayspace-header-polish.css`
- Modify: `web/src/pages/universe/universe-node-detail-memory-shell.css`

**Interfaces:**
- Consumes: shared `.mobile-top-bar`, `.day-space-date-area`, `.universe-standalone-detail-actions`, editor/relation footer classes.
- Produces: top bar above Day Space content and one visual footer contract across detail/create/edit/relation.

- [ ] **Step 1: Raise only the Day Space mobile top bar above content.**

Use the existing Day Space-scoped selector:
```css
.app-shell:has(.day-space-page) .mobile-top-bar {
  position: sticky !important;
  z-index: 40 !important;
  top: 0 !important;
  border-bottom: 0 !important;
  background: #ffffff !important;
  background-image: none !important;
  opacity: 1;
  isolation: isolate;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
```
Do not alter the global `.mobile-top-bar` contract.

- [ ] **Step 2: Remove legacy relation/editor footer geometry that diverges from detail.**

In the accepted Universe mobile shell, keep both footers at:
```css
.universe-standalone-editor-footer,
.universe-standalone-connection-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin: 0;
  padding: 12px 0 0;
  border-top: 0;
  background: #101119;
}
```
Remove the relation-only `padding-bottom: 24px` source of vertical mismatch.

- [ ] **Step 3: Match footer text exactly to detail footer.**

Use:
```css
.universe-standalone-editor-footer button,
.universe-standalone-connection-footer button {
  min-width: 0;
  min-height: 0;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  color: #777986;
  background: transparent;
  box-shadow: none;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.35;
  white-space: nowrap;
}
```
Keep disabled actions muted via the existing disabled selector.

- [ ] **Step 4: Run the focused test.**

```bash
node --test tests/universe-detail-dayspace-header-polish.test.ts
```
Expected: Day Space/footer assertions pass; popover/notice/select assertions may still fail.

- [ ] **Step 5: Commit.**

```bash
git add web/src/pages/universe-detail-dayspace-header-polish.css web/src/pages/universe/universe-node-detail-memory-shell.css
git commit -m "fix: align Day Space header and Universe footers"
```

### Task 3: Restore and viewport-bound the add-planet placement popover

**Files:**
- Modify: `web/src/pages/universe-detail-dayspace-header-polish.css`
- Modify if needed after source inspection: `web/src/pages/universe-state-polish.css`

**Interfaces:**
- Consumes: existing `.universe-placement-popover` rendered by the Universe homepage placement flow.
- Produces: visible placement instruction surface that stays inside the mobile viewport.

- [ ] **Step 1: Remove `.universe-placement-popover` from the transient-status selector group.**

Only `.universe-map-mode-hint` may keep transient-status styling where appropriate. The placement popover must not receive transparent background, zero border, zero shadow, or fade animation.

- [ ] **Step 2: Add a mobile viewport-bounded placement surface.**

Use a fixed centered geometry independent of toolbar overflow:
```css
.universe-page:has(.universe-mobile-map) .universe-placement-popover {
  position: fixed !important;
  z-index: 41 !important;
  top: calc(64px + env(safe-area-inset-top, 0px)) !important;
  right: auto !important;
  left: 50vw !important;
  width: max-content !important;
  min-width: 188px !important;
  max-width: calc(100vw - 32px) !important;
  margin: 0 !important;
  padding: 5px !important;
  overflow: visible !important;
  border: 1px solid #e7e7e7 !important;
  border-radius: 10px !important;
  color: #555555 !important;
  background: #ffffff !important;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.07) !important;
  transform: translateX(-50%) !important;
  animation: none !important;
}
```
The `max-width` plus `50vw` centering guarantees at least 16px horizontal viewport clearance.

- [ ] **Step 3: Restore readable instructional copy inside the surface.**

Keep the existing child `<span>` visible with the original centered popover text styling; do not hide or fade it.

- [ ] **Step 4: Run focused test.**

```bash
node --test tests/universe-detail-dayspace-header-polish.test.ts
```
Expected: placement-popover assertions pass.

- [ ] **Step 5: Commit.**

```bash
git add web/src/pages/universe-detail-dayspace-header-polish.css web/src/pages/universe-state-polish.css
git commit -m "fix: restore bounded Universe placement popover"
```

### Task 4: Center transient notices on viewport and match native select arrows

**Files:**
- Modify: `web/src/pages/universe-detail-dayspace-header-polish.css`
- Modify: `web/src/pages/universe/universe-node-detail-memory-shell.css`

**Interfaces:**
- Consumes: existing `.universe-header-notice`, editor/relation native `<select>` elements.
- Produces: viewport-centered mutation feedback and matching dark native arrows.

- [ ] **Step 1: Anchor the three-second notice to the viewport.**

Use:
```css
.universe-page:has(.universe-mobile-map) .universe-header-notice {
  position: fixed;
  z-index: 42;
  top: calc(50px + env(safe-area-inset-top, 0px));
  left: 50vw;
  width: max-content;
  max-width: calc(100vw - 48px);
  text-align: center;
  transform: translateX(-50%);
  pointer-events: none;
}
```
Keep the existing React three-second timer and dialog pause logic unchanged.

- [ ] **Step 2: Give create/edit selects the same dark native UI scheme as relation selects.**

Add `color-scheme: dark;` to `.universe-standalone-editor .universe-standalone-form-field select` and retain the focused mobile `font-size: 16px !important` rule.

- [ ] **Step 3: Run focused test.**

```bash
node --test tests/universe-detail-dayspace-header-polish.test.ts
```
Expected: all Round 2 focused assertions pass.

- [ ] **Step 4: Commit.**

```bash
git add web/src/pages/universe-detail-dayspace-header-polish.css web/src/pages/universe/universe-node-detail-memory-shell.css
git commit -m "fix: center Universe notices and select arrows"
```

### Task 5: Final review and Draft PR

**Files:**
- Review all files changed in Tasks 1-4.

**Interfaces:**
- Produces: one isolated Draft PR against `codex/phase-6-web-ui-foundation`; no merge/deploy.

- [ ] **Step 1: Re-run the focused regression test.**

```bash
node --test tests/universe-detail-dayspace-header-polish.test.ts
```
Expected: PASS.

- [ ] **Step 2: Run static/build checks available in the environment.**

```bash
npm run typecheck
npm run build
npm --prefix web run typecheck
npm --prefix web run build
git diff --check codex/phase-6-web-ui-foundation...HEAD
```
Record any check that cannot be executed rather than claiming it passed.

- [ ] **Step 3: Inspect the final diff for scope.**

Verify there are no changes to Universe data/API/repository/search/MCP/Toy/Phase 8.5 and no desktop selectors broadened beyond the mobile media query.

- [ ] **Step 4: Open a Draft PR.**

Target `codex/phase-6-web-ui-foundation`; report exact base/head SHAs, changed files, checks, Vercel status, and `Production database touched: NO`.

- [ ] **Step 5: Stop before merge/deploy.**
