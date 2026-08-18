# Universe Mobile Acceptance Round 2 Design

## Goal
Fix the five production-visible mobile issues reported after PR #140 without changing Universe data, API, repository, Global Search, MCP, Toy, or Phase 8.5 behavior.

## Scope
Mobile-only visual/interaction corrections for Day Space top bar and Universe create/edit/relation flows.

### 1. Day Space top bar
- Keep the shared `MobileTopBar` sticky at the top, matching Memory.
- Surface must be opaque white with no gray divider.
- Its stacking context must sit above Day Space date controls and papers so scrolling content passes underneath the white bar instead of painting over it.
- Do not change Memory, Diary, Task, Search, or desktop top bars.

### 2. Universe action-page footers
For `连接另一个思想`, `调整这颗星球`, and `点亮一颗新星`:
- Use the detail page footer as the single visual reference.
- Match left/right horizontal inset, bottom offset, text size, text weight, line-height, and muted text color.
- Remove legacy connection/editor footer spacing rules that shift those actions away from the detail footer geometry.
- Preserve each action's existing behavior and disabled state.

### 3. Restore the add-planet placement popover
- Clicking the Universe homepage add button must again show the placement popover and its instructional copy.
- Revert the prior treatment that turned `.universe-placement-popover` into a transparent transient status.
- Keep it as a real visible popover surface.
- The popover must not be clipped by the toolbar, page, map, or viewport. It must stay within the mobile viewport with a safe horizontal inset; near an edge, it shifts inward rather than overflowing off-screen.
- Do not convert this placement instruction into a three-second notice.

### 4. Three-second notice centering
- Mutation notices that intentionally disappear after three seconds remain transient.
- Center them against the mobile viewport, not against the Universe title/content wrapper.
- Preserve the existing three-second lifecycle and dialog pause behavior.

### 5. Select-arrow parity
- The `节点性质` select in create/edit must render its right-side native arrow with the same dark-theme appearance/color as the selects on `连接另一个思想`.
- Reuse the connection form's dark color-scheme approach rather than drawing a new custom arrow.
- Keep Safari focus-safe 16px computed font behavior.

## Preserve
- Existing title positions and copy from #140.
- Edit-page management menu placement and two-step destructive confirmation.
- Drag/long-press text-selection prevention.
- Galaxy percentage spacing fix.
- Relation cancel -> source detail.
- Universe deep-link behavior from Phase 8.4.
- Desktop presentation.

## Verification
Add focused regression assertions for:
- Day Space top bar z-index above Day Space date/paper layers while remaining opaque white and borderless.
- All three Universe action footers matching the detail footer constants.
- Placement popover visible, framed, and viewport-bounded rather than transient/transparent.
- Three-second notice positioned from viewport center.
- Create/edit select uses the same dark color-scheme as relation select.

No merge or production deploy until code review is complete; preview auth is not a production acceptance gate.