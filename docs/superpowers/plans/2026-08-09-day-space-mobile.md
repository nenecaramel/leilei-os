# Day Space Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved mobile-only Day Space visual/product prototype on top of `40c50c2364a16881f74a041134efeb27afa17c38`, activate its route/navigation, reuse the existing paper editor language for editing presentation data, and remove the remaining legacy large-card connection/empty states from mobile Memory / Diary / Task list surfaces.

**Architecture:** Keep Day Space isolated as a presentation-first feature. Pure helpers own date routing and deterministic scatter layout; a small fixture/view-model layer supplies signed Todo/Diary prototype data without pretending that the current Diary API has L/G authorship; the page composes date navigation, date picker, paper stage, and existing paper-dialog/editor primitives. Todo remains the existing date-scoped L/G paper model and is never derived from Task. Mobile list-state cleanup uses one shared lightweight state component rather than changing the legacy desktop `.memory-message` contract globally.

**Tech Stack:** React 18, TypeScript, React Router, existing Leilei OS CSS, JSDOM/Node test runner via `pnpm exec tsx --test`, existing `PaperDetailDialog`, `TodoPaperDialog`, `DiaryPaperEditor`, browser `localStorage` for prototype Todo paper edits.

## Global Constraints

- Work only on `leilei/day-space-2026-08-09`, starting from design-doc commit `e675d5001c148c36535b7c579120b42b302f4030`.
- Mobile is the acceptance target. Do not introduce a desktop-specific Day Space design.
- Do not add production Todo persistence, Calendar marker semantics/backend, MCP capabilities, or L/G schema migrations in this pass.
- Do not derive Todo from Task.
- Do not infer/guess L/G authorship for real Diary API records. Signed Diary content in this pass is explicitly presentation fixture/view-model data only.
- Day Space has no create control or create CTA.
- Preserve the accepted Memory / Diary / Task filtered-empty `清除条件` behavior and 96px spacing.
- Do not globally restyle `.memory-message`; desktop and detail/editor usages still depend on it. Replace only the mobile list/archive call sites named in this plan.
- Do not modify System or unrelated MCP/backend branches.
- Preview helper scripts/files are untracked-only and must never be committed.
- Do not force-push.
- Implementation changes remain uncommitted until mobile visual acceptance. After acceptance, make one focused implementation commit unless the user explicitly requests another split.
- macOS Bash 3.2 compatibility: no `mapfile`; use `while IFS= read -r ...` when collecting tests.

---

## File Map

### Create

- `web/src/pages/day-space-location.ts` — date parsing/formatting, explicit-date route helpers, one-day shift, latest-date resolution.
- `web/src/pages/day-space-layout.ts` — deterministic seed/hash and controlled-scatter layout calculator.
- `web/src/pages/day-space-prototype-data.ts` — presentation-only signed Diary/Todo fixture view models and fixture-date lookup.
- `web/src/pages/DaySpaceDatePicker.tsx` — compact anchored month picker.
- `web/src/pages/DaySpaceDiaryDialog.tsx` — local presentation-fixture Diary editor using existing paper primitives; no API write.
- `web/src/pages/DaySpacePage.tsx` — page orchestration, selected-date state, stage, Todo/Diary paper opening/editing.
- `web/src/pages/MobileListState.tsx` — shared lightweight mobile empty/error/retry state.
- `tests/day-space-location.test.ts`
- `tests/day-space-layout.test.ts`
- `tests/day-space-mobile-page.test.ts`
- `tests/mobile-list-state-theme.test.ts`

### Modify

- `web/src/pages/todo-paper-storage.ts` — add safe enumeration of persisted Todo-paper business dates without changing current read/write semantics.
- `web/src/App.tsx` — add `/day-space` route.
- `web/src/layout/NavigationGroups.tsx` — turn Day Space from disabled `soon` into a real `/day-space` navigation item.
- `web/src/pages/MemoryPage.tsx` — lightweight mobile active/archive list error state and Memory archive empty state.
- `web/src/pages/DiaryPage.tsx` — lightweight mobile active/archive list error state only; preserve existing mobile empty states.
- `web/src/pages/TaskPage.tsx` — lightweight mobile active/archive list error state only; preserve existing mobile empty states.
- `web/src/styles.css` — Day Space mobile layout/date picker/papers plus shared mobile list-state styles.
- `tests/app-shell-mobile.test.ts` — update stale expectation that Day Space is disabled.
- Existing focused mobile tests only when a legitimate structural expectation changes; do not weaken unrelated assertions.

### Reuse unchanged

- `web/src/pages/TodoPaperDialog.tsx`
- `web/src/pages/TodoPaperEditor.tsx`
- `web/src/pages/DiaryPaperEditor.tsx`
- `web/src/pages/PaperDetailDialog.tsx`
- `web/src/pages/home-prototype-data.ts` types (`HomeAuthor`, `HomeNote`, `HomeNoteKind`) where useful.

---

## Task 1: Lock Date Routing and Persisted Todo-Date Discovery

**Files:** `tests/day-space-location.test.ts`, `tests/todo-paper-storage.test.ts`, `web/src/pages/day-space-location.ts`, `web/src/pages/todo-paper-storage.ts`

- [ ] Add failing tests in `tests/day-space-location.test.ts` for:
  - valid `?date=2026-08-05` -> exact business date;
  - invalid/missing date -> no explicit date, so default resolution is allowed;
  - `shiftBusinessDate("2026-08-05", -1)` -> `2026-08-04` and `+1` -> `2026-08-06`, including month/year boundaries;
  - `resolveLatestBusinessDate()` returns the maximum supplied content date and falls back to the supplied today value only when no content dates exist;
  - route builder emits `/day-space?date=YYYY-MM-DD` for explicit selections.
- [ ] Extend `tests/todo-paper-storage.test.ts` with RED coverage for enumerating only valid persisted Todo-paper keys and returning only dates whose normalized L or G paper actually contains content. Ignore malformed JSON, invalid dates, unrelated localStorage keys, and explicitly saved empty papers.
- [ ] Run RED:

```bash
pnpm exec tsx --test tests/day-space-location.test.ts tests/todo-paper-storage.test.ts
```

Expected: new imports/assertions fail because helpers do not yet exist.

- [ ] Implement `day-space-location.ts` as pure string/date helpers. Parse business dates in local calendar semantics rather than UTC-shifting them through `new Date("YYYY-MM-DD")`.
- [ ] In `todo-paper-storage.ts`, export a focused enumeration helper that scans keys matching the existing `leilei.home.todo-paper.v1:YYYY-MM-DD:L|G` shape, reuses validation/normalization, and returns unique non-empty business dates. Do not alter `readTodoPaperEntries()` fallback behavior used by Home.
- [ ] Run GREEN:

```bash
pnpm exec tsx --test tests/day-space-location.test.ts tests/todo-paper-storage.test.ts
```

- [ ] Run `git diff --check` and inspect the diff. Do not commit yet.

## Task 2: Build and Prove Deterministic Controlled Scatter

**Files:** `tests/day-space-layout.test.ts`, `web/src/pages/day-space-layout.ts`

- [ ] Add RED tests for a pure `layoutDaySpacePapers(dateKey, papers, stageWidth)` helper. Assert:
  - identical date + identities + stage width returns deep-equal positions every time;
  - changing the date changes at least one paper's x/y/rotation/size choice;
  - every paper stays within the mobile stage horizontal bounds;
  - rotations stay inside the approved approximately `-4deg..4deg` envelope;
  - size is one of controlled small/medium/large presets;
  - later papers move downward enough that any overlap is edge-only and below the accepted maximum occlusion threshold;
  - z-index is deterministic;
  - returned stage height contains the final paper and grows for more papers.
- [ ] Run RED:

```bash
pnpm exec tsx --test tests/day-space-layout.test.ts
```

- [ ] Implement a deterministic string hash/PRNG internal to `day-space-layout.ts`; no `Math.random()` in layout calculation.
- [ ] Model each paper with identity, content-density/minimum-size hint, and stable output `{ x, y, width, height, rotation, zIndex, size }`.
- [ ] Use invisible vertical landing bands plus left/center/right bias, then collision correction. Prefer no overlap; permit only edge overlap capped at 15% of the smaller paper area. If a candidate exceeds the cap, nudge sideways within bounds and then downward until valid.
- [ ] Keep spacing deliberately irregular so output cannot collapse into a two-column masonry grid.
- [ ] Run GREEN:

```bash
pnpm exec tsx --test tests/day-space-layout.test.ts
```

- [ ] Run `git diff --check`. Do not commit yet.

## Task 3: Add Presentation-Only Day Space Data Model

**Files:** `web/src/pages/day-space-prototype-data.ts`, `tests/day-space-mobile-page.test.ts`

- [ ] Start `tests/day-space-mobile-page.test.ts` with RED structural assertions that the Day Space prototype data exports explicit business dates and signed `L | G` Diary view models, and that it never imports/aliases Task data.
- [ ] Define a Day Space paper union roughly equivalent to:
  - Todo paper: author, date, whole `HomeNote[]`, identity `todo:L:date` / `todo:G:date`.
  - Diary paper: fixture id, author, date, title, content, identity `diary:<id>`.
- [ ] Keep fixture dates explicit and finite so empty-day behavior is testable. Include one visually rich date such as `2026-08-05` and at least one other date so stable-different-date layout can be inspected.
- [ ] Do not import real `DiaryPage` response types or fabricate an author onto API responses. Add an explanatory code comment at the fixture boundary: this layer is deleted/replaced when L/G authorship lands in real persistence.
- [ ] Run focused RED/GREEN as the fixture module is introduced:

```bash
pnpm exec tsx --test tests/day-space-mobile-page.test.ts
```

- [ ] Do not commit yet.

## Task 4: Build the Date Picker as an Isolated Mobile Component

**Files:** `web/src/pages/DaySpaceDatePicker.tsx`, `tests/day-space-mobile-page.test.ts`, `web/src/styles.css`

- [ ] Add RED assertions for a compact month picker with:
  - month label and prev/next month controls;
  - 7 weekday columns and complete month grid;
  - `aria-current="date"` or equivalent light marker for today only when not selected;
  - stronger selected-date state;
  - selected=today uses only selected styling;
  - selecting a day calls back with `YYYY-MM-DD`;
  - no content-marker dots/counts/classes.
- [ ] Run RED:

```bash
pnpm exec tsx --test tests/day-space-mobile-page.test.ts
```

- [ ] Implement the picker with native buttons, no external calendar package. Month cells may include outside-month days only if clicking them yields the correct explicit date.
- [ ] Style the popover as a small white neutral surface anchored beneath the date text; fine border, subtle shadow, no full-screen takeover.
- [ ] Run GREEN and `git diff --check`. Do not commit yet.

## Task 5: Build Day Space Page Shell, Date Navigation, and Paper Stage

**Files:** `web/src/pages/DaySpacePage.tsx`, `tests/day-space-mobile-page.test.ts`, `web/src/styles.css`

- [ ] Expand RED page tests to assert:
  - left-aligned `Day Space` title;
  - no subtitle/count/add/create button;
  - centered previous/date/next row;
  - center date opens the picker;
  - previous/next creates the exact adjacent explicit-date location;
  - an explicit route date is never replaced by the latest date;
  - no explicit date resolves through latest visible prototype/persisted content date and falls back to today only when none exist;
  - empty date renders only `这一天还没有内容` in the stage, no icon/card/create CTA;
  - mixed Todo/Diary paper buttons exist together without type sections;
  - empty Todo papers are omitted;
  - paper signatures are `L`/`G` at bottom right;
  - paper style values come from `layoutDaySpacePapers()` and are stable across a rerender.
- [ ] Run RED:

```bash
pnpm exec tsx --test tests/day-space-mobile-page.test.ts tests/day-space-layout.test.ts tests/day-space-location.test.ts
```

- [ ] Implement `DaySpacePage` around `useLocation()`/`useNavigate()` so explicit selection is reflected in `?date=` and browser history remains understandable.
- [ ] Read Todo papers for the selected date with date-specific presentation seeds only. Persisted localStorage values override those seeds through the existing storage contract. Do not cause the Home fixtures to appear on every arbitrary date.
- [ ] Combine non-empty L/G Todo whole-paper view models with Diary fixture view models, feed stable identities to the layout helper, and render absolutely positioned paper buttons inside a relatively positioned vertical stage.
- [ ] Paper preview rules:
  - Todo: type label + leading entries; preserve completed/pending visual distinction only if it already fits the accepted paper language.
  - Diary: type label + title + limited content lines.
  - all: bottom-right signature, clipped/faded overflow, no full-content-driven infinite height.
- [ ] Use an element ref from the tapped paper as `triggerRef` so dialog close restores focus.
- [ ] Add a lightweight stage loading class now even though fixture/local reads are synchronous; structure it so later real-data wiring can switch between loading/ready/empty/error without changing the page shell.
- [ ] Run GREEN and `git diff --check`. Do not commit yet.

## Task 6: Reuse Existing Todo Editor and Add Safe Fixture Diary Editing

**Files:** `web/src/pages/DaySpacePage.tsx`, `web/src/pages/DaySpaceDiaryDialog.tsx`, `tests/day-space-mobile-page.test.ts`

- [ ] Add RED interaction tests:
  - clicking an L/G Todo paper opens the existing `TodoPaperDialog` for that exact author/date;
  - closing/saving a Todo paper updates its preview without changing the selected route date;
  - clicking a Diary fixture opens a `PaperDetailDialog` using `DiaryPaperEditor`;
  - Diary fixture edits update only local Day Space presentation state and perform no `api.request()`/production write;
  - closing any paper does not introduce a create action;
  - unrelated paper identities/layout coordinates remain stable after an edit.
- [ ] Run RED:

```bash
pnpm exec tsx --test tests/day-space-mobile-page.test.ts tests/todo-paper-dialog.test.ts
```

- [ ] Wire Todo editing by reusing `TodoPaperDialog` exactly; use existing normalization/storage behavior.
- [ ] Implement `DaySpaceDiaryDialog` as an explicitly temporary presentation editor: `PaperDetailDialog` + `DiaryPaperEditor`, static selected business-date label, signed fixture author, local `onSaved` callback. Do not call the Diary API and do not mutate real Diary storage.
- [ ] Keep date and scroll state on close. Updating preview text must not change paper identity or seed.
- [ ] Run GREEN and `git diff --check`. Do not commit yet.

## Task 7: Activate Route and Navigation Entry

**Files:** `web/src/App.tsx`, `web/src/layout/NavigationGroups.tsx`, `tests/app-shell-mobile.test.ts`, `tests/day-space-mobile-page.test.ts`

- [ ] Change the existing stale app-shell test from “disabled Day Space” to expect `a[href="/day-space"]` and no `aria-disabled` Day Space button.
- [ ] Add/extend structural route coverage to assert `App.tsx` imports and registers `DaySpacePage` at `path="day-space"`.
- [ ] Run RED:

```bash
pnpm exec tsx --test tests/app-shell-mobile.test.ts tests/day-space-mobile-page.test.ts
```

- [ ] Add `<Route path="day-space" element={<DaySpacePage />} />`.
- [ ] Change NavigationGroups entry to `{ label: "Day Space", to: "/day-space", icon: DashboardIcon }` with no `disabled` and no `soon` badge.
- [ ] Run GREEN. Verify the mobile drawer still closes via `onNavigate` for the newly active item.
- [ ] Run `git diff --check`. Do not commit yet.

## Task 8: Replace Remaining Mobile List Legacy State Cards

**Files:** `web/src/pages/MobileListState.tsx`, `web/src/pages/MemoryPage.tsx`, `web/src/pages/DiaryPage.tsx`, `web/src/pages/TaskPage.tsx`, `web/src/styles.css`, `tests/mobile-list-state-theme.test.ts`

- [ ] Create RED tests that inspect/render the mobile branches and prove:
  - Memory active-list error no longer uses `MemoryMessage`/`.memory-message`/placeholder icon;
  - Diary active-list error no longer uses `DiaryMessage`/`.memory-message`/placeholder icon;
  - Task active-list error no longer uses `TaskMessage`/`.memory-message`/placeholder icon;
  - Memory/Diary/Task mobile archive-list error uses the same lightweight state;
  - Memory mobile archive empty uses lightweight state;
  - Diary/Task existing mobile empty states remain `.memory-empty-state` and are not regressed;
  - the new shared state CSS has no border/background/shadow/min-height card treatment;
  - retry is a plain-text control, not a legacy `.secondary-button` card;
  - `memory-empty-clear` and its `96px` filtered-empty rule remain present unchanged.
- [ ] Run RED:

```bash
pnpm exec tsx --test tests/mobile-list-state-theme.test.ts tests/mobile-empty-clear-parity.test.ts tests/filtered-empty-mobile-spacing.test.ts
```

- [ ] Implement `MobileListState` with a simple message paragraph and optional text-action button. Use muted 14px current-theme typography and no placeholder icon.
- [ ] Replace only the identified **mobile list/archive** call sites. Leave desktop `MemoryMessage`/`DiaryMessage`/`TaskMessage`, create forms, detail errors, and paper dialogs unchanged.
- [ ] For Memory mobile archive empty, use the same lightweight empty-state language instead of `MemoryMessage`.
- [ ] Run GREEN, then existing module visual regression tests:

```bash
pnpm exec tsx --test \
  tests/mobile-list-state-theme.test.ts \
  tests/mobile-empty-clear-parity.test.ts \
  tests/filtered-empty-mobile-spacing.test.ts \
  tests/memory-visual-acceptance.test.ts \
  tests/diary-mobile-page.test.ts \
  tests/task-mobile-redesign.test.ts \
  tests/task-mobile-visual-polish.test.ts
```

- [ ] Run `git diff --check`. Do not commit yet.

## Task 9: Mobile Visual Acceptance Preview

**Files:** working tree only; optional untracked preview helper under `/tmp` or another explicitly untracked path.

- [ ] Run focused Day Space + mobile-state tests first:

```bash
pnpm exec tsx --test \
  tests/day-space-location.test.ts \
  tests/day-space-layout.test.ts \
  tests/day-space-mobile-page.test.ts \
  tests/mobile-list-state-theme.test.ts \
  tests/app-shell-mobile.test.ts \
  tests/mobile-empty-clear-parity.test.ts \
  tests/filtered-empty-mobile-spacing.test.ts
```

- [ ] Run web checks:

```bash
pnpm --dir web typecheck
pnpm --dir web build
```

- [ ] Start a mobile-accessible preview without committing helper files. Open/check at minimum:
  - `/day-space?date=2026-08-05` rich paper layout;
  - same date after refresh: identical layout;
  - another seeded date: visibly different stable layout;
  - an empty date: `这一天还没有内容` only;
  - date picker open, today/selected states;
  - L Todo editor, G Todo editor, Diary fixture editor;
  - mobile Memory/Diary/Task connection-error states if the preview harness can safely force them without production changes.
- [ ] Ask for user visual acceptance. Accumulate visual corrections into one follow-up patch when feasible.
- [ ] Do **not** commit implementation until this visual acceptance is explicit.

## Task 10: Final Regression, Scope Audit, and Accepted Commit

**Files:** all changed implementation/test files after visual acceptance.

- [ ] Run the complete serial test suite with Bash-3-safe collection:

```bash
TESTS=()
while IFS= read -r test_file; do
  TESTS+=("$test_file")
done < <(find tests -type f -name '*.test.ts' | sort)
pnpm exec tsx --test --test-concurrency=1 "${TESTS[@]}"
```

- [ ] Run final gates:

```bash
pnpm typecheck
pnpm build
pnpm --dir web typecheck
pnpm --dir web build
git diff --check
git status --short
```

- [ ] Scope audit before staging:
  - no preview helper files;
  - no backend/MCP/System files;
  - no Task-as-Todo mapping;
  - no real Diary author inference or Diary API write from Day Space;
  - no Calendar marker/backend logic;
  - no Day Space create control;
  - no weakening/removal of filtered-empty 96px regression coverage.
- [ ] Stage only accepted implementation/tests plus the already approved docs if needed.
- [ ] Commit once after acceptance, suggested subject:

```bash
git add web/src/App.tsx web/src/layout/NavigationGroups.tsx \
  web/src/pages/day-space-location.ts \
  web/src/pages/day-space-layout.ts \
  web/src/pages/day-space-prototype-data.ts \
  web/src/pages/DaySpaceDatePicker.tsx \
  web/src/pages/DaySpaceDiaryDialog.tsx \
  web/src/pages/DaySpacePage.tsx \
  web/src/pages/MobileListState.tsx \
  web/src/pages/todo-paper-storage.ts \
  web/src/pages/MemoryPage.tsx web/src/pages/DiaryPage.tsx web/src/pages/TaskPage.tsx \
  web/src/styles.css \
  tests/day-space-location.test.ts tests/day-space-layout.test.ts \
  tests/day-space-mobile-page.test.ts tests/mobile-list-state-theme.test.ts \
  tests/app-shell-mobile.test.ts tests/todo-paper-storage.test.ts
git commit -m "feat: add mobile Day Space"
```

- [ ] Push normally to `leilei/day-space-2026-08-09`; never force-push.

## Spec Coverage Self-Review

- Day Space is mobile-only, view/edit only, and has no create path: covered Tasks 5–7.
- Center date picker, previous/next day, explicit route dates, latest-content default, and today fallback: covered Tasks 1, 4, 5.
- L/G whole Todo papers, one paper per signed Diary fixture, no empty Todo paper, no Task derivation: covered Tasks 3, 5, 6.
- Deterministic daily scattered layout with controlled size/rotation/overlap and vertical stage: covered Task 2 and visually verified Task 9.
- Existing editor/dialog visual language reused; real Diary authorship/write is not fabricated: covered Task 6 and Global Constraints.
- Empty/loading/error Day Space states remain cardless/lightweight: covered Task 5 and Task 9.
- Memory / Diary / Task mobile connection/archive errors and Memory archive empty leave the legacy large-card system without globally breaking desktop/detail states: covered Task 8.
- Existing filtered-empty visual contract remains intact: covered Task 8 and final scope audit.
- Calendar backend/markers, production Todo persistence, L/G migration, MCP, System, desktop-specific Day Space remain out of scope: Global Constraints and final scope audit.
- No `TBD`, placeholder requirement, unresolved author inference, or ambiguous persistence promise remains in this plan.