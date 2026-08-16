# Universe direct relation flow implementation plan

## Goal

Implement the approved direct relation-creation flow without redesigning the relation page.

## Task 1 — Lock the intended flow with focused tests

Files:
- `tests/universe-direct-relation-flow.test.ts`

Add source-level regression assertions that prove:
- the node-detail action opens the relation editor directly;
- `UniversePage` no longer enters `relation-target` map mode;
- `UniverseRelationPaper` can render with a source and no preselected target;
- the target selector excludes the source and starts empty;
- save is disabled until a valid target exists;
- map-only relation-target state/callbacks are removed.

## Task 2 — Move target selection into UniverseRelationPaper

Files:
- `web/src/pages/universe/UniverseRelationPaper.tsx`

Changes:
- accept the source plus the available Universe nodes;
- own the selected target id locally and reset it when a new relation flow opens;
- derive candidate targets by excluding the source;
- replace the read-only target display with a real selector;
- keep relation type and strength behavior unchanged;
- disable save until a valid target is selected;
- submit the selected target through the existing relation create payload.

## Task 3 — Open the relation editor directly from node detail

Files:
- `web/src/pages/UniversePage.tsx`

Changes:
- remove parent-owned relation target state;
- on `连接另一个思想`, set the source and open the relation editor immediately;
- pass all nodes to `UniverseRelationPaper`;
- remove the map target-selection callback wiring;
- preserve save, error reconciliation, close/cancel, and browse-mode behavior.

## Task 4 — Remove the unreachable map relation-target mode

Files:
- `web/src/pages/universe/universe-map-interaction.ts`
- `web/src/pages/universe/UniverseMobileMap.tsx`

Changes:
- remove `relation-target` from the map mode union and helpers;
- remove the relation-target click branch and callback prop from the map;
- preserve browse, node placement, dragging, zooming, filtering, viewport, and reveal behavior.

## Task 5 — Verify and merge

- Inspect the branch diff against the fresh production branch.
- Confirm only the approved relation-flow files, tests, and design/plan docs changed.
- Run available focused checks if executable evidence is available; otherwise do not claim tests passed.
- Re-fetch the production branch before merge to detect races.
- Open a focused PR and merge with an expected-head lock.
- Report merged separately from deployment status.
