# Global Mobile Top Bar Design

## Goal

Unify the mobile top bar across every routed page using the already-approved Home top bar as the global standard.

This batch changes only the mobile App Shell. Desktop layout and page bodies are out of scope.

## Current Architecture

All routed pages already share `MobileTopBar` through `AppShell`.

The visual difference exists because Home receives a second set of CSS rules scoped through `body:has(.home-prototype)`. Those rules override the older global mobile top-bar styling.

Therefore this change does not require per-page JSX changes.

## Chosen Approach

Promote the approved Home mobile-top-bar styles into the global `.mobile-top-bar` rules.

Remove the Home-only top-bar overrides after their values have become the global standard.

Do not introduce page-specific classes, routing state, or a second top-bar component.

## Global Mobile Standard

On mobile:

- top bar height: `44px + safe-area-inset-top`
- background: pure white
- no bottom border
- no blur/backdrop treatment
- Apple system font stack
- centered `Leilei OS`
- title: 20px, medium weight
- left control: existing menu button
- right control: existing Global Search link
- menu and search hit areas remain 44 × 44px
- menu icon uses the approved Home geometry
- search icon uses the approved Home geometry
- left/right positions match the approved Home top bar

Navigation behavior remains unchanged.

## Scope

Affected mobile routes include Home, Memory, Diary, Task, Global Search, Settings / General, Universe, and Chat Archive because they already render through the shared App Shell.

No page-body redesign is included.

Desktop Sidebar and desktop page layout remain unchanged.

## Testing

Use TDD.

First change/add tests so they require the approved geometry on the global mobile-top-bar selectors rather than Home-only selectors. Confirm RED against the current implementation.

Then make the minimum CSS change and confirm GREEN.

Verification for this batch:

- relevant mobile shell / Home tests
- `npm --prefix web run typecheck`
- `git diff --check`
- `git status --short`

The local preview helpers `web/preview.html` and `web/src/preview-main.tsx` must remain untracked and must not be committed.

## Acceptance Criteria

Every mobile route displays the same top bar appearance currently approved on Home.

Home must not depend on a special top-bar override afterward.

Menu and Global Search behavior must remain unchanged.

Desktop behavior must remain unchanged.

Memory implementation does not begin until this batch is separately verified and accepted.
