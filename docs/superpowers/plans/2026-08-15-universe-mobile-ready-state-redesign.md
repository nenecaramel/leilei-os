# Universe Mobile Ready-State Redesign — Implementation Plan

Date: 2026-08-15
Design spec: `docs/superpowers/specs/2026-08-15-universe-mobile-ready-state-redesign-design.md`
Approved design commit: `49cb3f93ca7bceb40174bff5fb959980d87fedae`
Production baseline: `003bcdc1f764e38914c9cd980ed0ba5fec452132`
Scope: frontend-only mobile Universe ready state

## Guardrails

This implementation must preserve the accepted loading, uninitialized, and importer states. It must not change Universe server/API/database/schema semantics, weighted membership shape, optimistic version semantics, or the old-data importer contract. Desktop redesign, Phase 8.4 Global Search, and Phase 8.5 MCP are out of scope.

The canonical node membership shape remains `{ id: string, weight: number }[]`. The frontend must preserve exact finite weights and must not normalize memberships to string IDs or invent replacement weights.

The existing shared `PaperDetailDialog` is the only dialog shell for Universe node detail/create/edit and relation create/edit. Do not introduce a bottom-sheet node detail or a fullscreen node editor.

No production DB migration or backup gate is needed because this plan is frontend-only. All write paths still use the existing Universe service contract.

## Implementation strategy

Keep the page orchestrator small by extracting three layers:

1. pure geometry/presentation helpers that can be tested without DOM,
2. a mobile map renderer/controller responsible for gestures and spatial rendering,
3. paper/picker components responsible for bounded UI flows.

Do not add a pan/zoom dependency in the first implementation. `web/package.json` currently has only React/Auth0/router runtime dependencies, and the required transform math is small enough to isolate and test directly. If custom pointer handling proves insufficient during implementation, stop and reassess rather than silently adding a large interaction library.

Use TDD for pure behavior and regression guards. Each task below starts with a failing test or source-level acceptance assertion, then the minimum implementation, then focused verification and a small commit.

---

## Task 1 — Add deterministic map transform and viewport preference helpers

### Files

Create:
- `web/src/pages/universe/universe-map-transform.ts`
- `tests/universe-map-transform.test.ts`

### Behavior to encode

Define frontend-only types such as:

```ts
export type UniverseViewport = {
  x: number;
  y: number;
  scale: number;
};

export type UniverseMapSize = {
  width: number;
  height: number;
};
```

Add pure helpers for:

- canonical-position-to-logical-world conversion,
- logical-world-to-canonical-position conversion,
- `worldToScreen`,
- `screenToWorld`,
- `zoomAroundScreenPoint`,
- `fitViewportToPositions`,
- scale clamping,
- local viewport parse/serialize validation.

Keep the canonical Universe position domain unchanged. The transform layer may scale it into a larger logical world internally, but round-tripping a valid canonical position through world conversion must recover the same canonical value within a small numeric tolerance.

Suggested constants belong in this helper, not in JSX:

```ts
export const MIN_UNIVERSE_SCALE = ...;
export const MAX_UNIVERSE_SCALE = ...;
export const UNIVERSE_VIEWPORT_STORAGE_KEY = "leileios.universe.viewport.v1";
```

### Test first

Cover at minimum:

```ts
test("world/screen transforms round-trip at arbitrary pan and zoom", ...)
test("zoom keeps the gesture focal point stationary", ...)
test("fit viewport includes every positioned node with padding", ...)
test("canonical/world conversion preserves valid node positions", ...)
test("invalid stored viewport data is rejected", ...)
```

Run:

```bash
pnpm exec tsx --test tests/universe-map-transform.test.ts
```

Expected before implementation: fail because the module does not exist.
Expected after implementation: all transform tests pass.

### Commit

```bash
git add web/src/pages/universe/universe-map-transform.ts tests/universe-map-transform.test.ts
git commit -m "feat: add Universe map viewport transforms"
```

---

## Task 2 — Add pure planet/relation presentation derivation

### Files

Create:
- `web/src/pages/universe/universe-map-presentation.ts`
- `tests/universe-map-presentation.test.ts`

Read types from:
- `web/src/pages/universe/universe-types.ts`

### Behavior to encode

Pure helpers must determine presentation without mutating canonical data:

- primary galaxy = highest-weight membership whose galaxy exists,
- secondary memberships sorted only for visual priority; canonical source array is untouched,
- restrained planet size from `importance`,
- title visibility from zoom + importance,
- galaxy-focus emphasis,
- selected-node emphasis overriding galaxy-focus fading,
- direct-neighbor detection,
- relation emphasis for selected node,
- relation width/opacity from `strength` with bounded visual output.

Important semantic rules:

```ts
selection priority > active galaxy focus > ordinary content > faded content
```

A selected node outside the active galaxy must remain selected and readable. Galaxy focus does not remove nodes or relations from layout.

### Test first

Cover at minimum:

```ts
test("highest membership weight chooses the primary galaxy", ...)
test("presentation sorting never mutates weighted memberships", ...)
test("importance changes planet size within a restrained range", ...)
test("higher importance retains labels at lower zoom", ...)
test("galaxy focus fades but does not hide unrelated nodes", ...)
test("selection overrides galaxy-focus fading", ...)
test("selected node brightens only direct relations and neighbors", ...)
test("relation strength changes only bounded line weight/opacity", ...)
```

Run:

```bash
pnpm exec tsx --test tests/universe-map-presentation.test.ts
```

### Commit

```bash
git add web/src/pages/universe/universe-map-presentation.ts tests/universe-map-presentation.test.ts
git commit -m "feat: derive Universe planet presentation"
```

---

## Task 3 — Add an explicit mobile map interaction state machine

### Files

Create:
- `web/src/pages/universe/universe-map-interaction.ts`
- `tests/universe-map-interaction.test.ts`

### Purpose

Keep mutually exclusive interaction modes outside React event-handler conditionals. The reducer/state machine must make it impossible for one pointer action to mean two operations.

Model at least these modes:

```ts
type UniverseMapMode =
  | { kind: "browse" }
  | { kind: "placing-node" }
  | { kind: "relation-target"; sourceNodeId: string }
  | { kind: "moving-node"; nodeId: string };
```

Selection is separate state from the current mode.

Encode transitions for:

- first planet tap selects,
- second tap on same selected planet requests detail open,
- tapping a different planet changes selection,
- empty-map tap in browse clears selection,
- empty-map tap in placing mode requests node creation at that world coordinate,
- target tap in relation mode requests relation editor,
- long-press move may begin only from browse mode,
- entering add/relation/move cancels incompatible transient gestures,
- cancel returns to browse without writes.

The reducer should return explicit effects/events rather than directly calling services.

### Test first

Cover all conflicting gestures, especially:

```ts
test("first tap selects and second tap requests paper detail", ...)
test("place mode converts a map tap into create intent, not selection", ...)
test("relation target mode converts a planet tap into relation intent", ...)
test("long press move cannot begin while placing or choosing a relation target", ...)
test("cancel returns to browse without a write effect", ...)
```

Run:

```bash
pnpm exec tsx --test tests/universe-map-interaction.test.ts
```

### Commit

```bash
git add web/src/pages/universe/universe-map-interaction.ts tests/universe-map-interaction.test.ts
git commit -m "feat: add Universe map interaction state machine"
```

---

## Task 4 — Build the mobile star-map renderer and gesture controller

### Files

Create:
- `web/src/pages/universe/UniverseMobileMap.tsx`

Modify:
- `web/src/pages/universe-state-polish.css`

Add/extend tests:
- `tests/universe-mobile-ready-state-ui.test.ts`

### Component contract

`UniverseMobileMap` receives canonical snapshot data and callbacks; it does not own server persistence.

Suggested props:

```ts
type UniverseMobileMapProps = {
  galaxies: UniverseGalaxy[];
  nodes: UniverseNode[];
  relations: UniverseRelation[];
  selectedNodeId: string | null;
  activeGalaxyId: string | null;
  mode: UniverseMapMode;
  initialViewport: UniverseViewport | null;
  onViewportChange(viewport: UniverseViewport): void;
  onSelectNode(nodeId: string | null): void;
  onOpenNode(nodeId: string): void;
  onPlaceNode(position: UniverseNodePosition): void;
  onChooseRelationTarget(nodeId: string): void;
  onMoveNode(nodeId: string, position: UniverseNodePosition): Promise<void>;
};
```

Exact prop names can change, but persistence must remain owned by the page/service layer.

### Rendering

Replace the old engineering graph visual with:

- white unframed map surface,
- sparse world-space reference dots,
- very light relation lines,
- circular colored planets,
- secondary weighted-membership rings,
- title only; no `type` subtitle,
- importance-derived planet sizes,
- importance-aware label LOD,
- selected primary-color outer ring,
- direct relation/neighbor emphasis,
- galaxy-focus fading without layout removal.

Do not render a large bordered `.universe-cosmos` card for ready state.

### Pointer behavior

Implement with pointer events and pure helpers from Tasks 1–3:

- one pointer drag on background = pan,
- two pointers = pinch zoom around gesture midpoint,
- single tap planet = select,
- second tap selected planet = open detail,
- long press planet then drag = move planet,
- release after move sends exactly one final canonical position write callback,
- prevent browser scrolling/zoom only within the map gesture surface as required; do not globally disable page touch behavior.

Use pointer capture only during active gestures. Track movement tolerance so a pan is not misclassified as a tap.

Long-press feedback may use a CSS state class and `navigator.vibrate?.(...)` when available, but vibration must be optional and never required for behavior.

### Fit and viewport persistence

- If no valid stored viewport exists, fit all current positions after map size is known.
- Restore a valid stored viewport on subsequent visits.
- `查看全部` calls fit-to-content only; it does not mutate node coordinates.
- Resizing the viewport does not rewrite canonical positions.

### Source-level acceptance test first

Before implementation, create `tests/universe-mobile-ready-state-ui.test.ts` with assertions that the new component/file does not yet exist or is not wired. It should later verify structural invariants such as:

- `UniverseMobileMap` is used by `UniversePage`,
- ready state exposes `查看全部`,
- no node type subtitle is rendered in the map component,
- map component uses weighted galaxy presentation helpers,
- no ready-state bordered canvas/pill toolbar selectors remain.

Run focused tests:

```bash
pnpm exec tsx --test \
  tests/universe-map-transform.test.ts \
  tests/universe-map-presentation.test.ts \
  tests/universe-map-interaction.test.ts \
  tests/universe-mobile-ready-state-ui.test.ts
```

### Commit

```bash
git add \
  web/src/pages/universe/UniverseMobileMap.tsx \
  web/src/pages/universe-state-polish.css \
  tests/universe-mobile-ready-state-ui.test.ts
git commit -m "feat: build Universe mobile star map"
```

---

## Task 5 — Replace galaxy pill toolbar and ready-state header actions

### Files

Create:
- `web/src/pages/universe/UniverseGalaxyPicker.tsx`

Modify:
- `web/src/pages/UniversePage.tsx`
- `web/src/pages/universe-state-polish.css`
- `tests/universe-mobile-ready-state-ui.test.ts`
- `tests/universe-monochrome-ui.test.ts`

### UI behavior

Ready-state header:

- preserve standard page title `Universe`,
- top-right only `＋` and `···`,
- `＋` enters place-node mode,
- `···` contains low-frequency actions including export.

Galaxy focus:

- render a lightweight `星系` text entry,
- active state shows color dot + galaxy name,
- picker lists `全部` then galaxies with color dot/name,
- selecting a galaxy closes the picker,
- selecting a galaxy changes only visual emphasis; it does not alter map coordinates or hide unrelated nodes.

The galaxy picker may use a lightweight modal/sheet because it is a filter control; this does not replace the paper dialog rule for node/relation content.

### Update obsolete monochrome assertion

`tests/universe-monochrome-ui.test.ts` currently rejects galaxy-color rendering. That ready-state assertion is intentionally obsolete because approved planets use galaxy colors. Rewrite the test so it continues to protect white/minimal page chrome and loading/importer behavior without forbidding planet color.

### Test first

Add assertions for:

- no ready-state `导出` / `新增` text buttons,
- `＋` and `···` present,
- export reachable from overflow menu,
- no wrapped galaxy pill toolbar,
- galaxy focus picker preserves all nodes.

Run:

```bash
pnpm exec tsx --test \
  tests/universe-mobile-ready-state-ui.test.ts \
  tests/universe-monochrome-ui.test.ts \
  tests/universe-state-ui.test.ts \
  tests/universe-minimal-state-ui.test.ts
```

### Commit

```bash
git add \
  web/src/pages/universe/UniverseGalaxyPicker.tsx \
  web/src/pages/UniversePage.tsx \
  web/src/pages/universe-state-polish.css \
  tests/universe-mobile-ready-state-ui.test.ts \
  tests/universe-monochrome-ui.test.ts
git commit -m "feat: simplify Universe mobile controls"
```

---

## Task 6 — Move node detail/create/edit into the shared paper system

### Files

Create:
- `web/src/pages/universe/UniverseNodePaper.tsx`

Modify:
- `web/src/pages/UniversePage.tsx`
- `web/src/pages/universe-state-polish.css`

Add:
- `tests/universe-paper-ui.test.ts`

Read/reuse:
- `web/src/pages/PaperDetailDialog.tsx`
- `web/src/styles.css`

### Paper states

One component may model:

```ts
type UniverseNodePaperMode =
  | { kind: "detail"; nodeId: string }
  | { kind: "edit"; nodeId: string }
  | { kind: "create"; position: UniverseNodePosition };
```

Do not copy dialog focus trap, scroll lock, veil, sizing, or Escape handling. Use `PaperDetailDialog` directly.

### Detail paper

Show only existing canonical node fields, with the visual hierarchy of paper content rather than form cards:

- title,
- summary,
- content,
- type,
- tags,
- importance,
- weighted galaxy memberships,
- connections in the lower section.

Provide bounded actions for edit and relation creation. Preserve current delete semantics only if the existing ready-state editor already exposes deletion; do not invent a new destructive behavior.

Tapping a related node requests:

1. close current paper,
2. restore the exact existing map viewport,
3. pan/zoom to the target if needed,
4. select/highlight target.

Do not automatically open the target paper; normal second-tap behavior remains consistent.

### Edit/create paper

Use transparent paper-style inputs already established in shared styles. Do not add gray cards or boxed form sections.

Fields must map exactly to the existing `UniverseNode` contract. Weighted galaxy editing must preserve `{id, weight}` values exactly and reject duplicate memberships before submission; it must not silently assign weights when modifying an existing membership.

Creation begins only after the user selected a map position. Canceling the blank paper creates no node.

### Test first

`tests/universe-paper-ui.test.ts` must protect:

- `UniverseNodePaper` imports and renders `PaperDetailDialog`,
- no custom fullscreen/bottom-sheet node shell is introduced,
- only canonical node fields are present,
- create/edit uses weighted memberships rather than string IDs,
- paper close does not reset viewport state in `UniversePage`.

Run:

```bash
pnpm exec tsx --test \
  tests/universe-paper-ui.test.ts \
  tests/paper-dialog-scroll-lock-regression.test.ts \
  tests/paper-detail-memory-slots.test.ts
```

Then:

```bash
pnpm --dir web typecheck
```

### Commit

```bash
git add \
  web/src/pages/universe/UniverseNodePaper.tsx \
  web/src/pages/UniversePage.tsx \
  web/src/pages/universe-state-polish.css \
  tests/universe-paper-ui.test.ts
git commit -m "feat: use paper dialog for Universe nodes"
```

---

## Task 7 — Add relation targeting and shared-paper relation editing

### Files

Create:
- `web/src/pages/universe/UniverseRelationPaper.tsx`

Modify:
- `web/src/pages/universe/UniverseNodePaper.tsx`
- `web/src/pages/UniversePage.tsx`
- `web/src/pages/universe-state-polish.css`
- `tests/universe-paper-ui.test.ts`
- `tests/universe-mobile-ready-state-ui.test.ts`

### Flow

From a node detail paper:

1. tap `建立连接`,
2. close paper,
3. keep source node selected/highlighted,
4. enter `relation-target` mode,
5. tap a target planet,
6. open `UniverseRelationPaper` using `PaperDetailDialog`,
7. edit only canonical relation fields (`type`, `strength`) plus display-only source/target context,
8. save through the existing Universe service relation-create path,
9. refresh/accept the authoritative snapshot,
10. return to browse mode with the new relation visible.

Cancel at either target-selection or paper stage performs no write.

Do not introduce drag-to-connect or a target dropdown.

### Conflict/error handling

All mutations use the existing service version semantics. If the write is rejected/conflicts, obtain authoritative state through the existing refresh path and do not leave an optimistic relation line that the server did not accept.

### Test first

Cover source-level/state-machine integration invariants:

- relation mode originates from selected node,
- target click cannot pan/select/create a node,
- self-target is rejected if current service/domain validation rejects it; do not override server semantics,
- relation paper uses `PaperDetailDialog`,
- only `type` and `strength` are editable relation fields,
- failed save returns to authoritative state without optimistic drift.

Run:

```bash
pnpm exec tsx --test \
  tests/universe-map-interaction.test.ts \
  tests/universe-paper-ui.test.ts \
  tests/universe-mobile-ready-state-ui.test.ts \
  tests/universe-web-adapter.test.ts
```

### Commit

```bash
git add \
  web/src/pages/universe/UniverseRelationPaper.tsx \
  web/src/pages/universe/UniverseNodePaper.tsx \
  web/src/pages/UniversePage.tsx \
  web/src/pages/universe-state-polish.css \
  tests/universe-paper-ui.test.ts \
  tests/universe-mobile-ready-state-ui.test.ts
git commit -m "feat: add Universe paper relation flow"
```

---

## Task 8 — Wire authoritative writes for move/create/edit and finish visual polish

### Files

Modify as needed:
- `web/src/pages/UniversePage.tsx`
- `web/src/pages/universe/UniverseMobileMap.tsx`
- `web/src/pages/universe/UniverseNodePaper.tsx`
- `web/src/pages/universe/UniverseRelationPaper.tsx`
- `web/src/pages/universe-state-polish.css`
- focused Universe tests

### Persistence rules

For every write:

- use existing `createNode`, `updateNode`, `createRelation`, etc.,
- never mutate local canonical snapshot ahead of a successful authoritative response in a way that can survive a failure,
- on conflict/failure, refresh through the existing Universe read path before presenting the settled state,
- moving a planet writes only the node’s new canonical position while preserving all other canonical node fields,
- creation uses the canonical position computed from the selected map point,
- editing preserves weighted memberships exactly as entered/validated,
- relation creation preserves the existing relation contract.

### Ready-state visual cleanup

Delete or stop using the old ready-state structures/styles:

- wrapped galaxy pills,
- `.universe-cosmos` bordered ready canvas,
- white node cards/pills,
- permanent node type subtitle,
- old below-canvas detail card,
- old card-like node/relation editor,
- text `导出` / `新增` header actions.

Do not remove selectors still required by loading/uninitialized/importer tests.

Review mobile CSS for:

- pure white page,
- no ready map frame,
- sparse reference dots,
- readable but restrained planet titles,
- selected ring and neighbor emphasis,
- faded galaxy-focus state,
- relation text appearing only when relation emphasis warrants it,
- mobile safe-area/touch sizing,
- `prefers-reduced-motion`.

### Focused regression gate

Run:

```bash
pnpm exec tsx --test \
  tests/universe-map-transform.test.ts \
  tests/universe-map-presentation.test.ts \
  tests/universe-map-interaction.test.ts \
  tests/universe-mobile-ready-state-ui.test.ts \
  tests/universe-paper-ui.test.ts \
  tests/universe-state-ui.test.ts \
  tests/universe-minimal-state-ui.test.ts \
  tests/universe-monochrome-ui.test.ts \
  tests/universe-import-ui.test.ts \
  tests/universe-import-integration-ui.test.ts \
  tests/universe-web-adapter.test.ts \
  tests/universe-web-export.test.ts
```

Expected: all applicable focused tests pass. If `tests/universe-web-page.test.ts` is included separately under the bare Node/tsx path and still hits the known pre-existing CSS loader `ERR_UNKNOWN_FILE_EXTENSION`, record it explicitly rather than misclassifying it as a redesign regression.

### Commit

```bash
git add web/src/pages/UniversePage.tsx web/src/pages/universe web/src/pages/universe-state-polish.css tests
git commit -m "feat: finish Universe mobile ready-state redesign"
```

---

## Task 9 — Full validation gate

No new product behavior should be added in this task. Fix only regressions attributable to this branch.

Run in order:

```bash
pnpm typecheck
pnpm build
pnpm --dir web typecheck
pnpm --dir web build
pnpm db:check
git diff --check
```

Then run the deterministic full suite:

```bash
pnpm test
```

Expected baseline caveat: the repository has a known pre-existing CSS-loader failure path around `tests/universe-web-page.test.ts` under the current test harness. Confirm whether it reproduces from the production baseline before treating it as branch-caused. No other new failure is acceptable.

Also verify:

```bash
git status --short
git log --oneline --decorate -12
```

Expected:
- clean worktree,
- no migration files changed,
- no server/domain/schema files changed,
- importer behavior unchanged,
- design + plan + implementation commits are isolated on the feature branch.

If implementation changes `package.json` or lockfiles unexpectedly, stop and justify the dependency change before proceeding.

### Final commit only if validation fixes were required

```bash
git add <only validation-fix files>
git commit -m "test: close Universe mobile redesign regressions"
```

---

## PR and acceptance

After all gates pass:

1. compare the implementation branch against production branch `codex/phase-6-web-ui-foundation`,
2. inspect every changed filename and patch,
3. open a dedicated frontend PR,
4. do not merge until code review and test evidence are complete,
5. after merge/deploy, perform visual acceptance on the production/main site rather than relying on the currently unusable Auth0 preview callback path.

The PR must explicitly state:

- frontend-only,
- mobile ready-state only,
- loading/uninitialized/importer untouched,
- no DB/API/schema changes,
- exact focused/full test results,
- any still-reproducing baseline-only CSS-loader failure.
