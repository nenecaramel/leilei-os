# Day Space Loading Placeholder Alignment

## Goal

Make both Day Space loading messages use the same visual treatment and placement as the accepted empty-state message `这一天还没有内容` before Home is formally closed.

## Scope

- Keep the existing loading copy unchanged:
  - `正在读取 Day Space…`
  - `正在读取当天内容…`
- Keep `role="status"` semantics unchanged.
- Reuse the empty-state placeholder treatment as the visual source of truth.
- Place loading placeholders in the same Day Space stage-measure region used by the empty state so position, typography, and alignment match exactly.
- Preserve existing request flow, discovery logic, module state machine, retry/error/warning behavior, paper layout, date navigation, and all other pages.

## Visual Contract

Loading and empty placeholders share one common placeholder style. The accepted empty-state values remain the baseline: centered text, `padding-top: 94px`, `font-size: 12px`, `font-weight: 400`, and the same muted text color.

No spinner, animation, skeleton, new component pattern, or new copy is introduced.

## Implementation Shape

Prefer the smallest structure change in `DaySpacePage.tsx` plus the corresponding shared CSS rule in the existing stylesheet. Both discovery loading and selected-date content loading should render through the stage-measure placeholder area rather than maintaining a separately positioned loading block.

## Verification

Update focused Day Space tests so loading placeholders and empty state are asserted to use the same placeholder class/region while preserving loading text and status semantics. Then run the project-standard deterministic tests, root/web typecheck and build, diff checks, and production smoke after deployment.

## Non-goals

No Home Records work, Todo/Diary behavior changes, Calendar changes, API/schema/migration/persistence changes, MCP changes, PWA changes, or unrelated CSS cleanup.