# Web UI State Consistency — Implementation Plan

## Goal

Implement the approved Web UI state-consistency design exactly as frozen in:

`docs/superpowers/specs/2026-08-20-web-ui-state-consistency-design.md`

This plan changes Web frontend behavior, presentation, and tests only. No backend/API/domain/database changes. No deploy or merge in this implementation task.

## Baseline and branch discipline

- Required `origin/main` baseline: `23ad1c66bb94428da313602d7a6a7cea529fb7ad`.
- Before implementation, `git fetch origin` and verify `origin/main` is still exactly that SHA.
- If `origin/main` moved, STOP and report the new SHA. Do not rebase, reinterpret the design, or continue on a different baseline without approval.
- Create `feature/web-ui-state-consistency` from `origin/main`.
- Do not implement on `docs/web-ui-state-consistency-design`; that branch is reference-only.
- No force push. No unrelated cleanup/refactors.

## Frozen implementation rules

- The approved design spec is authoritative for copy, offsets, typography, colors, spacing, breakpoints, overflow, loading/error behavior, retry behavior, accessibility, and pending states.
- Do not invent a new global state component/design system unless a tiny local helper is required to remove exact duplication without changing behavior.
- Mobile state rules apply at `<=760px`; Desktop/Tablet at `>=761px`. Do not add a third state breakpoint.
- All page/module state messages covered by the spec are horizontally centered. Normal list/body content remains unchanged.
- Preserve module-specific visual language where the spec says to preserve it.
- No global offline banner and no new `navigator.onLine` logic.
- Preserve current URL/query/filter/date/archive/detail context on retry; do not scroll or mutate history.
- Prevent stale request responses/errors from overwriting a newer request state.
- No new animation beyond existing list skeleton shimmer and existing Universe loading dots.

## Task 1 — Lock the state contracts with focused tests

**Files**
- Create: `tests/web-ui-state-consistency.test.ts`
- Modify existing behavioral tests only where the behavior is already owned there, especially:
  - `tests/diary-page.test.ts`
  - `tests/task-detail-view.test.ts`
  - existing Memory page/detail/presentation tests discovered in the repository

**Steps**
1. Add failing regression coverage before implementation for the frozen cross-module contracts.
2. Cover at minimum:
   - Memory/Diary/Task main true-empty, filtered-empty, read-error copy/action semantics.
   - Memory/Diary/Task Archive empty/error copy and no duplicate body Return.
   - Task mobile detail error has explanation + retry.
   - Task desktop detail error does not render blank.
   - Memory archived-detail error remains inside Paper.
   - permanent-delete warning text is absent; confirmation/pending controls remain.
   - row metadata protects the left date/deadline and truncates right metadata; Diary one-item metadata remains safe.
   - Paper read metadata cannot overlap signature; mood/tags truncate according to the frozen rules.
   - Paper mutation error reserves body space while visible.
   - Home Todo/Calendar loading/error state semantics.
   - Search, Day Space, Universe, and System state semantics that are explicitly changed by the design.
   - accessibility roles/`aria-busy`/skeleton hiding for the covered loading/error states.
3. Run the focused tests and confirm they fail for the intended pre-implementation reasons.

**Focused test command**

```bash
npx tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 \
  tests/web-ui-state-consistency.test.ts \
  tests/diary-page.test.ts \
  tests/task-detail-view.test.ts
```

If existing Memory tests are modified, append their exact paths to this command.

## Task 2 — Memory / Diary / Task main and Archive states

**Files**
- `web/src/pages/MemoryPage.tsx`
- `web/src/pages/DiaryPage.tsx`
- `web/src/pages/TaskPage.tsx`
- `web/src/styles.css`
- corresponding focused tests from Task 1

**Implement exactly**

### Mobile main
- True empty: content-start + `96px`; centered; one line only:
  - `还没有记忆`
  - `还没有日记`
  - `还没有任务`
- Filtered empty: preserve current `96px` position; centered:
  - `没有符合条件的记忆 / 日记 / 任务`
  - action `清除条件`
- Main read error at `96px`:
  - `暂时无法读取记忆 / 日记 / 任务`
  - `请稍后重试。`
  - `重新加载`
- Records mobile state inner width: `min(100%, 280px)`.
- Typography/gaps exactly as frozen in the design.
- Loading remains skeleton at the real list start, not the 96px state anchor.
- Unify skeleton geometry: top `4px`; label `72×12`; card min-height `126px`; card padding `15px 13px`; row gap `12px`; row height `34px`.

### Clear-condition semantics
- Memory clears `q + category + tag`.
- Diary clears all current query/date/mood/tag filters.
- Task clears all current list query/time/status filters.
- Stay in the current active/archive space.

### Mobile Archive
- Empty at Archive-header + `96px`; centered; one line:
  - `还没有归档记忆 / 日记 / 任务`
- No second-line explanation and no body Return.
- Loading uses the same list skeleton at the real list start.
- Error at Archive-header + `96px`:
  - `暂时无法读取归档记忆 / 日记 / 任务`
  - `请稍后重试。`
  - `重新加载`

### Desktop/Tablet Records
- Do not create a new surface.
- Keep each page’s existing background/border/radius/shadow.
- State content region `min-height:300px`; horizontal + vertical center.
- Title `29px / 500 / Newsreader`.
- Description `14px / muted / line-height 1.72 / max-width 480px`.
- Existing secondary button; frozen 12px/14px gaps.

### Non-blocking list mutation errors
- Keep real list visible.
- Place between tools/filters and list.
- `margin-top:8px; margin-bottom:12px`.
- Centered `12px / danger / 1.5`.
- Remove large generic `操作没有完成` presentation.

## Task 3 — Detail Paper state behavior and permanent-delete confirmation

**Files**
- `web/src/pages/MemoryPage.tsx`
- `web/src/pages/DiaryPage.tsx`
- `web/src/pages/TaskPage.tsx`
- `web/src/pages/TaskPaperEditor.tsx` only if needed by existing ownership
- `web/src/styles.css`
- relevant detail tests

**Implement exactly**

### Mobile Paper loading/error
- Once a detail is opened, loading/error/ready remain in the same Paper container.
- Loading state inside `.paper-detail-body`, body top + `96px`, centered:
  - `正在读取记忆… / 日记… / 任务…`
- Error at the same anchor:
  - `无法读取记忆 / 日记 / 任务`
  - `该记忆 / 日记 / 任务不存在、无权访问或暂时不可用。`
  - `重试`
- Archived detail uses the same structure with `归档{资源}` wording.
- Memory archived error must not fall back to page-level `MemoryMessage`.
- Task mobile must gain missing explanation + retry.
- Loading/error hides bottom metadata; keep only controls safe without loaded data.
- Preserve the existing Paper focus trap.

### Desktop detail
- Keep existing desktop surface; do not redesign it into mobile Paper.
- Detail status content `min-height:300px`, centered, using frozen desktop title/description/action hierarchy.
- Fix Task desktop detail error so it never renders blank and is retryable.

### Permanent delete
- Remove exact warning everywhere:
  `永久删除后无法恢复，确认继续吗？`
- Normal archived detail: `恢复 · 删除`.
- Confirmation: `取消 · 确认永久删除`.
- Pending: `取消 · 删除中…`; both controls disabled while pending.
- No modal, browser confirm, new red styling, or body warning.
- Keep existing Paper top-right geometry (`top:13px; right:24px; font-size:13px; line-height:20px`).
- Success: close detail and refresh Archive.
- Failure: return to confirmation labels, keep Paper open, show error in the frozen footer-error area.
- Do not change backend endpoints or permanent-delete domain behavior.

## Task 4 — Shared row metadata and Paper footer geometry

**Files**
- `web/src/styles.css`
- `web/src/pages/MemoryPage.tsx`
- `web/src/pages/DiaryPage.tsx`
- `web/src/pages/TaskPage.tsx`
- existing Paper metadata/editor components only where the current DOM ownership requires it
- focused CSS/presentation tests

**List row metadata**
- Generic M/D/T row metadata uses `display:flex; align-items:center; justify-content:space-between; gap:12px`.
- Left date/deadline: `flex:0 0 auto; min-width:max-content; overflow:visible; white-space:nowrap`.
- Right metadata: `flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:right`.
- Keep `12px / #8a8a8a / 1.3`.
- Handle Diary’s single-span case explicitly; do not let an only-child date become the flexible/truncated right field.
- Remove the Task-only shrink exception once the generic rule covers all three.
- Apply to active + Archive.

**Paper bottom metadata**
- Bottom-left: `left:24px; right:68px; bottom:14px; max-width:none`.
- Author signature stays `right:24px; bottom:11px; 20px / #858585 / Newsreader`.
- Metadata stays `13px / #6d6d6d / 20px`.
- Metadata container: hidden overflow, nowrap, `6px` separator gap.
- Memory category: complete/non-shrink.
- Task status: complete/non-shrink.
- Diary mood: non-shrink, `max-width:120px`, ellipsis if longer.
- Separator: non-shrink.
- Tags: consume remaining width and ellipsize.
- Active + archived read details use the rule.
- Preserve existing 16px-real-font + scale Safari no-zoom editor behavior and do not clip editor menus/popovers.

**Paper mutation error**
- `left:24px; right:24px; bottom:40px; min-height:18px; max-height:36px`.
- `12px / danger / 18px`, centered, at most two lines, overflow hidden.
- Normal Paper scroll bottom remains `38px`.
- While footer error is visible, scroll bottom becomes `82px`.
- Error clears on next same mutation, success, or leaving page/detail; not on scroll/popover.

## Task 5 — Home Todo / Calendar module read states

**Files**
- `web/src/pages/DashboardPage.tsx`
- `web/src/pages/TodayPanel.tsx`
- `web/src/pages/CalendarPreview.tsx`
- `web/src/styles.css`
- focused tests

**Common Home status line**
- Render after module heading and before module content.
- Heading→state `6px`; min-height `18px`; state→content `6px`.
- `width:100%`; centered; `12px / 400 / #8a8a8a / 1.3`.
- Inline Retry gap `6px`, color `#555`, transparent/no border.
- When no status exists, the line occupies zero space.

**Todo**
- Ready + empty: preserve the two empty papers/cards; no empty-message copy.
- Loading: `正在读取 Todo…`; hide both cards; section shrinks naturally.
- Error: `Todo 暂时无法读取。` + inline `重试`; hide both cards.
- Retry only Todo and preserve Home context.

**Calendar**
- Ready unchanged; no-data means no markers.
- Loading: `正在读取 Calendar…`; keep Calendar shell, hide markers, disable month navigation.
- Error: `Calendar 暂时无法读取。` + inline `重试`; keep shell, hide markers; remove existing card-internal error presentation.
- Preserve the intentional difference that Todo hides its content shell while Calendar keeps its shell.

## Task 6 — Global Search and Day Space

**Files**
- `web/src/pages/GlobalSearchPage.tsx`
- `web/src/pages/DaySpacePage.tsx`
- `web/src/styles.css`
- focused tests

**Global Search**
- Mobile idle/loading: controls + `14px`; centered; `13px / #8d8d8d / 1.55`.
- Mobile empty/error: preserve `96px`; centered; primary `13px / 500 / #777`; action `11px / 500 / #666`; vertical gap `10px`.
- Empty: `没有找到匹配内容` + `清除条件`.
- Error: `搜索暂时失败` + `重试`.
- Desktop idle/loading: controls + `28px`; same text style, centered.
- Desktop empty/error: controls + `64px`; inner `max-width:360px`; centered; same primary/action hierarchy.
- Load-more state stays result-list-specific and unchanged.
- Retry preserves query + filters; clear resets `DEFAULT_GLOBAL_SEARCH_FILTERS`.

**Day Space**
- Preserve Day Space’s own `94px` anchor.
- Loading/true-empty: stage `padding-top:94px`; centered `12px / #aaa`.
- Blocking discovery failure: central 94px state, `Day Space 暂时无法读取。` + retry.
- Both Todo + Diary failed: central 94px state, `当天内容暂时无法读取。` + retry.
- Partial failure/discovery-incomplete warning stays near date navigation: nav + `8px`; centered `11px / #8a / 1.4`; retry inline `6px` where applicable.
- Retry preserves current date and only retries the intended source(s).

## Task 7 — Universe and System states

**Files**
- `web/src/pages/UniversePage.tsx`
- `web/src/system/SystemConnectionsPageContent.tsx`
- `web/src/system/SystemActivityPageContent.tsx`
- `web/src/system/SystemDataPageContent.tsx`
- `web/src/styles.css`
- focused tests

**Universe**
- Preserve the Universe theme and graph/map behavior.
- Do not change `not-initialized`: it must continue to use the existing `UniverseImportFlow`.
- Loading/empty/fatal error state wrapper: `position:absolute; inset:0; display:grid; place-items:center`.
- Inner `max-width:360px`, centered.
- Cosmos min-height: desktop `560px`, mobile `480px`.
- Primary `14px / muted / 1.6`; existing Universe action; `12px` gap.
- Keep existing loading dots.
- Mutation notice remains header-local.

**System Connections / Activity / Data**
- Remote-read state area inside existing card:
  `padding:18px 13px; min-height:52px; display:grid; place-items:center; 12px / #8a8a8a / 1.3`.
- Error uses the same centered area; Retry top `12px` and existing System button (`min-height:35px; padding:6px 12px; radius:10px; 14px / 500`).
- Keep English.
- Activity empty remains `No activity yet.`.
- Connections whole-fetch failure is a page read error; a successfully loaded row whose service is unavailable remains a normal ready row.
- Do not touch Account or import/export/restore operation-specific states.

## Task 8 — Retry races, accessibility, and state transitions

**Files**
- page/component files changed in Tasks 2–7
- `tests/web-ui-state-consistency.test.ts`
- existing focused behavioral tests as needed

**Required behavior**
- Clicking Retry removes the error immediately and enters the module’s normal loading state:
  - list/Archive → skeleton
  - Paper → Paper loading state
  - Home/Search/Day Space/Universe/System → their frozen loading state
- Retry is absent/disabled while loading; no fourth “retrying” visual state.
- Preserve URL, filters, archive/active space, selected detail, search query, Day Space date, and module-local context.
- Use existing abort/request-generation mechanisms where present. Otherwise add the smallest page-local stale-request guard needed; do not introduce a new networking framework.
- Old response/error must never overwrite state from a newer request.
- Loading state: `role="status" aria-live="polite"`.
- Skeleton visuals: `aria-hidden="true"`; containing content `aria-busy="true"`; provide a visually-hidden loading message.
- Empty/filtered-empty: non-alert status semantics.
- Request failure: `role="alert"` without focus stealing.
- Retry/Clear are native `<button type="button">`.
- Preserve existing focus traps and keyboard behavior.

## Task 9 — Regression pass and deterministic gates

Run focused tests first until green, then all required gates.

```bash
# focused tests
npx tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 \
  tests/web-ui-state-consistency.test.ts \
  tests/diary-page.test.ts \
  tests/task-detail-view.test.ts

# complete repository test suite
npm test

# root type/build
npm run typecheck
npm run build

# Web type/build
npm --prefix web run typecheck
npm --prefix web run build

# whitespace/patch sanity
git diff --check
```

If additional existing focused tests were modified, run them explicitly before `npm test` and include their results in the PR report.

**Acceptance**
- All focused tests pass.
- Full `npm test` passes with zero failures.
- Root typecheck/build pass.
- Web typecheck/build pass.
- `git diff --check` passes.
- No backend/API/domain/database files changed.
- No design values/copy/behavior differ from the approved spec.

## Task 10 — Commit and open the implementation PR

- Keep logical commits; no unrelated changes.
- Before opening PR, inspect `git diff origin/main...HEAD` and changed-file list.
- Open PR from `feature/web-ui-state-consistency` to `main`.
- Do not merge and do not deploy.
- Final execution report must contain only:
  - branch
  - HEAD SHA
  - changed files
  - focused test results
  - full gate results
  - PR URL
  - unresolved items, if any

## Stop conditions

STOP and report instead of deciding independently if any of the following occurs:

1. `origin/main` is not `23ad1c66bb94428da313602d7a6a7cea529fb7ad` before branch creation.
2. Current code structure makes a frozen visual/interaction requirement impossible without changing backend/API/domain behavior.
3. The design spec and this implementation plan conflict.
4. A required copy, numeric value, breakpoint, pending state, or retry behavior is ambiguous.
5. A proposed change would require production DB access, deploy, merge, force push, or unrelated refactoring.

When a stop condition occurs, report the exact file/behavior conflict and wait for direction.