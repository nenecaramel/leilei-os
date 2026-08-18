# Phase 7.2 Export UI Polish Design

## Goal

Keep the existing export behavior on `System → Data` while making the Export card visually consistent with the approved System mobile language.

## Scope

Only the Export card presentation changes. Export API paths, scopes, download behavior, audit query semantics, backend code, database schema, MCP behavior, and exported JSON remain unchanged.

## Layout

Keep the existing Data summary card unchanged.

Keep Export as a separate card below Data with the approved `12px` card-to-card gap, System border, `14px` radius, background, shadow, and `13px` horizontal card inset.

Inside the Export card there are three visual rows:

1. `Export` alone on the first row, using Account label typography: 14px, weight 500, #171717.
2. `All`, `Memory`, `Diary`, `Task`, `Todo` on the second row as five equal-width pure-text actions. No button chrome, dividers, pills, fills, or borders. The first action text aligns exactly with the left card content inset; the last action aligns exactly with the right card content inset; middle actions are centered in equal columns. The first-to-second-row spacing is increased to `18px`, matching the more open vertical rhythm of the existing System data rows.
3. `Include audit/lifecycle events` on the third row, using Account `Signed in with Auth0` typography: 12px, weight 400, #8a8a8a. Its spacing from the action row is `14px`.

No separator lines appear inside the card.

## Export Actions

The second row contains five actions in this exact order:

- `All`
- `Memory`
- `Diary`
- `Task`
- `Todo`

Each remains a semantic button and preserves its current scope: `all`, `memory`, `diary`, `task`, `todo`.

While export is pending, all five actions remain disabled.

## Audit Toggle

Do not show a checkbox, switch, border, tile, pill, or background.

Keep a real checkbox in the DOM for state/accessibility, but visually hide it.

The whole `Include audit/lifecycle events` text row is clickable:

- inactive: text stays #8a8a8a, no checkmark;
- active: text becomes #555555 and a small plain `✓` appears immediately to the right of the text;
- `✓` has no surrounding shape, border, or background;
- tapping/clicking the row must not produce a gray selection rectangle, tap-highlight tile, focus box, or background state;
- audit remains off by default;
- active audit continues to append `include_audit=true` to export requests.

## Error State

Existing local export error behavior remains. `Unable to export data.` stays inside the Export card and must not clear or alter the Data summary.

## Files

Implementation surface:

- `web/src/pages/SystemDataPageContent.tsx`
- `web/src/pages/system-export-ui-polish.css`
- `tests/system-data-export-ui.test.ts`
- `tests/system-export-ui-css.test.ts`

No backend, DB, MCP, Notion, PWA, or export contract changes.
