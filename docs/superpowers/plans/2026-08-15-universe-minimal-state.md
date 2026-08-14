# Universe Minimal State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/universe` loading and uninitialized states pure white with the accepted shared `Universe` title and one centered gray status line only.

**Architecture:** Keep all ready-state Universe behavior untouched. Separate loading / uninitialized presentation from the `.universe-cosmos` canvas container so those states cannot inherit the canvas frame. Use the existing shared `memory-page-header` / `memory-page-title` title structure and a tiny state-only layout class that fills the remaining page height.

**Tech Stack:** React, TypeScript, CSS, Node test runner.

## Global Constraints

- Keep the existing shared mobile shell and the `Universe` title exactly where Memory / Diary titles sit.
- Page background stays pure white.
- Loading copy is exactly `正在读取 Universe…`.
- Uninitialized copy is exactly `Universe 还没有内容`.
- No frame, card, border, shadow, toolbar, controls, icons, dots, spinner, or decorative animation in loading / uninitialized states.
- State text uses neutral gray consistent with existing Leilei OS status copy.
- Do not alter ready-state Universe canvas, nodes, relations, editors, persistence, APIs, migrations, Global Search, MCP, or any other route.

---

### Task 1: Lock the minimal state contract with a regression test

**Files:**
- Create: `tests/universe-minimal-state-ui.test.ts`
- Read: `web/src/pages/UniversePage.tsx`
- Read: `web/src/pages/universe-state-polish.css`

**Interfaces:**
- Consumes: current `UniverseLoadingState`, `UniverseEmptyState`, `UniverseFrame` markup and state CSS.
- Produces: static regression assertions that prevent a canvas frame or animated dots from returning.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../web/src/pages/UniversePage.tsx", import.meta.url),
  "utf8",
);
const stateCss = readFileSync(
  new URL("../web/src/pages/universe-state-polish.css", import.meta.url),
  "utf8",
);

test("Universe loading and empty states are plain centered text on white", () => {
  assert.match(pageSource, /className="universe-state-stage universe-loading-state"/);
  assert.match(pageSource, /className="universe-state-stage universe-empty-state"/);
  assert.match(pageSource, />正在读取 Universe…</);
  assert.match(pageSource, />Universe 还没有内容</);
  assert.doesNotMatch(pageSource, /universe-loading-dots/);
  assert.doesNotMatch(pageSource, /universe-cosmos universe-cosmos-loading/);
  assert.doesNotMatch(pageSource, /universe-cosmos universe-cosmos-state/);

  assert.match(stateCss, /\.universe-state-page[\s\S]*display:\s*flex/);
  assert.match(stateCss, /\.universe-state-stage[\s\S]*place-items:\s*center/);
  assert.match(stateCss, /\.universe-state-copy[\s\S]*color:\s*#8d8d8d/);
  assert.doesNotMatch(stateCss, /universe-dot-pulse/);
});
```

- [ ] **Step 2: Verify the test is RED**

Run: `pnpm exec tsx --test tests/universe-minimal-state-ui.test.ts`
Expected: FAIL because current markup still uses `.universe-cosmos` and `.universe-loading-dots`.

- [ ] **Step 3: Commit the RED test**

```bash
git add tests/universe-minimal-state-ui.test.ts
git commit -m "test: lock minimal Universe states"
```

### Task 2: Remove the frame and center one gray line

**Files:**
- Modify: `web/src/pages/UniversePage.tsx`
- Modify: `web/src/pages/universe-state-polish.css`
- Test: `tests/universe-minimal-state-ui.test.ts`

**Interfaces:**
- Consumes: existing `UniverseFrame` title wrapper and existing state machine.
- Produces: `UniverseFrame` with state-only page class, `.universe-state-stage`, `.universe-state-copy`, and unchanged ready-state rendering.

- [ ] **Step 1: Implement the minimal markup**

Use exactly this state structure:

```tsx
function UniverseFrame({ children }: { children: ReactNode }) {
  return (
    <div className="page memory-page universe-page universe-state-page">
      <UniverseHeader />
      {children}
    </div>
  );
}

function UniverseLoadingState() {
  return (
    <section className="universe-state-stage universe-loading-state" aria-label="Universe 加载中" aria-live="polite">
      <p className="universe-state-copy">正在读取 Universe…</p>
    </section>
  );
}

function UniverseEmptyState() {
  return (
    <section className="universe-state-stage universe-empty-state" aria-live="polite">
      <p className="universe-state-copy">Universe 还没有内容</p>
    </section>
  );
}
```

Do not change the ready-state root or `UniverseCanvas`.

- [ ] **Step 2: Implement the minimal state CSS**

Replace loading / empty frame rules with:

```css
.universe-state-page {
  display: flex;
  min-height: calc(100dvh - (44px + env(safe-area-inset-top, 0px)));
  flex-direction: column;
}

.universe-state-page .universe-page-header {
  flex: 0 0 auto;
}

.universe-state-stage {
  display: grid;
  min-height: 0;
  flex: 1 1 auto;
  place-items: center;
  background: #ffffff;
}

.universe-state-copy {
  margin: 0;
  color: #8d8d8d;
  font-size: 13px;
  font-weight: 400;
  line-height: 1.55;
  text-align: center;
}
```

Delete `.universe-loading-dots`, its child rules, and `@keyframes universe-dot-pulse`. Do not add a substitute animation.

- [ ] **Step 3: Run focused test**

Run: `pnpm exec tsx --test tests/universe-minimal-state-ui.test.ts`
Expected: PASS.

- [ ] **Step 4: Run relevant Universe tests**

Run: `pnpm exec tsx --test --test-concurrency=1 tests/universe-*.test.ts`
Expected: PASS.

- [ ] **Step 5: Run build gates**

Run:
```bash
pnpm typecheck
pnpm build
pnpm --dir web typecheck
pnpm --dir web build
git diff --check
git status --short
```
Expected: all commands succeed; only planned files and docs are changed.

- [ ] **Step 6: Commit implementation**

```bash
git add web/src/pages/UniversePage.tsx web/src/pages/universe-state-polish.css tests/universe-minimal-state-ui.test.ts
git commit -m "fix: simplify Universe loading states"
```
