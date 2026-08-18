# Home Calendar Real Data Design

## Goal
Replace Home Calendar fixture markers with real Day Space content dates while preserving the accepted Calendar visual structure.

## Data contract
- A date has one marker when either Todo has at least one non-empty persisted entry on that business date or there is at least one active Diary on that date.
- Reuse existing authenticated read endpoints: `/todo/dates` and `/diary/dates`; union and deduplicate the returned date keys in Web code.
- Empty Todo papers and archived Diary entries do not produce markers because the existing endpoints already exclude them.
- No new database schema, persistence domain, or cross-module aggregation API.

## Calendar behavior
- One marker per date only; no source, author, or count encoding.
- Today highlight and content marker may coexist.
- Previous/next controls change the visible month locally.
- Current-month dates navigate to `/day-space?date=YYYY-MM-DD`.
- Outside-month filler cells remain non-interactive in v1.

## States
- Loading keeps the calendar geometry and renders no marker data.
- Ready with zero dates is a normal calendar with no markers.
- Error keeps the calendar geometry and exposes a narrow retry action; it must not look like an empty result.

## Scope
- Remove Home Calendar runtime dependency on `HOME_CALENDAR_DAYS`.
- Preserve Home Todo, Records, Day Space, MCP, PWA, schema, and production safety boundaries.
- No Calendar visual redesign.