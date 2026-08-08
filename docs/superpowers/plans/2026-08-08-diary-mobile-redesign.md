# Diary Mobile Redesign Implementation Plan

> Execute against the approved design spec:
> `docs/superpowers/specs/2026-08-08-diary-redesign-design.md`

## Goal

Bring mobile Diary into the accepted Memory visual/interaction language while preserving Diary semantics, URL state, lifecycle behavior, and desktop UI.

## Constraints

- Mobile only; desktop unchanged.
- No DB schema migration.
- No time-of-day.
- No MCP Diary contract changes.
- Mood stays free text.
- Header order: Date / Mood / Tag / Search / Archive / Create.
- Archive header: Archive + true count + Return only.
- Group by `diary.date`.
- View/Edit/Create share `PaperDetailDialog` geometry.
- Keep `N` bottom-right.
- Preserve quick-create, unsaved guards, mutation single-flight, Back/Forward, exact return URLs, and scroll restoration.
- Never stage or commit `web/preview.html` or `web/src/preview-main.tsx`.
- Use TDD for each behavior change.

## Task 1 — True counts

Modify:
- `src/domains/diary/diary-repository.ts`
- `src/domains/diary/diary-service.ts`
- Diary repository/service/search/lifecycle tests.

Add repository methods for true active filtered count and archived count. Reuse exactly the same active filter predicates as list retrieval. Count must be independent of row limit. Keep API response shape unchanged.

RED first: prove `limit: 1` can return one row while metadata count is greater than one.

## Task 2 — Presentation helpers and icons

Create `web/src/pages/diary-presentation.ts` with:
- month grouping by calendar `date`;
- row date formatting;
- paper date formatting;
- mood/tag metadata formatting.

Avoid timezone drift by treating `YYYY-MM-DD` as a calendar date.

Add `CalendarIcon` and neutral `MoodIcon` to `web/src/components/icons.tsx` using the existing `IconBase`.

Add focused tests.

## Task 3 — Diary mobile header

Create `web/src/pages/DiaryPageHeader.tsx`.

Required order:
1. Date
2. Mood
3. Tag
4. Search
5. Archive
6. Create

Date expands start/end native date inputs. Mood and Tag are free-text controls. Search preserves existing full-text `q`. Use Memory header/tool styling where safe. Add component tests for order, count, controls, callbacks, and Escape behavior.

## Task 4 — Paper-native Diary editors

Create `web/src/pages/DiaryPaperEditor.tsx`.

Provide:
- title + content editor;
- interactive top-left Diary date;
- bottom-left free-text mood + tags editor.

Broaden `PaperDetailDialog.dateLabel` from `string` to `ReactNode` only; do not alter its geometry.

Create defaults to local today. Date remains date-only. Add tests and rerun Memory paper regressions.

## Task 5 — Rebuild mobile Diary presentation

Modify `web/src/pages/DiaryPage.tsx` while retaining its existing request/filter/mutation/URL machinery.

Replace mobile generic PageHeader/forms/cards with:
- `DiaryPageHeader`;
- Memory-style month cards and two-line rows;
- `PaperDetailDialog` for create/view/edit;
- matching Archive list and archived paper detail.

Row layout:
- line 1: title;
- line 2 left: Diary date;
- line 2 right: mood/tags summary.

Create/Edit/View use identical paper coordinates. Active detail actions: Archive · Edit. Edit/Create: Cancel · Save. Archive detail: Restore only.

Keep direct-refresh behavior that skips unnecessary list calls.

## Task 6 — Navigation and scroll parity

Strengthen tests for:
- filtered list -> detail -> close;
- filtered list -> Archive -> Return;
- Archive -> archived detail -> back;
- restore;
- Back/Forward;
- unsaved-change blocking.

Add Memory-style list-availability handling so an in-page paper leaves the loaded list stationary underneath it.

Remove detail behavior that scrolls the underlying page to top.

Before entering Archive, save the active filtered list scroll. Return must update both URL and rendered React state. Restore must end on the exact active return URL and refresh active data without leaving UI stuck in Archive.

## Task 7 — Mobile Diary styles

Modify `web/src/styles.css` only under mobile Diary scope where Diary-specific rules are needed.

Reuse Memory geometry for page/header/month rows/paper.

Add narrow styles for:
- Diary date/mood/tag controls;
- date picker overlay on visible paper date text;
- borderless paper title/content/date/mood/tags;
- focus states with no boxed/yellow appearance;
- metadata not colliding with `N`.

Add CSS contract tests and rerun Memory visual/style regressions.

## Task 8 — Verification and visual acceptance

Run the complete focused Diary test set plus affected Memory/Paper regressions.

Mandatory gates:
- root `npm run typecheck`;
- `npm --prefix web run typecheck`;
- `git diff --check`;
- feature diff scope check;
- preview helpers remain untracked/uncommitted.

Stop before merge for mobile visual acceptance.

Visual acceptance must cover:
- title/count;
- exact six-tool order and icon balance;
- filter expansion;
- month cards/rows;
- paper date interaction;
- mood/tags bottom-left;
- fixed `N`;
- identical View/Edit/Create geometry;
- Archive Return;
- archived Restore;
- stationary list behind paper.

Only after explicit visual acceptance: rerun fresh gates, push feature branch, integrate into `codex/phase-6-web-ui-foundation`, verify remote baseline, then remove the feature branch.
