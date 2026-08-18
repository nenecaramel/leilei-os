# Diary Mobile Redesign Design

## Status

Approved design for the Diary mobile UI and interaction redesign.

This specification applies to the mobile Diary experience only. It uses the completed Memory mobile redesign as the visual and interaction reference while preserving Diary-specific business semantics.

## 1. Goals

Redesign Diary so that it belongs to the same mobile product language as Memory.

The result should feel like the same application rather than a separately designed module:

- same mobile page rhythm;
- same title/count hierarchy;
- same compact tool row;
- same month-grouped list structure;
- same paper detail geometry;
- same paper-native create/edit interaction;
- same archive navigation model;
- same return, browser-history, scroll-restoration, and unsaved-change behavior where applicable.

Diary must retain its own domain fields and filtering capabilities:

- diary date;
- mood;
- tags;
- full-text search;
- archive lifecycle.

Desktop behavior is outside this redesign and must remain unchanged.

## 2. Non-goals

This redesign does not include:

- database schema changes;
- time-of-day support;
- datetime storage;
- a fixed mood enum;
- a mood emoji library;
- MCP Diary contract changes;
- unrelated backend or frontend refactoring;
- changes to Memory behavior;
- changes to Todo paper geometry;
- desktop redesign;
- arbitrary free-position writing on paper.

Diary dates remain calendar dates in `YYYY-MM-DD` form.

## 3. Page header

### 3.1 Active Diary page

The mobile header contains:

- left:
  - title: `Diary`;
  - subtitle: `{n}篇日记`;
- right, in this exact order:
  1. Date;
  2. Mood;
  3. Tag;
  4. Search;
  5. Archive;
  6. Create.

The ordering is intentionally chosen to keep Diary visually aligned with Memory: filters first, then search, then Archive and Create as the final two actions.

### 3.2 Icons

All new icons must use the same thin-line SVG language as the existing Memory toolbar.

Date icon:

- simple calendar outline;
- two short binding marks at the top;
- one inner horizontal divider;
- no number inside the calendar.

Mood icon:

- neutral face;
- circular outline;
- two simple eyes;
- short neutral mouth;
- must not imply that mood means “happy”.

Existing Tag, Search, Archive, and Pen/Create icon language should be reused from Memory where practical.

Touch targets remain consistent with the existing mobile toolbar.

### 3.3 Count semantics

`{n}篇日记` must represent the true matching count, not merely the number of entries returned by the current limited result set.

For the active page:

- with no filters: true count of all active diary entries;
- with filters: true count of all active diary entries matching the current filters.

For Archive:

- true count of all archived diary entries.

The count must remain correct even when more entries exist than the list API's normal result limit.

## 4. Filters

Diary retains all currently supported filters.

### 4.1 Date

The Date tool expands a compact date-range control containing:

- start date;
- end date.

These map to the existing date range semantics:

- `date_from`;
- `date_to`.

Either boundary may be empty.

The existing validation rule that the start date cannot be later than the end date remains unchanged.

### 4.2 Mood

Mood remains free text.

It must not become an enum or predefined choice list.

The toolbar Mood control expands a text input that maps to the existing mood filtering semantics.

### 4.3 Tag

Tag filtering remains available and maps to the existing tag filtering semantics.

### 4.4 Full-text search

Full-text search remains in Diary.

It continues to search Diary title and content through the existing `q` behavior.

The Search tool should visually and behaviorally follow the accepted Memory search interaction.

### 4.5 URL/history behavior

The complete active Diary filter state remains represented in the URL.

The existing Diary query keys remain the source of truth:

- `q`;
- `tag`;
- `mood`;
- `date_from`;
- `date_to`.

Browser Back/Forward must restore the visible toolbar/filter state.

Returning from a detail view or Archive must restore the exact previous Diary URL rather than returning to an unfiltered generic Diary page.

## 5. Active Diary list

The mobile list adopts the accepted Memory list structure.

### 5.1 Month grouping

Entries are grouped by the Diary domain date, `diary.date`.

Grouping must not use:

- creation timestamp;
- update timestamp.

Groups are ordered consistently with the existing Diary descending date semantics.

### 5.2 Monthly card structure

Each month has:

- one month label;
- one shared rounded card;
- multiple Diary rows inside that card.

This should visually match Memory's accepted month-section/card rhythm.

### 5.3 Diary row

Each Diary row uses the same information hierarchy as Memory:

- first line: Diary title;
- second line:
  - left: Diary date;
  - right: compact mood/tag metadata.

Diary does not introduce a separate “date header row” above the title.

Missing optional metadata should disappear cleanly rather than leaving placeholder punctuation.

Mood and tags should remain secondary information.

### 5.4 Empty/loading/error states

Mobile Diary empty, loading, and error states should be brought into the same visual family as Memory without changing the meaning of existing Diary errors.

Filtered empty state must distinguish itself from a genuinely empty Diary and provide a clear way to remove filters.

## 6. Paper detail model

Diary uses the existing accepted `PaperDetailDialog` geometry.

View, Edit, and Create must occupy the same paper coordinates.

The redesign must not fork a second paper geometry specifically for Diary.

The bottom-right signature remains:

`N`

## 7. Diary paper layout

### 7.1 Top-left date

The paper top-left position represents the Diary domain date.

View mode:

- render the Diary date as text.

Edit mode:

- the displayed date itself is interactive;
- tapping it opens/selects a calendar date;
- no time-of-day selector is introduced.

Create mode:

- defaults to today's local calendar date;
- the date is immediately editable through the same top-left interaction.

The date control should visually read as text written on the paper rather than a conventional boxed form field.

### 7.2 Title and content

Title and content follow the accepted Memory paper content placement.

View mode:

- title is read-only;
- content is read-only.

Edit/Create mode:

- title and content are edited directly on the paper;
- fields remain borderless;
- no yellow form background;
- no browser-default focus ring;
- no boxed desktop-form appearance.

Existing Diary title/content validation remains authoritative.

### 7.3 Bottom-left metadata

The Diary-specific bottom-left metadata area contains:

- Mood;
- Tags.

View mode:

- render mood and tags as compact read-only text.

Edit/Create mode:

- both are editable in place;
- Mood is free text;
- Tags retain the existing Diary tag model;
- controls should look paper-native rather than like a conventional form panel.

If mood is empty, that is valid.

Tags remain optional.

## 8. Detail actions

### 8.1 Active Diary view mode

Top-right controls:

`归档 · 编辑`

### 8.2 Active Diary edit mode

Top-right controls:

`取消 · 保存`

Saving updates all editable Diary fields together:

- title;
- content;
- date;
- mood;
- tags.

The existing Diary update endpoint and domain validation remain in use.

### 8.3 Create mode

Top-right controls:

`取消 · 保存`

Create uses the existing Diary create flow and must include:

- title;
- content;
- selected date;
- mood;
- tags.

The default date is today, but the user may change it before saving.

### 8.4 Unsaved changes

Existing unsaved-change protection must continue to apply when leaving an active Diary create/edit state.

This includes navigation caused by:

- closing the paper;
- opening another Diary;
- opening Archive;
- route changes where the existing guard applies.

No new duplicate confirmation system should be introduced if the existing shared mechanism can be retained.

## 9. Archive

### 9.1 Archive page

Archive follows the accepted Memory archive structure.

Header:

- left:
  - `Archive`;
  - `{n}篇日记`;
- right:
  - `Return` only.

Archive does not show the active-page Date, Mood, Tag, Search, or Create tools.

### 9.2 Archive list

Archived diaries use the same month-grouped visual structure as the active Diary list.

Grouping is still based on the Diary domain date.

### 9.3 Archived detail

Archived Diary detail uses the same paper geometry and is read-only.

It shows:

- Diary date at top-left;
- title;
- content;
- mood/tags at bottom-left;
- `N` at bottom-right.

Top-right contains only the restore action.

Archived Diary cannot be edited.

### 9.4 Restore

Restore returns the Diary to the active lifecycle.

After restore:

- archived state refreshes correctly;
- active Diary state is invalidated/refreshed as needed;
- true counts remain correct;
- routing must not leave the UI visually stuck on the Archive route.

## 10. Navigation and scroll restoration

Diary must align with the accepted Memory navigation behavior while retaining existing Diary URL contracts.

Required behavior:

- opening a Diary preserves the active list beneath the paper where feasible;
- closing the detail returns to the exact prior filtered Diary location;
- opening Archive stores the exact active Diary return location;
- `Return` restores that location;
- browser Back/Forward updates React-visible state, not only `window.history`;
- active Diary scroll position is restored;
- Archive list scroll position is restored when returning from archived detail;
- restore/archive operations must not corrupt the saved return location.

Use routed navigation helpers when React state must be notified of a URL transition; do not rely on a history mutation that changes only the browser URL while leaving the rendered route stale.

## 11. Backend true-count support

The current Diary list metadata count must be changed from “number of returned rows” to “true matching count”.

### 11.1 Active list count

Repository/service behavior must provide a true count using the same active-entry predicates as the list query:

- authenticated user;
- active lifecycle status;
- `q`;
- tag;
- mood;
- date-from;
- date-to.

The count query and list query must not diverge semantically.

### 11.2 Archive count

Archive metadata count must represent the true number of archived Diary entries for the user.

### 11.3 Result limit

The existing result limit may continue to limit returned rows.

The new true count is independent of that limit.

No pagination redesign is required in this scope.

## 12. Component boundaries

Prefer small Diary-specific components while reusing stable existing primitives.

Expected direction:

- `DiaryPage`
  - orchestration;
  - request state;
  - navigation;
  - lifecycle mutations;
  - filter state;
- `DiaryPageHeader`
  - six active-page tools;
  - expanded filter/search controls;
- Diary paper editor component
  - date;
  - title;
  - content;
- Diary paper metadata component
  - mood;
  - tags;
- shared `PaperDetailDialog`
  - geometry and overlay behavior.

Reuse existing Memory visual patterns and shared primitives where they are already safe.

Do not create a large generic Memory/Diary page framework in this phase.

Do not copy Memory business logic into Diary blindly.

## 13. Styling

Mobile Diary should reuse the visual measurements and accepted interaction language established by Memory wherever appropriate:

- page heading hierarchy;
- toolbar density;
- tool touch targets;
- month labels;
- month cards;
- row spacing;
- row dividers;
- title/meta typography;
- paper geometry;
- paper-native form appearance;
- action-control typography;
- loading skeleton rhythm.

Diary-specific CSS should be narrowly scoped so desktop remains unchanged.

## 14. Testing strategy

Implementation must follow TDD for changed behavior.

Tests should cover, at minimum:

### Header and tools

- title and true-count subtitle;
- exact tool order:
  - Date;
  - Mood;
  - Tag;
  - Search;
  - Archive;
  - Create;
- calendar icon contract;
- neutral-mood icon contract;
- Memory-compatible Search/Archive/Pen visual usage.

### Filtering

- date-from and date-to;
- mood;
- tag;
- full-text `q`;
- combined filters;
- URL serialization/parsing;
- browser history restoration;
- request parameter mapping.

### True count

- active count exceeds returned result limit correctly;
- filtered count is true matching count;
- archived count is true archived count;
- list limit does not cap metadata count.

### List presentation

- grouping uses `diary.date`;
- month order;
- title first line;
- date left meta;
- mood/tag right meta;
- missing optional metadata formatting;
- active and Archive list parity.

### Paper interactions

- detail date uses Diary date;
- Create defaults date to today;
- Edit can change date from the paper top-left;
- Create can change date from the paper top-left;
- mood remains free text;
- tags remain editable;
- title/content remain editable;
- View/Edit/Create paper coordinates remain identical;
- paper editors remain visually borderless.

### Lifecycle/navigation

- archive;
- Archive open;
- `Return`;
- archived detail;
- restore;
- exact return URL;
- active list scroll restoration;
- archived list scroll restoration;
- browser Back/Forward;
- unsaved-change protection.

### Regression gates

Run all relevant Diary tests, including API/service/repository and existing Diary navigation/filter tests, plus:

- Web TypeScript typecheck;
- `git diff --check`.

## 15. Acceptance criteria

The redesign is accepted when:

1. Diary visibly belongs to the same mobile UI family as Memory.
2. Header order is exactly Date / Mood / Tag / Search / Archive / Create.
3. Diary and Archive subtitles show true matching counts.
4. Full-text search remains available.
5. Date range, mood, tag, and search filters remain URL-backed.
6. List grouping uses Diary dates.
7. Diary rows use the same two-line hierarchy as Memory.
8. Detail, Edit, and Create use the same paper geometry.
9. New Diary date defaults to today and can be changed.
10. Existing Diary date can be changed by interacting with the paper's top-left date while editing.
11. Mood is free text, not an enum.
12. Bottom-left paper metadata contains Mood and Tags.
13. Archive exposes only Return at page level.
14. Archived details are read-only and restorable.
15. Navigation, history, scroll restoration, and unsaved-change behavior remain correct.
16. Desktop behavior is unchanged.
17. No DB migration or MCP Diary contract change is introduced.
18. Relevant tests, Web typecheck, and diff-check pass.
