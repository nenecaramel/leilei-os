# Universe Mobile Production Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved production-phone polish to the Universe mobile ready state: paler edge-to-edge map, unified anchored popovers, and Memory/Diary/Task-style node papers without changing Universe data or backend semantics.

**Architecture:** Keep the existing `UniversePage → UniverseService → UniverseAdapter` flow intact. Confine changes to ready-state React/CSS/presentation helpers. Add one small reusable Universe floating-popover primitive and one focused node-metadata component so top controls and Paper metadata share consistent outside-click behavior without expanding `UniversePage.tsx` or `UniverseNodePaper.tsx` into monoliths.

**Tech Stack:** React, TypeScript, existing CSS, Node test runner via `pnpm exec tsx --test`, existing `PaperDetailDialog`, existing Universe service/adapter.

## Global Constraints

- Base branch is `codex/phase-6-web-ui-foundation` at `800b5fcb84c1929d9626f192cfce8564847c9dfa`.
- Work only on `codex/phase-8-3-universe-mobile-polish`.
- Mobile ready-state only. Do not redesign desktop.
- Loading/error/uninitialized/importer states must remain unchanged.
- No backend/API/database/schema/migration/Auth/MCP/PWA changes.
- Preserve weighted memberships exactly as `{ id: string, weight: number }[]`.
- Never invent membership weights; finite-number validation only; do not clamp weight to `[0,1]`.
- Preserve canonical node positions and the existing `0..100` write domain.
- Preserve whole-snapshot optimistic-version writes and authoritative reread/reconciliation behavior.
- Preserve current pan/pinch/select/long-press move/reveal/relation-target semantics.
- Reuse `PaperDetailDialog`; Memory/Diary/Task visuals must not regress.
- Universe node papers opt out of ruled lines locally; do not remove lines globally.
- Strict TDD: every task starts with a failing focused test and ends with a focused passing test before commit.

---

## File Structure

**Create**

- `web/src/pages/universe/UniverseFloatingPopover.tsx` — anchored, outside-click-close primitive for Universe top/menu interactions.
- `web/src/pages/universe/UniverseNodeMetadata.tsx` — read/edit footer metadata, type/importance/tag/galaxy popovers, pending-weight draft validation.

**Modify**

- `web/src/pages/UniversePage.tsx` — wire mutually exclusive top popovers, placement cancellation, remove duplicate placement notice.
- `web/src/pages/universe/UniverseGalaxyPicker.tsx` — convert bottom sheet to anchored popover using shared primitive.
- `web/src/pages/universe/UniverseMobileMap.tsx` — only if needed for control alignment/placement-cancel event wiring; do not change map semantics.
- `web/src/pages/universe/UniverseNodePaper.tsx` — reading-first detail, same-paper editing, timestamp formatting, lightweight Connections, metadata footer.
- `web/src/pages/PaperDetailDialog.tsx` — add a backwards-compatible local opt-out for ruled lines if CSS-only scoping is not sufficiently explicit; default must preserve all existing consumers.
- `web/src/pages/universe/universe-map-presentation.ts` — compress visual intensity only; no semantic priority changes.
- `web/src/pages/universe-state-polish.css` — map/popup/full-width/Paper styling.
- `web/src/styles.css` — only if shared Paper needs the explicit optional rule toggle; otherwise leave shared CSS unchanged.

**Tests**

- `tests/universe-mobile-ready-state-ui.test.ts`
- `tests/universe-mobile-interaction.integration.test.ts`
- `tests/universe-map-presentation.test.ts`
- `tests/universe-paper-ui.test.ts`
- `tests/universe-paper-interaction.integration.test.ts`
- `tests/universe-web-page.test.ts`
- add a focused metadata test file only if current paper tests become unwieldy.

---

### Task 1: Shared anchored Universe popover primitive

**Files:**
- Create: `web/src/pages/universe/UniverseFloatingPopover.tsx`
- Test: `tests/universe-mobile-interaction.integration.test.ts`

**Interfaces:**
- Produces:
```ts
export type UniverseFloatingPopoverProps = {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  className?: string;
  ariaLabel: string;
  onRequestClose(): void;
  children: React.ReactNode;
};
```
- Behavior: renders only while open; anchored by parent/wrapper geometry; closes on pointer/mousedown outside and Escape; events inside do not close before child action runs.

- [ ] **Step 1: Write failing tests for outside-click and Escape close**

Add mounted tests that open a popover, click inside, verify it remains, then click an outside element and verify `onRequestClose` fires exactly once. Add Escape coverage.

```ts
assert.equal(closeCount, 0);
inside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
assert.equal(closeCount, 0);
outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
assert.equal(closeCount, 1);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:
```bash
pnpm exec tsx --test --test-concurrency=1 tests/universe-mobile-interaction.integration.test.ts
```
Expected: new popover test fails because the component does not exist.

- [ ] **Step 3: Implement the minimal primitive**

Use a wrapper `ref`, document-level `mousedown`/`pointerdown`, and `keydown`. Do not create a modal backdrop.

```tsx
if (!open) return null;
return (
  <div ref={rootRef} className={className} role="menu" aria-label={ariaLabel}>
    {children}
  </div>
);
```

- [ ] **Step 4: Re-run focused tests and verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/universe/UniverseFloatingPopover.tsx tests/universe-mobile-interaction.integration.test.ts
git commit -m "feat: add Universe anchored popovers"
```

---

### Task 2: Top controls, outside-close behavior, and placement cancellation

**Files:**
- Modify: `web/src/pages/UniversePage.tsx`
- Modify: `web/src/pages/universe/UniverseGalaxyPicker.tsx`
- Modify: `web/src/pages/universe-state-polish.css`
- Test: `tests/universe-mobile-interaction.integration.test.ts`
- Test: `tests/universe-web-page.test.ts`

**Interfaces:**
- Top-level open state remains controlled by `UniversePage`.
- `＋`, `···`, and `星系` are mutually exclusive.
- Placement cancel transitions `mapMode` from `{kind:"placing-node"}` to `{kind:"browse"}` with no write and no `pendingPosition`.

- [ ] **Step 1: Add failing tests**

Cover all of the following:

```ts
// export menu: outside click closes
// add hint: no explicit cancel button; outside click returns to browse
// galaxy menu: anchored/non-modal; outside click closes without selection change
// opening one top-level popover closes the other two
// placement copy is not rendered as .universe-notice
```

Source-level assertions in `universe-web-page.test.ts` must reject the old fixed bottom-sheet/backdrop classes.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/universe-mobile-interaction.integration.test.ts tests/universe-web-page.test.ts
```

- [ ] **Step 3: Refactor top actions to anchored wrappers**

Give `＋` and `···` stable trigger refs. Opening one closes galaxy and the other header menu.

Pseudo-state transition to implement exactly:

```ts
function cancelPlacement() {
  if (mapMode.kind !== "placing-node") return;
  setMapMode({ kind: "browse" });
  setPendingPosition(null);
}
```

Do not call the service from cancellation.

- [ ] **Step 4: Remove duplicate placement notice**

Do not call `setNotice("点击地图选择新星球的位置。")` when entering placement. Render that copy only inside the `＋` anchored popover. Existing mutation success/error notices remain unchanged.

- [ ] **Step 5: Convert `UniverseGalaxyPicker` to anchored popover**

Delete the fixed bottom-sheet/backdrop behavior. Keep sorted galaxy order and active selection semantics.

- [ ] **Step 6: CSS the unified popover language**

Use white, ~1px pale border, ~10px radius, soft shadow. Single-action/instruction copy centered. `导出` centered. No dim backdrop.

- [ ] **Step 7: Re-run focused tests**

- [ ] **Step 8: Commit**

```bash
git add web/src/pages/UniversePage.tsx web/src/pages/universe/UniverseGalaxyPicker.tsx web/src/pages/universe-state-polish.css tests/universe-mobile-interaction.integration.test.ts tests/universe-web-page.test.ts
git commit -m "fix: polish Universe mobile controls"
```

---

### Task 3: Edge-to-edge ready map, aligned controls, and much paler presentation

**Files:**
- Modify: `web/src/pages/universe-state-polish.css`
- Modify: `web/src/pages/universe/universe-map-presentation.ts`
- Test: `tests/universe-map-presentation.test.ts`
- Test: `tests/universe-mobile-ready-state-ui.test.ts`

**Interfaces:**
- Presentation priority remains `selected > direct neighbor/selected relation > active galaxy > ordinary > faded`.
- This task changes visual intensity, not membership/selection rules.

- [ ] **Step 1: Add failing presentation/UI tests**

Assert selected/neighbor/faded ordering is unchanged, but encode a restrained opacity/width ceiling for idle relations and a pale-color treatment hook/class. Add source/CSS assertions that ready `.universe-page` escapes inherited mobile side gutters while importer/loading selectors retain their existing layout.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/universe-map-presentation.test.ts tests/universe-mobile-ready-state-ui.test.ts
```

- [ ] **Step 3: Compress relation intensity**

Keep strength monotonic but narrow the visual range. High-strength idle lines must remain subtle; selected/emphasized topology may still become clear.

Do not alter relation type or strength data.

- [ ] **Step 4: Pale planet/ring CSS**

Use color mixing/opacity rather than replacing galaxy colors. Primary color identity must remain derived from the current highest-weight membership.

- [ ] **Step 5: Make ready state edge-to-edge only**

Scope the width override to ready map presence, for example via `:has(.universe-mobile-map)`, so importer/loading/error keep accepted widths.

- [ ] **Step 6: Align `星系` and `查看全部`**

Place both at one vertical level and shift the row upward approximately 20px from the production screenshot position. Do not add persistent zoom controls.

- [ ] **Step 7: Run tests and commit**

```bash
git add web/src/pages/universe-state-polish.css web/src/pages/universe/universe-map-presentation.ts tests/universe-map-presentation.test.ts tests/universe-mobile-ready-state-ui.test.ts
git commit -m "style: soften Universe mobile star map"
```

---

### Task 4: Universe node Paper shell opt-out and timestamp formatting

**Files:**
- Modify: `web/src/pages/PaperDetailDialog.tsx` only if an explicit opt-out is used
- Modify: `web/src/pages/universe/UniverseNodePaper.tsx`
- Modify: `web/src/pages/universe-state-polish.css`
- Test: `tests/universe-paper-ui.test.ts`
- Test: existing Memory/Diary/Task paper tests

**Interfaces:**
- If adding a shared prop, use:
```ts
showRules?: boolean; // default true
```
- Universe Node Paper passes `showRules={false}`.
- Other consumers require no call-site changes and preserve current rendering.

- [ ] **Step 1: Add RED tests**

Verify Universe node create/detail/edit paper has no rendered rules and no `Universe` signature, while a default `PaperDetailDialog` still renders rules.

Add timestamp formatter tests for `YYYY.MM.DD HH:mm` and invalid fallback.

- [ ] **Step 2: Run focused paper tests**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/universe-paper-ui.test.ts
```

- [ ] **Step 3: Implement local rules opt-out**

Prefer explicit JSX behavior:

```tsx
{showRules ? (
  <div className="paper-detail-rules" aria-hidden="true">...</div>
) : null}
```

Default must be `true`.

- [ ] **Step 4: Remove Universe signature and raw ISO**

Pass `signature=""`. Add a dedicated pure formatter in the Universe paper/presentation module and render readable local time for existing nodes; create renders current local time captured for the open draft.

- [ ] **Step 5: Re-run Universe + shared paper tests**

Also run the relevant Memory/Diary/Task paper test files to prove no regression.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/PaperDetailDialog.tsx web/src/pages/universe/UniverseNodePaper.tsx web/src/pages/universe-state-polish.css tests/universe-paper-ui.test.ts
git commit -m "style: align Universe node paper shell"
```

---

### Task 5: Reading-first node detail and lightweight Connections

**Files:**
- Modify: `web/src/pages/universe/UniverseNodePaper.tsx`
- Modify: `web/src/pages/universe-state-polish.css`
- Test: `tests/universe-paper-interaction.integration.test.ts`
- Test: `tests/universe-paper-ui.test.ts`

**Interfaces:**
- Detail top-right = `编辑 · ···`.
- Detail overflow actions call the existing callbacks: `onCreateRelation`, `onRestore`, and existing node-delete callback if retained.
- Related-node click keeps existing `onOpenRelatedNode(nodeId)` behavior.

- [ ] **Step 1: Add RED tests**

Assert detail paper:

```ts
// contains title, optional summary, optional content
// does not contain dt labels 类型/重要性/标签/星系
// top-right exposes 编辑 and overflow
// relation row exposes target title + relation type
// no per-row large "移除连接" action in read mode
```

- [ ] **Step 2: Run focused tests**

- [ ] **Step 3: Replace field inspector with reading layout**

Remove the detail `<dl>`. Render title, summary, content in order. Keep empty values omitted.

- [ ] **Step 4: Move low-frequency actions into overflow**

`建立连接` and available restore action live under a small paper-local popover. Do not change the existing relation-target state machine.

- [ ] **Step 5: Restyle Connections**

Each row is text-first. Target title click remains the navigation action. Relation type is lighter adjacent text.

- [ ] **Step 6: Verify related-node behavior remains mounted and real**

The existing integration must still prove closing paper + reveal selection behavior through `UniversePage`/map wiring.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/universe/UniverseNodePaper.tsx web/src/pages/universe-state-polish.css tests/universe-paper-interaction.integration.test.ts tests/universe-paper-ui.test.ts
git commit -m "feat: simplify Universe node detail paper"
```

---

### Task 6: Footer metadata component and exact weighted editing

**Files:**
- Create: `web/src/pages/universe/UniverseNodeMetadata.tsx`
- Modify: `web/src/pages/universe/UniverseNodePaper.tsx`
- Modify: `web/src/pages/universe-state-polish.css`
- Test: `tests/universe-paper-interaction.integration.test.ts`
- Test: `tests/universe-paper-ui.test.ts`

**Interfaces:**

Use an internal draft type that can represent an unfilled new membership without corrupting the canonical model:

```ts
type MembershipDraft = {
  id: string;
  weightText: string;
};
```

Conversion boundary:

```ts
function toCanonicalMemberships(
  drafts: readonly MembershipDraft[],
): UniverseGalaxyMembership[] | null;
```

Return `null` if any `weightText` converts to a non-finite number. Never insert a default.

- [ ] **Step 1: Write RED unit/integration tests for conversion**

Required cases:

```ts
[] -> []
[{id:"g1", weightText:"1"}] -> [{id:"g1", weight:1}]
[{id:"g1", weightText:"0.55"}] -> [{id:"g1", weight:0.55}]
[{id:"g1", weightText:""}] -> null
[{id:"g1", weightText:"abc"}] -> null
[{id:"g1", weightText:"-2"}] -> [{id:"g1", weight:-2}]
```

The negative case is deliberate: current contract is finite-number only, not `[0,1]`.

- [ ] **Step 2: Run focused tests and verify RED**

- [ ] **Step 3: Implement read/edit metadata**

Read mode shows plain text:

```text
reflection · anchor · #tag-one #tag-two
星系  意识与自我 1 · 时间与记忆 0.9
```

Edit/create mode makes type, importance, tags, memberships interactive without native `<select>` or checkbox fieldsets.

- [ ] **Step 4: Implement type/importance popovers**

Persist only existing values. Outside close makes no change.

- [ ] **Step 5: Implement add-galaxy flow without default weight**

After selecting a not-yet-used galaxy, append `{id, weightText:""}` and focus its transparent numeric input. Save remains disabled while conversion returns `null`.

- [ ] **Step 6: Implement existing membership local editor**

Allow exact weight edit and `移出星系`. Removing a membership deletes only that draft row.

- [ ] **Step 7: Preserve tags parsing**

Use current comma/Chinese-comma parsing and dedupe/trim behavior if already present; do not alter stored strings beyond existing normalization.

- [ ] **Step 8: Re-run tests and commit**

```bash
git add web/src/pages/universe/UniverseNodeMetadata.tsx web/src/pages/universe/UniverseNodePaper.tsx web/src/pages/universe-state-polish.css tests/universe-paper-interaction.integration.test.ts tests/universe-paper-ui.test.ts
git commit -m "feat: add lightweight Universe node metadata"
```

---

### Task 7: Same-paper create/edit body and connection edit affordances

**Files:**
- Modify: `web/src/pages/universe/UniverseNodePaper.tsx`
- Modify: `web/src/pages/UniversePage.tsx` only if state reset is needed
- Modify: `web/src/pages/universe-state-polish.css`
- Test: `tests/universe-paper-interaction.integration.test.ts`
- Test: `tests/universe-paper-ui.test.ts`

**Interfaces:**
- `UniverseNodePaperDraft` remains canonical at `onSave`.
- Create/edit body fields remain `title`, `summary`, `content`, `type`, `importance`, `tags`, `galaxies`.
- Existing create/update service calls remain untouched.

- [ ] **Step 1: Add RED tests**

Verify create/edit has no visible field labels and no native select/fieldset matrix. Verify title/summary/content are transparent editors and Save emits exact canonical draft values.

Verify detail → edit keeps the same dialog id/shell open rather than creating a second layer.

Verify edit connection row uses a small trailing overflow for remove instead of a large button.

- [ ] **Step 2: Run focused tests**

- [ ] **Step 3: Build content-first editors**

Render:

```tsx
<input className="universe-paper-title-editor" placeholder="星球标题" ... />
<textarea className="universe-paper-summary-editor" ... />
<textarea className="universe-paper-content-editor" ... />
```

No visible `label` copy. Provide `aria-label` for accessibility.

- [ ] **Step 4: Move metadata to fixed `bottomLeft`**

Use `UniverseNodeMetadata` as the Paper footer. Connections remain inside scroll body.

- [ ] **Step 5: Add lightweight connection row overflow in edit mode**

The only destructive item is `移除连接`, calling the existing `onDeleteRelation` callback.

- [ ] **Step 6: Preserve save/delete/revision business behavior**

No service/API changes. Do not add optimistic local writes.

- [ ] **Step 7: Re-run tests and commit**

```bash
git add web/src/pages/universe/UniverseNodePaper.tsx web/src/pages/UniversePage.tsx web/src/pages/universe-state-polish.css tests/universe-paper-interaction.integration.test.ts tests/universe-paper-ui.test.ts
git commit -m "feat: redesign Universe node editing paper"
```

---

### Task 8: Regression coverage and final verification

**Files:**
- Modify tests only as required by the new accepted UI.
- Do not weaken tests merely to make them pass.

- [ ] **Step 1: Run all Universe-focused tests serially**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/universe-*.test.ts
```

Expected: 0 failures. Keep intentional skips documented by existing tests only.

- [ ] **Step 2: Run deterministic full suite**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/**/*.test.ts
```

Expected: no new failures. If a known baseline failure is reproduced, capture exact evidence and compare to base; do not silently ignore it.

- [ ] **Step 3: Run build/typecheck gates**

```bash
pnpm typecheck
pnpm build
pnpm --dir web typecheck
pnpm --dir web build
git diff --check
```

- [ ] **Step 4: Database schema check**

Run the repository's existing DB schema check only if its required environment is already available. Do not ask for or paste `DATABASE_URL`. This UI-only branch must contain no schema/migration changes regardless.

- [ ] **Step 5: Scope audit**

```bash
git diff --name-only 800b5fcb84c1929d9626f192cfce8564847c9dfa...HEAD
```

Reject any unexpected backend/API/db/migration/Auth/MCP/PWA file.

- [ ] **Step 6: Production-bound visual checklist before handoff**

Confirm from code/tests that:

- map ready state is edge-to-edge and paler
- top controls align and shift upward
- export/add/galaxy are anchored outside-close popovers
- placement duplicate notice is gone
- node Paper has no rules/signature
- timestamp format is `YYYY.MM.DD HH:mm`
- detail is reading-first
- metadata/footer and galaxy-weight popovers are lightweight
- no generated membership default exists
- importer/loading/uninitialized code is unchanged

- [ ] **Step 7: Final commit if verification-only test adjustments were needed**

```bash
git add tests web/src/pages web/src/styles.css docs/superpowers
# stage only files actually changed by this feature
git commit -m "test: verify Universe mobile production polish"
```

Do not create a PR, merge, or deploy until ChatGPT has reviewed the actual remote branch diff and the user explicitly authorizes the next step.
