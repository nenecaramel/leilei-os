# Universe Mobile Paper Desktop Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the mobile Universe detail/create/edit Paper to the existing Universe web Paper structure and visual language, while preserving the accepted #118 behavior fixes.

**Architecture:** `UniverseNodePaper` remains the single component for detail, edit, and create. Remove the mobile-only presentation layer and let the existing Universe web Paper rules plus the shared responsive `PaperDetailDialog` rules render on mobile. Preserve only behavior changes from #118: edit Cancel returns to detail, successful edit Save returns to detail, create still closes, and the accepted top-right action semantics remain.

**Tech Stack:** React, TypeScript, CSS, Node test runner.

## Global Constraints

- Mobile Universe Paper only; do not redesign the Universe home/map.
- Do not change desktop Universe styles or shared `PaperDetailDialog` styles.
- Do not change canonical weighted galaxy memberships or relation behavior.
- Reuse existing web Paper structure/styles instead of introducing a new mobile visual system.
- Preserve #118 edit Cancel/Save return-to-detail behavior.
- No merge to `codex/phase-6-web-ui-foundation` without explicit user authorization.

---

### Task 1: Change regression coverage from mobile re-skin to web-Paper parity

**Files:**
- Modify: `tests/universe-mobile-node-paper.test.ts`

**Interfaces:**
- Consumes: `UniverseNodePaper.tsx`, `UniversePage.tsx` source text.
- Produces: regression assertions that preserve #118 behavior but require detail metadata to use `bottomLeft` and forbid the mobile-only collapsible `属性` structure/import.

- [ ] **Step 1: Update the failing test first**

Assert all of the following:

```ts
assert.doesNotMatch(paperSource, /universe-node-paper-mobile\.css/);
assert.doesNotMatch(paperSource, /<details className="universe-node-paper-properties">/);
assert.match(paperSource, /bottomLeft=\{metadata\}/);
assert.match(paperSource, /<div className="universe-node-paper-body">/);
```

Keep the existing assertions for `onCancelEdit`, edit Save returning to detail, create closing, and neutral removal.

- [ ] **Step 2: Verify expected RED state**

Run when a local runner is available:

```bash
pnpm exec tsx --test --test-concurrency=1 tests/universe-mobile-node-paper.test.ts
```

Expected before implementation: FAIL because production still imports `universe-node-paper-mobile.css`, renders collapsible `属性`, and only mounts metadata in `bottomLeft` for edit/create.

---

### Task 2: Restore the web Paper structure and visual classes

**Files:**
- Modify: `web/src/pages/universe/UniverseNodePaper.tsx`
- Delete: `web/src/pages/universe/universe-node-paper-mobile.css`

**Interfaces:**
- Consumes: existing shared `PaperDetailDialog`, base Universe Paper rules in `universe.css`, `UniverseNodeMetadata`.
- Produces: one Paper DOM structure shared across desktop/mobile; existing #118 behavior callbacks remain unchanged.

- [ ] **Step 1: Remove the mobile-only stylesheet import**

Delete:

```ts
import "./universe-node-paper-mobile.css";
```

- [ ] **Step 2: Restore metadata to the existing Paper footer in all modes**

Change:

```tsx
bottomLeft={isEdit ? metadata : null}
```

to:

```tsx
bottomLeft={metadata}
```

- [ ] **Step 3: Restore the shared web Paper body markup**

Use the same wrapper in edit/create and detail:

```tsx
<div className="universe-node-paper-body">
```

Detail uses the original unadorned elements:

```tsx
<h2>{effectiveNode!.title}</h2>
{effectiveNode!.summary ? <p>{effectiveNode!.summary}</p> : null}
{effectiveNode!.content ? <p>{effectiveNode!.content}</p> : null}
```

Remove the mobile-only `universe-node-paper-title`, `universe-node-paper-summary`, `universe-node-paper-content`, and `<details className="universe-node-paper-properties">…</details>` markup.

- [ ] **Step 4: Preserve accepted interaction behavior**

Do not change `onCancelEdit`, the edit-success return to detail in `UniversePage.tsx`, create-close behavior, relation callbacks, or weighted membership conversion/validation.

- [ ] **Step 5: Remove the now-unused mobile-only stylesheet**

Delete `web/src/pages/universe/universe-node-paper-mobile.css` so no stale mobile presentation layer can override the web Paper rules.

---

### Task 3: Verify the isolated change

**Files:**
- Verify: `tests/universe-mobile-node-paper.test.ts`
- Verify: `web/src/pages/universe/UniverseNodePaper.tsx`
- Verify: `web/src/pages/UniversePage.tsx`

**Interfaces:**
- Produces: a branch whose diff is limited to the Paper parity change plus this plan.

- [ ] **Step 1: Run targeted test**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/universe-mobile-node-paper.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run web typecheck/build**

```bash
pnpm --dir web typecheck
pnpm --dir web build
```

Expected: PASS.

- [ ] **Step 3: Review diff**

Confirm no changes to Universe home/map CSS, weighted data types, relation semantics, or shared Paper styles.

- [ ] **Step 4: Open a PR without merging**

Target `codex/phase-6-web-ui-foundation`. Report exact head SHA and CI/deployment status. Do not merge until the user explicitly asks.