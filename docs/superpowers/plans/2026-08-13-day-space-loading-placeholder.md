# Day Space Loading Placeholder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both Day Space loading messages use exactly the same placeholder placement and typography as the accepted empty-state message without changing data behavior.

**Architecture:** Keep the existing Day Space state machine and copy untouched. Route both loading render paths through the existing `day-space-stage-measure` region and give loading/empty placeholders one shared CSS class so the empty-state visual contract is the single source of truth.

**Tech Stack:** React, TypeScript, CSS, Node test runner + tsx, jsdom, Vite.

## Global Constraints

- Start from accepted production baseline `8208e4616b11361f5978768f0b3d59372a9e3740` on isolated branch `feat/day-space-loading-placeholder`.
- Keep loading copy exactly `正在读取 Day Space…` and `正在读取当天内容…`.
- Keep `role="status"` semantics for loading states.
- Loading and empty placeholders share centered text, `padding-top: 94px`, `font-size: 12px`, `font-weight: 400`, and the same muted text color.
- No spinner, animation, skeleton, new component pattern, or new copy.
- No request flow, discovery logic, module state machine, retry/error/warning, paper layout, date navigation, Home Records, Todo/Diary behavior, Calendar, API/schema/migration/persistence, MCP, PWA, or unrelated CSS changes.

---

### Task 1: Align Day Space loading placeholders with the empty state

**Files:**
- Modify: `tests/day-space-real-data.test.ts`
- Modify: `web/src/pages/DaySpacePage.tsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: existing `discoveryStatus`, `selectedDate`, `bothModulesFailed`, `moduleWarning`, `papers`, and `completeEmpty` state decisions in `DaySpacePageContent`.
- Produces: one shared placeholder class, `day-space-placeholder`, used by empty and loading messages inside `day-space-stage-measure`.

- [ ] **Step 1: Add a failing structural contract test**

Add a focused test that reads `DaySpacePage.tsx` and `styles.css` and asserts:

```ts
assert.match(daySpaceSource, /className="day-space-placeholder" role="status">正在读取 Day Space…<\/div>/);
assert.match(daySpaceSource, /className="day-space-placeholder" role="status">正在读取当天内容…<\/div>/);
assert.match(daySpaceSource, /className="day-space-placeholder">这一天还没有内容<\/div>/);
assert.doesNotMatch(daySpaceSource, /className="day-space-loading"/);
assert.match(stylesSource, /\.day-space-placeholder\s*\{[^}]*padding-top:\s*94px[^}]*font-size:\s*12px[^}]*font-weight:\s*400[^}]*text-align:\s*center/s);
```

Also assert that the discovery-loading message is rendered inside the `day-space-stage-measure` block rather than as a standalone sibling before that block.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec tsx --test --test-concurrency=1 tests/day-space-real-data.test.ts
```

Expected: the new structural assertions fail because loading still uses `day-space-loading` and the discovery-loading block is outside `day-space-stage-measure`.

- [ ] **Step 3: Make the minimal JSX change**

In `DaySpacePage.tsx`:

- Remove the standalone discovery-loading render before `day-space-stage-measure`.
- Inside `day-space-stage-measure`, make the first branch render discovery loading when `discoveryStatus === "loading" && !selectedDate`:

```tsx
<div className="day-space-placeholder" role="status">正在读取 Day Space…</div>
```

- Keep the existing error/warning branches outside the stage-measure placeholder branch.
- Change the accepted empty state to:

```tsx
<div className="day-space-placeholder">这一天还没有内容</div>
```

- Change the selected-date content-loading state to:

```tsx
<div className="day-space-placeholder" role="status">正在读取当天内容…</div>
```

Do not alter any state condition beyond moving the discovery-loading output into the stage-measure branch.

- [ ] **Step 4: Share the existing empty-state CSS**

Replace the empty-only rule with:

```css
.day-space-placeholder {
  padding-top: 94px;
  color: #aaaaaa;
  font-size: 12px;
  font-weight: 400;
  text-align: center;
}
```

Remove any now-obsolete Day Space loading rule only if it is used exclusively by these two loading messages. Do not touch unrelated loading classes elsewhere.

- [ ] **Step 5: Run focused verification**

Run:

```bash
pnpm exec tsx --test --test-concurrency=1 tests/day-space-real-data.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run full project gates**

Run:

```bash
pnpm exec tsx --test --test-concurrency=1 tests/**/*.test.ts
pnpm typecheck
pnpm build
pnpm --dir web typecheck
pnpm --dir web build
git diff --check
git status --short
```

Expected: zero test failures; all type/build commands exit `0`; no whitespace errors; branch diff contains only the approved spec/plan plus focused Day Space test/JSX/CSS changes.

- [ ] **Step 7: Commit and verify feature deployment**

Commit only the approved files, push `feat/day-space-loading-placeholder` without force, verify the remote SHA, and wait for the Vercel feature deployment status to succeed before any production merge.
