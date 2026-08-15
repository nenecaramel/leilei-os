# Universe Mobile Ready-State Redesign

Date: 2026-08-15  
Status: Design for review  
Baseline: `003bcdc1f764e38914c9cd980ed0ba5fec452132`  
Scope: Universe **ready state on mobile only**

## 1. Purpose

The current Universe ready state is functionally correct but visually behaves like an engineering graph editor: a bordered canvas, card-like nodes, wrapped galaxy pills, persistent text actions, and dense editor chrome. This redesign replaces that ready-state experience with a spatial, quiet, white LeileiOS-style thought universe while preserving the existing Universe contract and persistence semantics.

The target is not a decorative “space theme”. It is a usable spatial thinking surface whose primary visual language is position, planet color, restrained size differences, and faint relationships.

## 2. Scope and non-goals

### In scope

- Mobile Universe ready state.
- Main star-map composition.
- Pan/zoom and remembered viewport.
- Galaxy focus/filter interaction.
- Planet rendering, title LOD, selection, and movement.
- Relation rendering and relation selection emphasis.
- Node detail, create, and edit flows.
- Relation creation flow.
- Ready-state top actions and low-frequency menu.
- Mobile touch interaction, accessibility, and failure recovery.

### Explicitly out of scope

- Desktop redesign.
- Loading state.
- Uninitialized state.
- 8.3 importer UI or importer behavior.
- Universe server/API/database/schema changes.
- Changes to Universe business semantics.
- Automatic layout or automatic node repositioning.
- Memory/Diary synchronization or any new cross-domain coupling.
- Global Search (Phase 8.4) or MCP (Phase 8.5).

The existing canonical Universe data shapes remain authoritative, including weighted galaxy memberships `{id, weight}` and whole-snapshot optimistic-version writes.

## 3. Visual direction

The page is a white spatial surface rather than a framed graph component.

- Background is pure white.
- The current large bordered canvas disappears.
- No node cards, white pills, glass panels, heavy shadows, grid, starfield effects, or “cosmic” decoration.
- The map may contain extremely sparse, extremely light spatial reference dots. They belong to world space and therefore move/scale with the map. Their purpose is only to make panning perceptible.
- Chrome stays subordinate to the Universe itself.
- All map-state transitions are restrained; reduced-motion preferences are respected.

The overall visual hierarchy is hard-coded conceptually as:

`selected planet > direct neighbor / selected relation > active galaxy > ordinary content > faded content`

Selection always outranks galaxy focus. A selected node must never become visually suppressed because it is outside the current galaxy focus.

## 4. Page shell and controls

The ready-state header keeps the normal LeileiOS page title `Universe`.

Top-right contains only:

- `＋` — begin adding a planet.
- `···` — low-frequency operations, including export.

The old text actions `导出` and `新增` are removed from the ready-state header.

Galaxy focus is a separate lightweight text entry, not a pill toolbar. Default label is `星系`. When a galaxy is active, the entry shows its color dot plus its name. It has no capsule background.

There are no permanent zoom `＋ / −` controls. A single quiet “查看全部” map action fits all current content into view with padding.

## 5. Coordinate and viewport model

### 5.1 Stable logical world

The persisted `node.position` contract is not changed.

The frontend introduces a deterministic logical-world layer between persisted node positions and screen pixels:

`persisted position <-> logical world <-> viewport transform <-> screen`

Pan and zoom operate only on the viewport transform. They never mutate node positions.

The conversion between persisted coordinates and logical-world coordinates must be stable and reversible within the existing canonical position domain. The implementation must not assume that the server accepts new out-of-domain coordinate values; moved/created positions are converted back into values valid under the existing contract.

This prevents device dimensions, fit-to-content, or viewport resizing from silently changing the meaning of a node’s stored location.

### 5.2 Viewport behavior

- First ready-state visit: fit all planets into view with comfortable mobile padding.
- Later visits: restore the last local pan and zoom for Universe.
- Viewport preference is local UI state, not canonical Universe data.
- `查看全部` recomputes a fit-to-content viewport but does not change stored node positions.
- Changing galaxy focus never moves, zooms, or recenters the viewport.
- Opening and closing a paper dialog preserves the exact current map viewport.

Zoom bounds, fit padding, and numerical transform details are implementation constants, not data-contract changes.

## 6. Planet visual system

### 6.1 Body

A planet is a clean circular body with very subtle tonal depth. It is not a glossy 3D sphere and has no realistic texture.

- The membership with highest weight determines the primary planet color.
- Additional galaxy memberships are represented by restrained outer rings / halos.
- Their visual prominence follows membership weight only as a display priority; the actual canonical weight value is preserved exactly.
- The frontend must never normalize weighted memberships to string IDs or invent replacement weights.

### 6.2 Importance

`importance` affects planet size with a restrained range. It does not affect galaxy color and must not be conflated with membership weight.

Importance also influences title retention when zoomed out: higher-importance planets keep their titles visible longer.

### 6.3 Type

Node `type` has no map-level visual encoding. It does not change shape, color, icon, or border. It appears only in the paper detail/edit UI.

### 6.4 Titles and level of detail

- Title is centered directly below the planet.
- No label background, border, or capsule.
- Default title tone is light neutral text; selected title becomes slightly stronger.
- As the user zooms out, titles progressively hide according to zoom and importance.
- As the user zooms in, titles return.
- Planet bodies themselves never disappear merely because title LOD changes.
- Crowding is handled through label visibility/collision policy only; the system never moves planets to resolve overlap.

## 7. Relation visual system

All relations remain globally present so the Universe retains its overall topology, but at rest they are extremely light.

- Relation type does not determine line color.
- `strength` only produces a restrained difference in line weight and opacity.
- Defensive visual clamping may be used for rendering, but stored relation strength semantics are unchanged.
- At rest, direction is not shown with a visible arrowhead.

When a planet is selected:

- Its direct relations brighten.
- Its direct neighboring planets brighten.
- Unrelated content falls further into the background.
- Relation type appears as light text near the midpoint of each selected first-degree relation.
- The label itself has no badge or capsule; the line may be interrupted/masked immediately behind the text for legibility.
- For a directed relation, a tiny quiet direction marker appears toward the target end only while that relation is emphasized.

## 8. Galaxy focus

Tapping the `星系` entry opens a lightweight bottom selector containing:

- `全部`
- each galaxy’s color dot and name

The selector is single-select. Choosing an item closes it.

Galaxy focus is an emphasis mechanism, not a destructive filter:

- Planets belonging to the active galaxy remain at normal prominence.
- Non-member planets remain spatially present but fade heavily.
- Non-member titles hide.
- Unrelated relation lines fade further.
- Existing positions and viewport are never changed.

Selecting `全部` returns the map to normal global emphasis.

## 9. Normal selection behavior

Normal map mode uses a deliberate two-tap detail interaction:

1. First tap on a planet selects it.
2. First-degree relations and neighbors become emphasized; selected planet gets its restrained primary-color outer ring.
3. Second tap on the same selected planet opens its detail paper.
4. Tapping another planet switches selection directly to that planet.
5. Tapping empty map space clears the selected planet.

Clearing planet selection does not clear the active galaxy focus.

The selected planet body does not suddenly become a card or dramatically enlarge.

## 10. Touch interaction and mutually exclusive modes

The Universe has explicit mutually exclusive interaction modes:

- `normal`
- `placing-node`
- `picking-relation-target`
- `dragging-node`

A special mode overrides normal tap behavior until it is completed or cancelled. This is required to prevent touch conflicts.

### Normal mode

- One-finger drag on empty map: pan.
- Two-finger gesture: zoom/pinch.
- Tap planet: select / second tap opens detail.
- Tap empty map: clear selection.
- Long-press planet, then drag: enter node movement.

### Dragging-node mode

- Begins only after a deliberate long-press threshold on a planet.
- Long-press feedback is restrained: subtle enlargement/press state and haptic feedback where supported.
- Once dragging begins, the gesture no longer pans the map.
- Releasing saves the new position immediately.
- It does not open the editor.
- On save failure, restore the original position and show a lightweight error message.

### Special-mode chrome

`placing-node` and `picking-relation-target` show only a quiet contextual instruction and a clear `取消` action. They do not add a toolbar or modal overlay over the map.

## 11. Paper detail system

Node detail, create, and edit must reuse the established LeileiOS `PaperDetailDialog` visual and interaction system rather than introducing a Universe-specific bottom sheet or full-screen form.

When the paper opens:

- The current star map stays visually behind it and is interaction-frozen by the dialog layer.
- Body scroll/map position is preserved.
- Closing restores the user to the exact same pan/zoom context.
- Existing PaperDetailDialog focus management, Escape behavior, scroll restoration, and mobile paper geometry remain the foundation.

### Node detail paper

The paper presents the canonical node information available today:

- title
- summary
- content
- type
- tags
- importance
- weighted galaxy memberships
- relevant timestamps/migration metadata only where currently meaningful to product behavior
- relations in a lower section

The visual order should favor human-readable thought content first; metadata stays quiet.

A related node in the relations section is actionable. Tapping it:

1. closes the current paper,
2. returns to the star map,
3. pans/zooms only as needed to bring the target into a useful visible position,
4. selects/highlights that target planet.

This explicit navigation is allowed to move the viewport because the user asked to navigate to a target; ordinary filtering never does.

### Edit paper

Editing transitions the same detail paper into edit state. It does not navigate to a separate screen.

Editable fields follow the established paper language: transparent inputs/textarea treatment, no gray form-card boxes, and no nested boxed editor inside the paper.

Weighted galaxy memberships must remain fully editable without destroying their `{id, weight}` structure. Validation must preserve finite numeric weights exactly under the current domain rules; the UI must not invent a `[0,1]` contract unless the canonical domain already enforces it.

### Create paper

Creation uses the same paper system with blank/default content appropriate to the current canonical node contract. No node is persisted merely by opening the paper.

## 12. Add-planet flow

Top-right `＋` does not immediately create a default node at `{x:50,y:50}`.

Flow:

1. Tap `＋`.
2. Enter `placing-node` mode.
3. Show a quiet instruction such as “点一下星图，放置新的星球” plus `取消`.
4. User taps a map location.
5. Capture that location through the logical-world -> persisted-position conversion.
6. Open a blank node paper using `PaperDetailDialog`.
7. Save persists the new node at the chosen location.
8. Cancel closes the paper and creates nothing.

Existing nodes never move because a new planet is created.

## 13. Move-planet flow

A planet can be repositioned only through explicit long-press drag.

- Long-press disambiguates node movement from ordinary canvas pan.
- During drag, the planet follows the pointer/finger in world space.
- Release performs the existing canonical write path with the new valid persisted position.
- Success keeps the new location.
- Failure restores the previous location and communicates the failure without opening another dialog.

There is no extra “confirm position” step and no deferred save-on-exit batch.

## 14. Relation detail and creation

The lower part of a node’s paper lists its existing relations. Relation rows are visually simple and expose the relation type and counterpart node; relation strength may be shown/edited quietly where appropriate.

To create a relation:

1. From a node detail paper, tap `建立连接`.
2. Close the paper.
3. Enter `picking-relation-target` mode with the source planet emphasized.
4. Show a quiet instruction to choose another planet and a `取消` action.
5. Tapping a target planet selects it as the target immediately; it does not perform normal first-tap selection behavior.
6. Open a relation paper in the same unified paper visual language.
7. Edit the canonical relation fields currently supported: source, target, type, and strength. Source/target are contextual rather than a giant target dropdown.
8. Save persists the relation and returns to the map; the new line appears.
9. Cancel writes nothing and returns to the prior map context.

A drag-to-connect gesture is explicitly not used because it conflicts with long-press node movement and mobile pan gestures.

## 15. Persistence and concurrency

This redesign does not introduce a parallel persistence mechanism.

- Reads continue through `UniverseService`.
- Mutations continue to use the current whole-snapshot overwrite with `expectedVersion`.
- The existing uncertain-write rule remains: do not blindly retry an uncertain write; rely on the service’s authoritative follow-up read behavior.
- UI optimism is allowed only where it can be rolled back cleanly (for example a moved planet). Canonical state after a mutation still comes from the accepted service result / reload strategy.
- No direct database access from the UI.
- No dual write.
- No new migration.

For repeated small edits such as node movement, implementation may factor the existing save/reload orchestration for clarity, but it must not change the server contract or optimistic concurrency semantics.

## 16. Error behavior

Errors should be visible without turning the map into an error dashboard.

- Failed node movement: restore original location + lightweight message.
- Failed create/edit/relation save: keep the paper and editable content available, show the error inside the paper’s established error area.
- Failed initial/authoritative reload: preserve the existing page-level service error semantics rather than silently pretending the local snapshot is canonical.
- An interaction mode must never remain stuck after cancellation or a completed failure path.

## 17. Mobile ergonomics and accessibility

- Mobile is the acceptance target for this redesign.
- Interactive controls must retain comfortable touch targets even when their visible icon/text is visually light.
- Pinch/drag handling must not trigger accidental browser selection or conflicting click behavior on planets.
- Long-press threshold must be long enough to avoid accidental moves but short enough to feel deliberate rather than sluggish.
- Keyboard opening inside a paper must not destroy the map viewport behind it.
- Focus trapping/restoration remains delegated to the established paper dialog behavior.
- Important actions have accessible names; decorative dots/rings/relationship geometry are not announced as redundant controls.
- `prefers-reduced-motion` disables nonessential interpolation while preserving state changes.

## 18. Proposed frontend boundaries

The implementation should reduce the current concentration of responsibilities in `UniversePage.tsx` without changing domain ownership.

Suggested responsibilities:

- `UniversePage` — load/save orchestration, canonical snapshot/version, page-level mode ownership.
- `UniverseViewport` / map component — logical-world transform, pan/zoom, fit/restore viewport, pointer/touch coordination.
- `UniversePlanet` — planet rendering, title LOD, selected/faded states.
- `UniverseRelationLayer` — relation geometry, strength styling, selected labels/direction hints.
- `UniverseGalaxyPicker` — lightweight galaxy selector.
- `UniverseNodePaper` — detail/create/edit using `PaperDetailDialog`.
- `UniverseRelationPaper` — relation create/edit using the same paper system.
- Pure helpers — coordinate transforms, fit-to-content, visual-priority resolution, LOD, relation geometry.

Exact filenames are implementation-plan decisions. The important architecture rule is that rendering/gesture concerns are separated from canonical Universe persistence and service semantics.

## 19. Acceptance criteria

The redesign is acceptable when, on mobile production-ready UI:

1. Ready state no longer shows the old bordered graph canvas, node cards/pills, galaxy pill row, or `导出 / 新增` text actions.
2. The map reads as a white spatial Universe with subtle reference dots and lightweight controls.
3. Pan, pinch zoom, fit-all, and remembered viewport work without changing stored node locations.
4. Planets preserve stable spatial meaning across viewport changes.
5. Planet color/rings preserve weighted galaxy membership semantics; importance controls restrained size/label priority.
6. Galaxy focus fades rather than removes non-members and never moves the viewport.
7. First tap selects; second tap same planet opens detail; empty-space tap clears selection.
8. Selection emphasizes first-degree topology and relation labels without visually overwhelming the map.
9. Long-press drag moves only the planet; release saves; failure restores.
10. `＋` enters explicit placement mode; tapping a location opens the create paper; cancel creates nothing.
11. Node detail/create/edit all use the established `PaperDetailDialog` paper language.
12. Relation creation uses source -> map target pick -> relation paper, with no giant target dropdown or drag-to-connect gesture.
13. Special modes are mutually exclusive and cancellable, with no touch conflict between pan, selection, move, placement, and relation targeting.
14. Existing loading, uninitialized, and importer states are unchanged.
15. No API, DB, schema, weighted-membership, versioning, or business-semantics regression is introduced.
16. Existing Universe service uncertainty handling remains intact.
17. Relevant focused tests, root/web typechecks/builds, and ready-state UI acceptance pass before merge.

## 20. Implementation gate

This document freezes the approved design direction only. UI implementation must not begin until this written spec is reviewed/accepted. After acceptance, create a separate implementation plan and execute the redesign on an implementation branch based on the agreed production baseline / current production head as appropriate.
