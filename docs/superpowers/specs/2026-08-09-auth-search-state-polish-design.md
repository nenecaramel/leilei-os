# Auth and Search State Polish Design

**Date:** 2026-08-09

## Goal

Finish three visual defects before Day Space work:

1. Put the production login composition lower on mobile.
2. Make the post-login authentication loading spinner neutral gray instead of green.
3. Move search/filter empty-result messaging far enough down that header popovers do not cover it.

## Scope

### Auth login position

The stylesheet currently contains conflicting `.auth-minimal` transforms: an accepted `68px` rule and a later stale `-26px` override. The later rule can win in the cascade.

The fix must:

- remove the stale conflicting transform;
- leave exactly one authoritative login composition transform;
- set the final transform to `translateY(100px)`;
- keep the existing title size and default login action styling unchanged;
- add a regression contract that rejects any second conflicting `.auth-minimal` transform.

No visual preview is required for this change.

### Auth loading spinner

`ProtectedApp` keeps using the existing `.loading-orb` markup and animation.

Only the rotating accent segment changes:

- current green accent: `var(--green)`;
- final accent: `#8a8a8a`.

Spinner dimensions, border width, animation, white auth surface, and accessibility label remain unchanged.

### Filtered/search empty states

On mobile, reserve a 96px top gap for filtered/search result-state copy that can otherwise sit behind open header controls.

Memory / Diary / Task:

- only a filtered-empty state moves down;
- the filtered-empty state is the state that exposes `.memory-empty-clear`;
- `没有匹配的记忆` / `没有符合条件的日记` / `没有符合条件的任务` and their clear action move together;
- ordinary first-use empty states such as `还没有记忆`, `还没有日记`, `还没有任务`, and archive-empty states do not move.

Global Search:

- the visible `global-search-state-line` result states use a 96px mobile top margin for empty/error result messaging;
- the search controls and result cards do not move;
- Quick Search is explicitly out of scope.

## Implementation approach

Prefer shared CSS rather than page-by-page offsets.

- Use the existing `.memory-empty-state` shared structure and target filtered-empty states by the presence of `.memory-empty-clear`.
- Keep ordinary empty-state layout unchanged.
- Adjust the mobile `.global-search-state-line` spacing at the shared style rule.
- Consolidate auth positioning so there is no later cascade override.

## Testing

Add or update regression tests that prove:

- the effective auth transform contract is `100px` and no stale `-26px` transform remains;
- `.loading-orb` no longer uses `var(--green)` for `border-top-color` and uses `#8a8a8a`;
- filtered Memory / Diary / Task empty states receive the 96px mobile spacing while ordinary empty states do not;
- Global Search mobile state spacing is 96px;
- Quick Search state spacing is unchanged.

Then run:

- focused regression tests;
- deterministic serial full Node test suite;
- root typecheck;
- root build;
- web typecheck;
- web build;
- `git diff --check`.

## Git / preview constraints

- Base branch: `codex/phase-6-web-ui-foundation`.
- Expected base before this hotfix: `87297c238254721f1dc3d978bf0084ed273a6ca2`.
- Feature branch: `leilei/auth-search-ui-polish-2026-08-09`.
- No preview helpers.
- No backend changes.
- No Day Space changes.
- No force push.
