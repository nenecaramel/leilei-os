# Phase 7.2 Export UI Polish Design

## Goal

Keep the separate `System → Data` Export card, but make it visually consistent with the accepted System language while preserving all existing export behavior.

## Scope

Only presentation changes. Export API paths, scopes, download behavior, audit query semantics, backend code, database schema, MCP behavior, and exported JSON remain unchanged.

## Layout

Keep the existing Data summary card unchanged.

The Export card remains a separate card exactly `12px` below Data, matching the spacing between Activity cards. It reuses the existing System card geometry: full width, `13px` horizontal inset, `14px` radius, and the existing System border/background/shadow.

There are no separator lines anywhere inside the Export card.

### Row 1 — Export label

- Left aligned `Export` only.
- Typography matches Account `Name` / `Email`: 14px, weight 500, `#171717`.
- The card starts with the existing `13px` System inset rhythm.

### Row 2 — export scopes

- One horizontal row containing, in order: `All`, `Memory`, `Diary`, `Task`, `Todo`.
- The five actions occupy five equal-width columns so their centers and overall left/right spacing remain visually even.
- Actions are pure text: no border, fill, pill, tile, button chrome, or separators.
- Typography remains 14px, weight 400.
- The action row sits `10px` below the Export label.
- Each action preserves its current scope: `all`, `memory`, `diary`, `task`, `todo`.
- While an export is pending, all five actions remain disabled.

### Row 3 — audit option

- Text: `Include audit/lifecycle events`.
- Typography starts with the same appearance as Account `Signed in with Auth0`: 12px, weight 400, `#8a8a8a`.
- The row sits `12px` below the scope row.
- Do not render a visible checkbox, switch, border, circle, pill, or background.
- The entire text control remains clickable and retains an accessible hidden checkbox for form semantics.
- Audit is off by default: text is light gray and there is no checkmark.
- When enabled, the text becomes darker (`#555555`) and a small plain `✓` appears immediately to the right of the text with a tight gap.
- The `✓` has no border, container, or background.
- Enabled audit continues to append `include_audit=true` to export requests.

## Error State

Existing local export error behavior remains. `Unable to export data.` stays inside the Export card and must not clear or alter the Data summary.

## Files

Implementation surface:

- `web/src/pages/SystemDataPageContent.tsx`
- `web/src/pages/system-export-ui-polish.css`
- `tests/system-data-export-ui.test.ts`

No backend or unrelated production files change.

## Tests

Focused UI tests verify:

- `Export` is its own header row;
- the five scope actions remain in the approved order;
- the scope actions use the horizontal action-row structure;
- audit remains off by default;
- inactive audit has no visible checkmark;
- activating audit produces the plain `✓` state and still sends `include_audit=true`;
- scope requests and downloaded JSON behavior remain unchanged;
- pending export disables all scope actions;
- export failure stays local and preserves the loaded Data summary.

## Out of Scope

- Export backend or JSON changes
- Data summary redesign
- Database or migrations
- MCP
- Notion
- PWA work
- Health/Toy changes
- General System-page redesign
