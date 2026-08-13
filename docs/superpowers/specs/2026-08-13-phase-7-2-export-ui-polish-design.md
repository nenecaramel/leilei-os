# Phase 7.2 Export UI Polish Design

## Goal

Replace the visually inconsistent export controls on `System → Data` with one compact System-style card while preserving all existing export behavior.

## Scope

Only the presentation of the existing export controls changes. Export API paths, scopes, download behavior, audit query semantics, backend code, database schema, MCP behavior, and exported JSON remain unchanged.

## Layout

Keep the existing Data summary card unchanged.

Add a separate Export card below it. The vertical gap between the Data card and Export card is exactly `12px`, matching the spacing between Activity day cards.

The Export card reuses the existing System card language: full width, `13px` horizontal inset, `14px` radius, existing System border/background/shadow.

Inside the Export card:

- No separator lines anywhere.
- First content row uses an Account-style two-column layout.
- Left side: `Export`, using the same visual treatment as Account `Name` / `Email` labels: 14px, weight 500, #171717.
- Right side: five vertically stacked pure-text actions in this order: `All`, `Memory`, `Diary`, `Task`, `Todo`.
- These actions have no border, fill, pill, tile, or button chrome. They use Account-value-style typography: 14px, weight 400, right aligned.
- Each action preserves its current export scope: `all`, `memory`, `diary`, `task`, `todo`.
- While an export is pending, all five text actions remain disabled just as the current buttons are.

Below the export actions, keep the audit control inside the same card:

- Text: `Include audit/lifecycle events`.
- Typography must match Account `Signed in with Auth0` (`.system-note`): 12px, weight 400, #8a8a8a.
- Use a compact checkbox aligned on the right.
- Checkbox geometry follows the existing project compact checkbox treatment: 19×19px, 5px radius, theme accent.
- Audit is off by default.
- Checking it continues to append `include_audit=true` to export requests.

Do not add a custom switch component or a new visual language.

## Error State

Existing local export error behavior remains. `Unable to export data.` stays inside the Export card and must not clear or alter the Data summary.

## Files

Expected implementation surface:

- `web/src/pages/SystemDataPageContent.tsx`
- `web/src/styles.css`
- `tests/system-data-export-ui.test.ts`

No other production files should change unless required by an actual test failure caused by this presentation change.

## Tests

Update focused UI tests to verify:

- five export actions still exist in the approved order;
- each pure-text action requests the correct scope;
- audit remains off by default;
- enabled audit still sends `include_audit=true`;
- pending export disables all actions;
- export failure stays local and preserves the loaded Data summary;
- the component uses the new Export-card/action/control classes instead of the old `.system-export-actions button` layout.

Run focused tests plus root/web typecheck and build before merge.

## Out of Scope

- Export backend or JSON changes
- Data summary redesign
- Database or migrations
- MCP
- Notion
- PWA work
- Health/Toy changes
- General System-page redesign
