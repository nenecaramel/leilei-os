# Home Closure Cleanup Design

## Goal

Close the current Home bridge without adding product behavior or changing accepted visuals. Remove the remaining runtime prototype/compatibility debt that is no longer needed after Todo, Day Space, and Calendar moved to real server data.

## Product behavior

- Home Records behavior stays exactly as accepted: Memory / Diary / Task use their existing quick-create navigation; Universe remains a normal module link.
- Todo L/G papers, Calendar markers, month navigation, Day Space links, loading/error behavior, and visual layout do not change.
- No new API, schema, migration, persistence, MCP, PWA, or production configuration change.

## Cleanup scope

1. Replace Home-only prototype note types with the canonical Todo types already used by the server contract.
   - `TodayPanel` consumes `TodoAuthor` and `TodoEntry`.
   - `DashboardPage` passes `paper.entries` directly and no longer projects them into a `HomeNote` carrying a duplicate `author` field.
2. Remove `web/src/pages/home-prototype-data.ts` after its runtime type dependency is gone.
   - The old L/G fixture collections are test data only and must not survive as runtime source data.
   - Tests that need sample Todo entries define them locally using the canonical Todo entry shape.
3. Remove the deprecated `entries` and `storage` compatibility props from `TodoPaperDialog`.
   - `paper?.entries ?? []` is the only editor initialization source.
   - Current real callers already provide `paper` when editing an existing paper and rely on an empty list for a missing paper.
   - Dialog tests use a real `TodoPaper` value instead of legacy entries/localStorage fallbacks.
4. Do not redesign, rename CSS classes for cosmetic cleanliness, or delete unrelated legacy helpers merely because their names contain `dashboard`, `prototype`, or `compatibility`.

## Safety boundaries

- Feature branch starts from accepted production baseline `3cb99f12b69cf2b555261ae835f2702a38726dc7`.
- `web/preview.html` and `web/src/preview-main.tsx` remain untracked and must not be committed.
- No force push, baseline merge, deployment, or production action during implementation/verification.
- `dashboard-tasks.ts` and its dedicated tests remain outside this cleanup because the current Home runtime does not depend on them and deleting unrelated historical logic provides no product value.

## Verification

Focused tests must cover Home rendering/quick-create, Todo dialog server-paper initialization/save behavior, date rollover, Calendar real-data wiring, and Day Space Todo editing. Then run the deterministic full Node suite, root/web typecheck and builds, and `git diff --check`. No database gate is required because this package changes no database code.