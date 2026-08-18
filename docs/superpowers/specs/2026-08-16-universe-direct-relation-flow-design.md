# Universe direct relation flow design

## Goal

Remove the intermediate map-based target-selection step from the mobile Universe relation flow. From a node detail card, tapping “连接另一个思想” should open “让两个思想相遇” immediately and let the user choose or change the target node on that page.

## Scope

This change is functional only. It does not redesign the relation page yet.

### In scope

- Node detail action opens the relation editor directly.
- The relation editor receives the current node as the fixed source.
- “连接到” becomes a real target selector in the relation editor.
- The target selector excludes the source node itself.
- The target starts unselected.
- The target can be changed before saving.
- “建立连接” is disabled until a valid target is selected.
- Existing relation type, strength, save, error, and close behavior are preserved.
- Map-only relation-target selection state and callback paths are removed when they become unused.

### Out of scope

- Visual redesign of “让两个思想相遇”.
- Changes to the Universe home map, node detail styling, node editor/create UI, data model, API contract, relation semantics, or persistence behavior.

## Interaction flow

Before:

`node detail → 连接另一个思想 → map relation-target mode → choose node on map → relation editor`

After:

`node detail → 连接另一个思想 → relation editor → choose target in 连接到 → establish relation`

Closing the relation editor clears relation source/target state and returns to normal browse mode exactly as today.

## Component changes

### UniversePage

- `onCreateRelation(node)` sets `relationSourceId` to the current node, clears `relationTargetId`, closes the node detail card, and opens `relationEditorOpen` immediately.
- It must not switch the map to `relation-target` mode.
- Remove `onChooseRelationTarget` wiring if no longer used by the map.
- Pass the available Universe nodes to `UniverseRelationPaper` so it can own target selection UI.

### UniverseRelationPaper

- Accept the source node and all candidate nodes, rather than requiring a preselected target to render.
- Render as long as a source exists and the editor is open.
- Own a local selected target id, initialized empty when the flow opens for a source.
- Render “连接到” as an interactive selector containing every node except the source.
- Resolve the selected target from the candidate list for save.
- Disable “建立连接” when no target is selected or while saving.
- Preserve existing relation type and strength state/behavior.

### UniverseMobileMap / map interaction

- Remove only the relation-target selection path that becomes unreachable.
- Preserve browse, placement, node opening, moving, zooming, filtering, viewport, and all other map behavior.

## Error and state handling

- A target disappearing from the candidate list invalidates the selection and prevents save.
- Saving continues to use the existing `saveRelation` path and canonical service mutation behavior.
- On save failure, current error rendering and canonical reconciliation remain unchanged.
- Closing/canceling clears the relation flow state; no partially selected relation is persisted.

## Verification

Focused tests should prove:

1. Detail action opens the relation editor directly without entering relation-target map mode.
2. The relation editor renders with a source but no initial target.
3. The target selector excludes the source and can change target.
4. Save is disabled before target selection and submits the selected target afterward.
5. Existing relation type/strength save payload remains intact.
6. No unrelated node-detail, map-placement, or persistence behavior changes.
