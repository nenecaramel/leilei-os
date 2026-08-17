# Universe Home Dark Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Universe ready-state home into a continuous near-black thought-map surface while preserving all existing Universe behavior and all accepted inner-page visuals.

**Architecture:** Add one final, ready-state-scoped CSS layer loaded after the accepted Universe geometry overrides. Use `:has(.universe-mobile-map)` as the existing ready-state boundary so the dark theme cannot leak into detail/create/edit/relation/Day Space. Keep the current React interaction model unchanged; use context-scoped selectors for the mobile top bar and Quick Search instead of modifying AppShell state or navigation behavior.

**Tech Stack:** React, TypeScript, CSS, Node test runner, Vite.

## Global Constraints

- Ready-state background is continuous near-black (`#090a10`–`#101119` range); no visible gradient, nebula, texture image, glass layer, or starfield animation.
- Do not modify Universe detail/create/edit/relation/Day Space accepted visuals.
- Do not modify navigation drawer or desktop sidebar.
- Do not change Universe data/service/API/MCP/database behavior.
- Preserve map pan, pinch zoom, fit-all, selection/open, move, placement, active-galaxy filtering, deep-link reveal, viewport persistence, notices, and export.
- Preserve accepted placement/export popover geometry from `universe-mobile-final-geometry.css`; this work changes color/surface only.
- Keep planets soft and data-led: no neon sci-fi balls, realistic textures, particle paths, blinking, or relation animations.
- Quick Search dark treatment must be Universe-context-only; its layout and search behavior remain unchanged.

---

### Task 1: Lock the ready-state dark-theme contract with a regression test

**Files:**
- Create: `tests/universe-home-dark-surface.test.ts`
- Read: `web/src/main.tsx`
- Read: `web/src/pages/universe/universe-home-polish.css`
- Read: `web/src/pages/universe-mobile-final-geometry.css`

**Interfaces:**
- Consumes: existing ready-state selector `.universe-page:has(.universe-mobile-map)` and accepted mobile geometry selectors.
- Produces: a static contract test that later tasks must satisfy without changing interaction code.

- [ ] **Step 1: Write the failing test**

Create a Node test that reads `universe-home-dark.css`, `universe-mobile-final-geometry.css`, and `main.tsx`, then asserts:

```ts
assert.match(mainTsx, /import "\.\/pages\/universe-home-dark\.css";/);
assert.match(darkCss, /--universe-home-bg:\s*#0b0c12/);
assert.match(darkCss, /body:has\(\.universe-page:has\(\.universe-mobile-map\)\) \.mobile-top-bar/);
assert.match(darkCss, /body:has\(\.universe-page:has\(\.universe-mobile-map\)\) \.quick-search-panel/);
assert.match(darkCss, /\.universe-page:has\(\.universe-mobile-map\) \.universe-map-planet-core/);
assert.match(darkCss, /\.universe-page:has\(\.universe-mobile-map\) \.universe-map-relation/);
assert.match(darkCss, /\.universe-page:has\(\.universe-mobile-map\) \.universe-placement-popover/);
assert.doesNotMatch(darkCss, /\.universe-standalone-(?:detail|editor|connection)/);
assert.match(geometryCss, /padding:\s*6px 8px !important/);
```

Also assert that the new layer does not restyle `.mobile-drawer` or `.sidebar`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test tests/universe-home-dark-surface.test.ts
```

Expected: FAIL because `universe-home-dark.css` and its import do not exist yet.

- [ ] **Step 3: Commit the failing contract test**

```bash
git add tests/universe-home-dark-surface.test.ts
git commit -m "test: lock Universe dark home contract"
```

---

### Task 2: Add the isolated ready-state dark surface and floating controls

**Files:**
- Create: `web/src/pages/universe-home-dark.css`
- Modify: `web/src/main.tsx`
- Test: `tests/universe-home-dark-surface.test.ts`

**Interfaces:**
- Consumes: `.universe-page:has(.universe-mobile-map)`, `.universe-page-header`, `.memory-page-title`, `.universe-header-action`, `.universe-galaxy-entry`, `.universe-map-fit`, `.universe-floating-popover`.
- Produces: shared ready-state color tokens and the final cascade layer loaded after `universe-mobile-final-geometry.css`.

- [ ] **Step 1: Add the final stylesheet import**

Append after the accepted geometry import:

```ts
import "./pages/universe-mobile-final-geometry.css";
import "./pages/universe-home-dark.css";
```

- [ ] **Step 2: Implement the ready-state surface tokens and shell**

Create `universe-home-dark.css` with a single scoped token block:

```css
.universe-page:has(.universe-mobile-map) {
  --universe-home-bg: #0b0c12;
  --universe-home-surface: #171820;
  --universe-home-surface-hover: #22232b;
  --universe-home-border: #343640;
  --universe-home-title: #e8e7ec;
  --universe-home-strong: #d6d5dc;
  --universe-home-text: #b6b5bd;
  --universe-home-control: #898a94;
  --universe-home-muted: #70727d;
  color: var(--universe-home-text);
  background: var(--universe-home-bg) !important;
}
```

Scope page/map/shell surfaces to the same background. On mobile, context-scope the shared top bar with:

```css
body:has(.universe-page:has(.universe-mobile-map)) .mobile-top-bar { ... }
```

Do not mention `.mobile-drawer` or `.sidebar` in the stylesheet.

- [ ] **Step 3: Restyle title and floating controls without geometry changes**

Set `Universe` to warm white, header actions to `#aaaab3` with active/expanded `#e0dfe5`, and galaxy/filter controls to `#898a94` with active/pressed `#d6d5dc`. Keep backgrounds transparent, borders zero, and existing dimensions/positions untouched.

- [ ] **Step 4: Run the focused contract test**

Run:

```bash
node --test tests/universe-home-dark-surface.test.ts
```

Expected: PASS for shell/import/isolation assertions.

- [ ] **Step 5: Commit**

```bash
git add web/src/main.tsx web/src/pages/universe-home-dark.css tests/universe-home-dark-surface.test.ts
git commit -m "feat: add Universe dark home surface"
```

---

### Task 3: Restyle planets, membership rings, relations, labels, and reference dots

**Files:**
- Modify: `web/src/pages/universe-home-dark.css`
- Test: `tests/universe-home-dark-surface.test.ts`

**Interfaces:**
- Consumes: existing classes emitted by `UniverseMobileMap`: `.universe-map-planet-core`, `.universe-map-membership-ring`, `.universe-map-planet-title`, `.universe-map-relation`, `.universe-map-relation-label`, `.universe-map-reference-dots i`, plus `.is-selected`, `.is-muted`, `.is-emphasized`.
- Produces: dark-map visual hierarchy without changing presentation/state logic.

- [ ] **Step 1: Extend the failing test with map hierarchy assertions**

Require the stylesheet to contain:

```ts
assert.match(darkCss, /\.universe-map-planet\.is-selected \.universe-map-planet-core/);
assert.match(darkCss, /\.universe-map-planet\.is-muted/);
assert.match(darkCss, /\.universe-map-relation\.is-emphasized/);
assert.match(darkCss, /\.universe-map-reference-dots i/);
```

- [ ] **Step 2: Implement planet treatment**

Use the existing `--planet-color` variable with dark-background `color-mix` rather than hard-coded galaxy colors. Keep one small low-opacity same-color glow, retain thin membership rings, add an extremely thin warm-white selected ring, and keep muted nodes visible at roughly 0.28 opacity. Do not change planet size or transform geometry.

- [ ] **Step 3: Implement relation hierarchy**

Default relation line `#343640`; emphasized relation `#676974`; default labels `#70727d`; emphasized labels `#aaaab3`. Replace the old white text-shadow with a very soft near-black shadow so labels remain readable without badges.

- [ ] **Step 4: Implement reference dots**

Keep existing 18 DOM dots and style them around `#292a32`, with no animation.

- [ ] **Step 5: Run focused tests and commit**

```bash
node --test tests/universe-home-dark-surface.test.ts
git add web/src/pages/universe-home-dark.css tests/universe-home-dark-surface.test.ts
git commit -m "feat: restyle Universe dark map hierarchy"
```

---

### Task 4: Dark-theme popovers, notices, galaxy menu, and Universe-context Quick Search

**Files:**
- Modify: `web/src/pages/universe-home-dark.css`
- Test: `tests/universe-home-dark-surface.test.ts`
- Read: `web/src/layout/QuickSearchPanel.tsx`

**Interfaces:**
- Consumes: `.universe-placement-popover`, `.universe-overflow-menu`, `.universe-galaxy-menu`, `.universe-header-notice`, `.universe-notice`, `.quick-search-panel`, `.quick-search-field`, `.quick-search-state`, `.quick-search-result`, `.quick-search-view-all`.
- Produces: consistent dark popover surfaces while preserving accepted popover geometry and Quick Search behavior/layout.

- [ ] **Step 1: Add failing surface assertions**

Assert the Universe popovers use `--universe-home-surface` / `--universe-home-border`, Quick Search selectors are prefixed by Universe-ready-state `body:has(...)`, and no rule changes placement/export width/height variables.

- [ ] **Step 2: Implement Universe popovers and galaxy menu**

Use `#171820` surface, 1px `#343640` border, 10px radius, restrained black shadow, default text near `#b0aeb7`, hover/active near `#ecebf0`, and hover row `#22232b`. Preserve geometry rules in `universe-mobile-final-geometry.css` by avoiding width/height/padding overrides for placement/export.

- [ ] **Step 3: Implement notice colors**

Keep unframed text and current placement. Normal notice `#8f909b`; do not introduce a green success state or Toast card.

- [ ] **Step 4: Implement Universe-context Quick Search**

Under only:

```css
body:has(.universe-page:has(.universe-mobile-map))
```

restyle the panel, field, input, icon, state text, result rows, module labels, snippets, separators, and view-all action to the same dark surface language. Do not alter dimensions, position, debounce, result behavior, or navigation.

- [ ] **Step 5: Run focused tests and commit**

```bash
node --test tests/universe-home-dark-surface.test.ts
git add web/src/pages/universe-home-dark.css tests/universe-home-dark-surface.test.ts
git commit -m "feat: finish Universe dark home overlays"
```

---

### Task 5: Regression verification and PR readiness

**Files:**
- Verify only; no planned production code changes unless verification exposes a regression.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: evidence that the change is UI-only, isolated, and build-safe.

- [ ] **Step 1: Run focused Universe tests**

Run the repository's existing focused Universe CSS/interaction tests, including:

```bash
node --test tests/universe-home-dark-surface.test.ts tests/universe-mobile-visual-geometry-regression.test.ts
```

Then run the existing Universe map/location/interaction focused tests discovered from package scripts/test names.

- [ ] **Step 2: Run type/build gates**

Use repository scripts exactly as defined by `package.json` / `web/package.json`:

```bash
npm run typecheck
npm run build
npm --prefix web run typecheck
npm --prefix web run build
```

If script names differ, use the actual repository script names rather than inventing substitutes.

- [ ] **Step 3: Run diff hygiene**

```bash
git diff --check
```

Confirm changed production files are limited to the final dark-home stylesheet and its import; tests/docs may also change. Confirm no Universe TS behavior, API, database, MCP, drawer, or sidebar file changed.

- [ ] **Step 4: Review cascade against accepted geometry**

Check that `universe-home-dark.css` loads after `universe-mobile-final-geometry.css`, does not set placement/export heights or paddings, and does not contain `.universe-standalone-detail`, `.universe-standalone-editor`, `.universe-standalone-connection`, `.mobile-drawer`, or `.sidebar` selectors.

- [ ] **Step 5: Open PR without merging**

Open one UI PR against the then-current `codex/phase-6-web-ui-foundation`. If mainline has advanced due to Phase 8.5 or Toy work, sync/merge the latest base into this branch without force-push and resolve only genuine conflicts. PR body must distinguish code complete, validation complete, deployment pending, and production visual acceptance pending.
