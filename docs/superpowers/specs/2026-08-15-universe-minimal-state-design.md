# Universe minimal loading and empty state

## Goal

Make the `/universe` loading and uninitialized states visually identical in restraint to the accepted Leilei OS mobile UI baseline.

## Visual contract

- Keep the existing shared mobile shell and the `Universe` title exactly where Memory / Diary titles sit, using the same shared header/title classes and typography.
- Page background is pure white.
- Below the title, the loading or uninitialized state contains no canvas frame, card, border, shadow, toolbar, controls, icons, dots, spinners, or decorative animation.
- Center a single gray status line in the remaining visible page area.
- Loading copy: `正在读取 Universe…`.
- Uninitialized copy: `Universe 还没有内容`.
- Status text uses the same neutral gray family as existing Leilei OS loading/status copy; no theme green or accent color.

## Scope

This change affects only the loading and uninitialized presentation for `/universe`. It does not alter the ready-state Universe canvas, node/relation behavior, editors, persistence, API contracts, migrations, Global Search, MCP, or any other route.

## Error state

Leave the existing real error behavior intact unless the same removed loading/empty frame is mechanically shared with it. Do not invent new controls or copy as part of this change.

## Acceptance

- On mobile, loading shows only the standard `Universe` title plus centered gray `正在读取 Universe…` on white.
- On mobile, uninitialized shows only the standard `Universe` title plus centered gray `Universe 还没有内容` on white.
- No loading/empty border or large rectangle remains.
- No animated dots or other animation remains.
- Existing ready-state Universe functionality is unchanged.
