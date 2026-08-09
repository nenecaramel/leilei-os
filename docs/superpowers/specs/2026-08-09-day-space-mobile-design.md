# Day Space Mobile Design

Date: 2026-08-09
Base: `40c50c2364a16881f74a041134efeb27afa17c38`
Branch: `leilei/day-space-2026-08-09`

## Scope

This iteration defines and visually implements the mobile Day Space page only. It does not add production Todo persistence, Calendar marker semantics, Calendar backend capability, or MCP writes. Desktop-specific Day Space layout is out of scope.

The same frontend pass also removes legacy large-card list states from the mobile Memory / Diary / Task surfaces where connection failures or empty archive states still fall back to the old `.memory-message` presentation.

## Day Space product contract

Day Space is a read-and-edit surface for one business date. It does not create content.

- The page title is `Day Space`, left aligned in the same mobile title system as the current core pages.
- There is no subtitle, item count, add button, or create CTA.
- The centered date row is `‹  August 5, 2026  ›`.
- Left and right controls move exactly one day backward or forward.
- The center date is clickable and opens a compact month date-picker popover anchored below it.
- Selecting a date closes the picker and changes the displayed Day Space.
- The picker marks today lightly and marks the selected Day Space date more strongly. If both are the same day, only the selected state is shown.
- The picker does not show content markers; those belong to Calendar.

### Entry semantics

For a selected date, Day Space may contain:

- one whole `L Todo` paper if L has Todo-paper content for that date;
- one whole `G Todo` paper if G has Todo-paper content for that date;
- one paper for each Diary entry on that date.

Todo items are not split into independent cards. Empty Todo papers do not appear. Existing content only is shown.

Todo is not Task. This page must not derive Todo papers from the Task module.

### Authorship

Every displayed paper has an `L` or `G` signature at bottom right. This is content attribution, not login identity.

The current production Diary schema at this base does not yet provide L/G authorship. The Day Space visual prototype may use a presentation fixture/view model for signed Diary papers, but it must not guess authorship for real Diary records. Real-data wiring waits for the horizontal L/G authorship migration.

## Paper stage

The content area is a freeform vertical paper stage, not a list, masonry grid, or two-column card wall.

Paper placement uses a deterministic controlled-scatter algorithm:

- stable seed from business date + content identity;
- seed chooses left / center / right bias;
- seed chooses small / medium / large paper size within safe bounds;
- seed chooses a small rotation, approximately ±2–4 degrees;
- seed chooses vertical spacing and z-index;
- most papers do not overlap;
- a minority may overlap only at edges, with roughly 8–15% maximum visual occlusion;
- collisions beyond the allowed overlap push the later paper down or sideways;
- the same date and content set always produce the same layout;
- different dates naturally produce different layouts.

Visible whitespace is intentional. When content is long, the stage continues vertically and the page scrolls normally. There is no horizontal canvas, pan, or zoom.

### Paper visual language

Paper surfaces remain inside the accepted Leilei OS mobile visual language: white/neutral surface, fine border, subtle shadow, existing typography. No handwriting font, old-paper texture, colorful sticky-note treatment, or decorative stationery styling.

Each paper contains only:

- a light `Todo` or `Diary` type label;
- a content preview;
- the `L` / `G` signature.

Diary previews show the title plus a limited number of content lines. Todo previews show as many leading entries as the chosen paper size safely permits. Overflow is clipped or softly faded; papers do not grow indefinitely to show full content.

## Editing behavior

Tapping a paper opens the corresponding existing paper editor/dialog over Day Space. It does not navigate to the Diary or Todo module.

After closing the editor:

- the selected date remains unchanged;
- the paper layout seed remains unchanged;
- scroll position should remain stable where practical;
- the edited preview refreshes without reshuffling unrelated papers.

Day Space itself exposes no creation control.

## Date routing and entry behavior

Use a date-addressable route such as `/day-space?date=YYYY-MM-DD`.

- Explicit `date` means display that exact date.
- Day Space navigation entry without an explicit date resolves the latest business date that contains either Todo-paper content or Diary content.
- If no Todo/Diary content exists globally, navigation falls back to today.
- Explicit navigation from date picker, previous/next arrows, or future Calendar date clicks always respects that selected date and must not redirect back to the latest-content date.

The current repository has Day Space as a disabled `soon` navigation item and has no Day Space route at this base. This iteration activates the route and navigation surface without defining Calendar marker computation.

## Day Space states

The title and date controls stay present in every state.

### Loading

Only the paper stage becomes a lightweight loading treatment. Avoid a large card. Load the date's content as one visual batch so papers do not jump into place one by one.

### Empty

If the selected date has no visible papers, show only:

`这一天还没有内容`

No icon, border card, illustration, button, or create CTA.

### Error

If the selected date cannot be loaded, show a lightweight inline state in the paper area:

`加载失败，请重试`

with a quiet retry text control. Date navigation remains usable. Error and empty are distinct states.

## Memory / Diary / Task mobile state cleanup

At the current base, the normal mobile unfiltered empty states already use the accepted plain `.memory-empty-state` treatment. Filtered-empty states also share the current plain-text clear-control contract.

The remaining mismatch is that several connection-failure paths still call `MemoryMessage`, `DiaryMessage`, or `TaskMessage`. Those helpers render the legacy `.memory-message` surface with a large bordered card, large minimum height, placeholder icon, and shadow. Memory archive empty/error also still uses this legacy message path.

For mobile top-level list surfaces only:

- Memory active list error: replace legacy message card with the lightweight inline state language.
- Diary active list error: same.
- Task active list error: same.
- Mobile archive-list errors for Memory / Diary / Task: same.
- Memory archive empty: use the same lightweight empty-state language rather than the legacy message card.
- Existing mobile normal empty states remain unchanged unless necessary for shared styling.
- Filtered-empty `清除条件` spacing and behavior remain unchanged.
- Detail-dialog error states remain within their existing dialog/paper context; this cleanup does not redesign detail editors.
- Desktop legacy layouts are not part of this visual pass.

The preferred shared treatment is the current plain mobile state pattern: muted 14px text, no enclosing card, no placeholder icon, and a plain-text secondary action when retry is available.

## Implementation boundaries

This visual pass may introduce focused Day Space components and a deterministic layout helper. It should reuse existing dialog/editor patterns where possible and avoid unrelated refactors.

Do not:

- add Todo backend persistence;
- collapse Todo into Task;
- infer missing Diary authors;
- invent Calendar marker rules;
- add Calendar backend APIs;
- add MCP write/read capabilities;
- modify the System work or MCP/backend branches;
- commit preview-only helper files.

## Acceptance criteria

On a mobile viewport:

1. Day Space matches the accepted page shell and left-aligned title language.
2. Date arrows, center date picker, today/selected picker states, and explicit date routing behave as specified.
3. Existing Todo/Diary presentation fixtures render as a deterministic scattered paper stage, not a grid.
4. Refreshing the same date preserves paper placement.
5. Different dates can produce visibly different stable layouts.
6. Paper overlap never obscures main preview content or signatures.
7. No Day Space create control exists.
8. Empty and error states are lightweight and cardless.
9. Memory / Diary / Task mobile list connection errors no longer show the legacy large `.memory-message` card.
10. Existing filtered-empty behavior and spacing remain intact.
11. Root and web typecheck/build, focused regression tests, serial full test suite, and `git diff --check` pass before completion.
