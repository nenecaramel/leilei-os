# Home Calendar Real Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Home Calendar fixture markers with real Todo + Diary content dates, month navigation, Day Space links, and explicit loading/error behavior.

**Architecture:** Keep data discovery in `DashboardPage`: load existing Todo and Diary date lists, union them, and pass the result plus load state into `CalendarPreview`. Keep month presentation/navigation in `CalendarPreview`. Add a small pure date-union helper and a narrow CSS override file rather than editing the large shared stylesheet.

**Tech Stack:** React 19, TypeScript, React Router, existing authenticated Web API client, Node test runner.

## Global Constraints
- Base: `a14d99b8ea8ecfdd562a5b6e2c335b8ab897425c`.
- No schema, migration, MCP, PWA, Todo, Records, or Day Space behavior expansion.
- No fixture markers while loading or after failure.
- One marker per business date; no source/author/count encoding.
- Do not merge or deploy during implementation.

---

### Task 1: Lock the Calendar contract with regression tests

**Files:**
- Create: `tests/home-calendar-real-data.test.ts`

**Interfaces:**
- Consumes current `DashboardPage.tsx`, `CalendarPreview.tsx`, `day-space-api.ts` source.
- Produces source-level regression gates for real date discovery, fixture removal, month controls, markers, and Day Space navigation.

- [ ] Write failing source-contract tests proving the current fixture implementation does not satisfy the frozen contract.
- [ ] Run the focused test and confirm RED before changing production files.
- [ ] Commit the regression test.

### Task 2: Reuse Diary date discovery and add pure Calendar date merging

**Files:**
- Modify: `web/src/pages/day-space-api.ts`
- Create: `web/src/pages/home-calendar-data.ts`

**Interfaces:**
- Produces `listDiaryDates(api, signal?)` and `mergeCalendarContentDates(todoDates, diaryDates): string[]`.

- [ ] Export the existing Diary date read as a reusable function without changing its endpoint or response contract.
- [ ] Add a pure helper that filters valid `YYYY-MM-DD` keys, unions, deduplicates, and sorts them.
- [ ] Keep `createDaySpaceApi` using the same exported Diary helper.

### Task 3: Wire Home to real Calendar data

**Files:**
- Modify: `web/src/pages/DashboardPage.tsx`

**Interfaces:**
- Consumes `listTodoDates`, `listDiaryDates`, `mergeCalendarContentDates`.
- Produces `contentDates`, `calendarLoadState`, and `onRetry` props for `CalendarPreview`.

- [ ] Remove `HOME_CALENDAR_DAYS` runtime import/use.
- [ ] Load Todo + Diary date lists together under a generation guard.
- [ ] Clear marker data while loading; set ready only after both reads succeed; set error on failure.
- [ ] Pass the real union and retry callback to CalendarPreview.

### Task 4: Make CalendarPreview interactive and state-aware

**Files:**
- Modify: `web/src/pages/CalendarPreview.tsx`
- Create: `web/src/pages/home-calendar-real-data.css`
- Modify: `web/src/main.tsx`

**Interfaces:**
- `CalendarPreview({ contentDates, date, status, onRetry })`.

- [ ] Add previous/next month buttons with local visible-month state.
- [ ] Render current-month dates as links to `/day-space?date=YYYY-MM-DD`; filler dates remain inert.
- [ ] Render one marker only when `status === "ready"` and the date exists in `contentDates`.
- [ ] Preserve today styling independently from marker styling.
- [ ] On error, keep the calendar grid and render a narrow retry message; loading keeps the grid but no markers.
- [ ] Add only narrow Calendar-specific CSS and import it globally from `main.tsx` so Node component imports do not pull CSS directly.

### Task 5: Verification

**Files:** none

- [ ] Run `pnpm exec tsx --test --test-concurrency=1 tests/home-calendar-real-data.test.ts tests/dashboard-page.test.ts tests/day-space-real-data.test.ts`.
- [ ] Run root `pnpm typecheck` and `pnpm build`.
- [ ] Run web `pnpm typecheck` and `pnpm build`.
- [ ] Run `git diff --check` and inspect `git status`.
- [ ] Stop before merge/deploy and report the feature HEAD for product acceptance.