# Universe Relation Monochrome Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mobile “让两个思想相遇” relation paper visually match the accepted Universe detail card shell and use a restrained warm black/white/gray hierarchy.

**Architecture:** Keep all relation data/state/save behavior in `UniverseRelationPaper.tsx`. Add only relation-specific mobile markup classes and relation-specific CSS overrides; reuse the existing `PaperDetailDialog` veil click for closing and copy the accepted detail shell geometry exactly instead of changing shared editor/create styles.

**Tech Stack:** React/TypeScript, existing CSS, Node test runner source-level regression tests.

## Global Constraints

- Mobile relation shell must match the accepted detail shell: width `min(665px, calc(100vw - 46px))`, height `clamp(506px, calc(78dvh - 54px), 666px)`, short height `calc(100dvh - 50px)`, radius 14px, translateY 16px, detail veil `rgba(3, 4, 9, 0.5)` + blur 4px.
- Palette is only `#101119`, `#f5f2e9`, `#d7d5d0`, `#7d7f8c`, `#343640`, `#555763` for this mobile relation UI.
- Do not alter detail, homepage/map, desktop relation UI, relation semantics, target filtering, API payloads, persistence, or save reconciliation.
- No in-card mobile close icon; outside veil click is the close interaction.

---

### Task 1: Lock the approved mobile relation design with regression assertions

**Files:**
- Create: `tests/universe-relation-monochrome-card.test.ts`
- Read: `web/src/pages/universe/UniverseRelationPaper.tsx`
- Read: `web/src/pages/universe/universe-node-detail-memory-shell.css`
- Read: `web/src/pages/universe/universe-node-paper-web-mobile.css`

**Interfaces:**
- Consumes: existing mobile relation markup and detail-shell CSS.
- Produces: source-level assertions that fail on the current green-accented/large relation UI and pass only when the approved hierarchy is implemented.

- [ ] **Step 1: Write the failing source-level test**

Assert that mobile relation markup includes `当前思想 · {source.title}`, the approved intro, no eyebrow, and no `universe-standalone-close`; assert relation-specific CSS contains the exact detail shell geometry and monochrome control/footer values.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --experimental-strip-types --test tests/universe-relation-monochrome-card.test.ts`

Expected: FAIL because current relation markup still contains the eyebrow/close button and current shared styling still uses the large card/green accent.

- [ ] **Step 3: Commit the failing test**

Commit only the new regression test.

### Task 2: Replace the mobile relation header/content markup without changing behavior

**Files:**
- Modify: `web/src/pages/universe/UniverseRelationPaper.tsx`

**Interfaces:**
- Consumes: `source`, `nodes`, `selectedTargetId`, `relationType`, `strength`, `saveSelectedRelation`, `onRequestClose`.
- Produces: the same target/type/strength controls and save payload with lighter mobile-only structure.

- [ ] **Step 1: Replace mobile-only header markup**

Use a simple content block:
- context: `当前思想 · {source.title}`
- h2: `让两个思想相遇`
- intro: `选择另一个思想，并定义它们之间的关系。`

Remove the mobile eyebrow and mobile close button. Do not change desktop body.

- [ ] **Step 2: Keep target/type/strength behavior intact**

Keep the same `<select>` values/change handlers, range bounds/step/value/change handler, disabled condition `saving || !target`, and `saveSelectedRelation` payload.

- [ ] **Step 3: Add relation-specific class hooks only where needed**

Add relation-specific body/content/footer class names so CSS can avoid affecting editor/create/detail.

### Task 3: Make relation shell and controls match the accepted detail card

**Files:**
- Modify: `web/src/pages/universe/universe-node-detail-memory-shell.css`
- Modify only if required for base range compatibility: `web/src/pages/universe/universe-node-paper-web-mobile.css`

**Interfaces:**
- Consumes: `.universe-standalone-connection` markup and existing `PaperDetailDialog` structure.
- Produces: exact detail shell geometry and monochrome relation-only styling.

- [ ] **Step 1: Extend the accepted shell selector to relation paper**

Apply the exact accepted detail width/height/radius/shadow/transform/short-height values to `.paper-detail-paper:has(.universe-standalone-connection)` and the exact detail veil values to its layer.

- [ ] **Step 2: Build fixed three-row relation layout**

Set the relation card to `display:grid`, `height:100%`, `grid-template-rows:auto minmax(0,1fr) auto`, `padding:16px 20px 14px`, `overflow:hidden`, radius 14px, background `#101119`, no inner shadow.

- [ ] **Step 3: Apply approved text hierarchy and spacing**

Context 12px `#7d7f8c`; title 24px/500/1.08 `#f5f2e9`; intro 13px `#7d7f8c`; labels 12px `#7d7f8c`; control groups use 8px label gap and 18px group spacing.

- [ ] **Step 4: Restyle target/type selects**

44px height, 10px radius, `#343640` border, `#101119` background, 15px `#d7d5d0` text, no shadow; focus border `#7d7f8c` only.

- [ ] **Step 5: Restyle strength control**

Label 12px `#7d7f8c`, percent 15px `#f5f2e9`, 3px track with active `#d7d5d0`, inactive `#343640`, approximately 18px warm-white thumb, no glow.

- [ ] **Step 6: Restyle fixed footer as text actions**

No divider/pills/backgrounds. Cancel 12px `#7d7f8c`; primary 12px `#f5f2e9`; disabled primary `#555763` without opacity-based accent behavior.

### Task 4: Verify, inspect scope, and merge

**Files:**
- Test: `tests/universe-relation-monochrome-card.test.ts`
- Review: all branch changes against `codex/phase-6-web-ui-foundation`

**Interfaces:**
- Consumes: completed relation markup/CSS.
- Produces: merge-ready PR with no unrelated changes.

- [ ] **Step 1: Run focused test and verify GREEN**

Run: `node --experimental-strip-types --test tests/universe-relation-monochrome-card.test.ts`

Expected: PASS with 0 failures.

- [ ] **Step 2: Re-read behavior-critical relation source**

Confirm target excludes source, starts empty, save disabled without target, relation type/strength handlers and save payload are unchanged.

- [ ] **Step 3: Compare branch to fresh production baseline**

Confirm only design/plan docs, focused test, relation component and relation/detail-shell CSS changed.

- [ ] **Step 4: Create PR and merge with expected head SHA**

Merge only if production base has not moved unexpectedly or GitHub reports the PR mergeable against the intended base.

- [ ] **Step 5: Check merge SHA status separately**

Report merged, deployment, and production acceptance as separate states; do not infer deployment from merge.
