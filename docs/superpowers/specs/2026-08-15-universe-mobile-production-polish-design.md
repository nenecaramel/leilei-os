# Universe Mobile Production Polish Design

**Status:** approved / frozen for implementation

**Date:** 2026-08-15

**Base:** `codex/phase-6-web-ui-foundation` @ `800b5fcb84c1929d9626f192cfce8564847c9dfa`

**Implementation branch:** `codex/phase-8-3-universe-mobile-polish`

## Goal

Polish the already-accepted Universe mobile ready state from real production-phone feedback without changing Universe server/API/database/schema semantics. The map remains the accepted white spatial star map; this pass makes it lighter, more edge-to-edge, and consistent with the accepted Memory / Diary / Task mobile paper and popover language.

## Scope boundary

This pass is **mobile ready-state UI only**.

Do not change:

- loading state
- error state
- uninitialized/importer state
- Universe API/service/adapter/domain/repository contracts
- database schema or migrations
- Auth0, MCP, PWA, desktop behavior
- weighted galaxy membership shape `{ id: string, weight: number }`
- canonical node position semantics or `0..100` write domain
- whole-snapshot optimistic-version behavior
- relation business semantics

No automatic node layout, no automatic weight defaults, no generated replacement values.

## 1. Map visual polish

The current planet colors and relation visuals are still too strong on production phone.

- Reduce planet fill saturation and contrast substantially. Target: **extremely pale** while still differentiating galaxy identity.
- Reduce secondary membership rings/glow even further.
- Keep selected node and direct-neighbor hierarchy readable, but selection should be restrained rather than luminous.
- Reduce ordinary relation line presence. Idle relations should read as spatial hints, not diagram edges.
- Preserve relation-strength encoding, but compress its visual range so high-strength idle lines do not become visually heavy.
- Keep relation label/direction behavior only for selected topology as already accepted.
- Reference dots remain extremely subtle.

Do not change the underlying primary-galaxy selection rule: highest membership weight determines the primary planet color.

## 2. Ready-state width and top controls

The Universe ready state should use the full mobile viewport width rather than inheriting the normal Memory-page horizontal gutters.

- Universe ready-state map/content spans edge-to-edge across the phone.
- Keep the global mobile top bar unchanged.
- Do not change loading/uninitialized/importer widths as collateral damage.
- `星系` and `查看全部` sit on the same horizontal level.
- Move that controls row upward by approximately 20px relative to the current production `星系` position.
- `查看全部` remains the only explicit camera reset/fit control.

## 3. Unified floating popover language

`＋`, `···`, and `星系` use the same lightweight floating-popover language already established by Memory/Task menus: white surface, very light border, small radius, soft shadow, no backdrop dimming, no bottom sheet.

General rules:

- Anchor each popover to its trigger.
- Opening one closes the other Universe top-level popovers.
- Clicking/tapping outside closes the popover.
- Escape closes where keyboard handling is applicable.
- Text is centered for single-action/instruction popovers.
- No separate cancel button inside these popovers.

### 3.1 `···` / Export

- The export popover appears directly below `···`.
- `导出` text is centered.
- Clicking outside closes it.
- Export itself keeps existing `downloadUniverseJson(snapshot)` behavior.

### 3.2 `＋` / Add planet

Tapping `＋` enters placement mode and shows a small anchored instruction popover below `＋`.

- Copy remains equivalent to `点击地图选择新星球的位置`.
- The same instruction must **not** also appear below `星系` or elsewhere in the page.
- Remove the current duplicate page-level `notice` for placement mode.
- No right-side `取消` box/button.
- Instruction text centered.
- Clicking outside the instruction popover cancels placement mode and creates nothing.
- A map tap while placement mode is active still chooses the canonical position and opens the create Paper.

### 3.3 `星系`

- Replace the current half-screen bottom sheet with an anchored floating popover near `星系`.
- No modal backdrop/dimming.
- Contains `全部` plus all galaxies ordered by `order`.
- Galaxy rows retain the small galaxy-color dot.
- Selecting an item closes the popover and preserves camera position.
- Clicking outside closes without changing selection.
- Inactive entry reads exactly `星系`.
- Active entry may show `星系` plus a very light dot and active galaxy name, but must remain visually quiet.

## 4. Paper shell relationship to Memory / Diary / Task

Universe should reuse the accepted `PaperDetailDialog` interaction shell: centered paper, frozen background, outside-veil close, focus restoration, keyboard trap, and scroll behavior.

Universe changes only its internal visual treatment:

- remove ruled horizontal lines from Universe node papers
- remove bottom-right `Universe` signature
- retain a clean white paper surface
- keep transparent/unboxed inputs
- keep mobile input font size at least 16px to avoid iOS zoom
- keep the accepted date/top-right action geometry of the shared paper system

Do **not** globally remove rules/signatures from Memory, Diary, Task, Todo, or other Paper consumers. Universe must opt out locally.

## 5. Node detail Paper — reading first

The detail state is a reading paper, not a field inspector.

### Top edge

- Top-left: readable node timestamp formatted `YYYY.MM.DD HH:mm` using local display time, never raw ISO.
- Top-right: `编辑 · ···`.
- `···` contains low-frequency actions such as:
  - `建立连接`
  - `恢复上一版本` when available
  - node deletion/removal if retained by the product; keep it low-frequency and require the existing safety behavior

### Main scroll body

Show only meaningful node content:

1. title
2. summary, if present, as a lighter introductory paragraph
3. content/body, if present
4. Connections section

Do not render a `dl`/field list for type, importance, tags, or galaxy memberships.

### Connections

Connections live in the scroll body after node content, not in the fixed footer.

- Heading: `Connections`, visually light.
- Each connection is a simple text row.
- Related node title is the primary clickable text.
- Relation type follows in lighter text, e.g. `正在思考  raises`.
- Clicking the related node keeps the existing behavior: close paper, preserve zoom, reveal/pan only if needed, select target; do not auto-open target paper.
- No large `移除连接` button in detail/read mode.

## 6. Node create/edit Paper — content first

Create and edit share the same visual language. Editing an existing node happens **in the same open Paper**; do not open a second editor shell.

### Top edge

Create:

- Top-left: current time formatted `YYYY.MM.DD HH:mm`.
- Top-right: `取消 · 保存`.

Edit:

- Top-left: the node timestamp formatted `YYYY.MM.DD HH:mm`.
- Top-right: `取消 · 保存`.

### Main body

No traditional labels such as `标题`, `摘要`, `正文`, `类型`, `重要性`, `标签`, `星系成员与权重`.

The content hierarchy is:

1. large transparent title input; placeholder `星球标题`
2. lighter summary textarea/input directly below; no visible field label
3. large transparent body textarea; no visible field label
4. Connections section for existing nodes

Inputs have no gray boxes, no borders, no card wrappers.

Create has no Connections until saved.

## 7. Fixed Paper footer metadata

The fixed footer is reserved for light metadata and galaxy membership only. Connections never live here.

Target reading/editing language:

`reflection · anchor · #自我观察 #认知演化`

and a second light line for galaxies, e.g.

`星系  意识与自我 1 · 时间与记忆 0.9 · ＋`

Do not use pills, large fieldsets, native selects, checkbox matrices, or boxed number inputs.

## 8. Type and importance popovers

Keep current canonical values unchanged.

Type options:

- `concept`
- `question`
- `claim`
- `experience`
- `project`
- `source`
- `reflection`

Importance options:

- `anchor`
- `major`
- `normal`

In edit/create mode:

- current value is plain footer text
- tapping it opens a small anchored white popover
- current option may use an extremely light gray background
- selecting replaces the draft value and closes
- outside click closes without changing
- do not introduce new enum values or translations into persistence

## 9. Tags

Tags remain canonical `string[]`.

- Edit them as a lightweight transparent footer text input, visually consistent with Memory/Diary metadata.
- Display as `#tag` text in read mode.
- Parsing behavior may continue to accept comma/Chinese-comma separated input.

## 10. Galaxy membership and weight editing

Canonical membership remains exactly `{ id: string, weight: number }[]`.

No silent defaults. No normalization to string IDs. No clamping to `[0,1]`; only finite-number validation is required by the current contract.

### Existing memberships

Display each as plain text `银河名 weight`.

Tapping an existing membership opens a tiny local editor containing:

- transparent numeric weight input using the exact current value
- `移出星系`

Changing a weight changes only that membership's weight.

### Adding membership

- Footer `＋` opens a small popover listing only galaxies not already present.
- Each row shows the galaxy's extremely pale color dot and title.
- Selecting a galaxy adds it to the draft in a **pending-weight state** without inventing a numeric value.
- Focus moves to a tiny transparent weight input for that new membership.
- Until every selected membership has a finite numeric weight, Save is disabled and a light inline error may say `请填写星系权重`.
- Zero memberships is valid; UI must not force membership.

Implementation may use an internal draft representation that permits a blank weight string, but `onSave` must only receive canonical finite-number memberships.

## 11. Connection editing actions

In edit mode, connection rows remain lightweight.

- Keep related-node navigation.
- A small trailing `···` may expose `移除连接`.
- Do not show large delete buttons per row.
- `建立连接` remains a low-frequency action from the detail paper overflow and preserves the accepted map-target workflow.
- Do not replace the map target workflow with a target dropdown inside Paper.

## 12. Error, close, and dirty behavior

- Save errors appear as a light paper-bottom error, consistent with the shared Paper shell.
- Preserve existing uncertain-write reconciliation and authoritative reread behavior.
- Preserve unsaved/close safety already provided by the node paper flow; do not silently discard edits.
- Outside-click behavior for the top-level map popovers must not accidentally close an open Paper.

## 13. Acceptance criteria

On a production-size mobile viewport:

1. map is edge-to-edge and substantially paler than the current production screenshots
2. `星系` and `查看全部` align horizontally and sit about 20px higher
3. export is an anchored popover below `···`; centered text; outside tap closes
4. add instruction is an anchored popover below `＋`; centered text; no cancel box; outside tap cancels placement; no duplicate page notice
5. galaxy selector is an anchored popover, not a bottom sheet
6. detail paper shows readable timestamp, title/summary/content, light Connections, footer metadata; no field inspector
7. create/edit paper shows transparent title/summary/content editors with metadata in footer
8. Universe node papers have no horizontal rules and no bottom-right Universe signature
9. type/importance/galaxy editors are small anchored popovers, not native selects/fieldset matrices
10. weighted memberships remain exact and never receive generated defaults
11. existing map camera, selection, move, reveal, relation-target, create, and authoritative mutation semantics remain intact
12. loading/uninitialized/importer states remain visually and functionally unchanged
