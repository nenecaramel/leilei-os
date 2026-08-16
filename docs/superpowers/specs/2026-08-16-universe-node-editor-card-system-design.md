# Universe node editor card system design

## Goal

Unify mobile Universe create/edit node papers with the accepted detail and relation-card system while preserving all existing node save semantics.

## Shared shell

Create and edit use the exact accepted paper shell already used by node detail and relation creation:
- width `min(665px, calc(100vw - 46px))`
- height `clamp(506px, calc(78dvh - 54px), 666px)`
- short viewport height `calc(100dvh - 50px)`
- border radius 14px
- `translateY(16px)`
- veil `rgba(3, 4, 9, 0.5)` with 4px blur
- card background `#101119`
- 20px horizontal content padding
- fixed header, scrollable body, fixed footer

No mobile eyebrow, green line, or in-card close button. The outside veil closes the paper.

## Header

Create:
- context `新星 · 待点亮`, 12px `#7d7f8c`
- title `点亮一颗新星`, 24px/500 `#f5f2e9`

Edit:
- context `当前思想 · {original node title}`, 12px `#7d7f8c`
- title `调整这颗星球`, 24px/500 `#f5f2e9`

No extra intro paragraph.

## Form controls

All single-line inputs/selects use the same relation-page control scale:
- height 44px
- radius 10px
- border `#343640`
- background `#101119`
- 15px `#d7d5d0` content
- placeholder/labels `#7d7f8c`
- focus border `#7d7f8c`, no glow
- label 12px
- label-to-control gap 8px
- group spacing 18px

Fields:
1. `它叫什么？` — required title, placeholder `一个概念、问题或经历`.
2. `一句话描述 · 可选` — textarea 62px, placeholder `为什么它值得留在你的宇宙？`.
3. `此刻的理解` — textarea 96px, placeholder `写下你现在怎样理解它。`.
4. Remove the disabled `这次认知为什么改变？` field entirely because the canonical data contract does not persist it.
5. `节点性质` — existing node type select, 44px.
6. `标签` — existing comma-separated tags input, 44px, placeholder `自我观察, 认知演化`.
7. `它同时闪耀在哪些星系？` — keep galaxy semantic colors. Unselected chips remain gray; selected chips keep each galaxy color.

## Galaxy weight display

Selected galaxy weights display as percentages in the editor (`55% / 100% / 90%`) while canonical persisted weights remain unchanged (`0.55 / 1 / 0.9`). Percentage editing converts back to canonical decimal values before the existing membership save path.

## Footer and secondary actions

Fixed footer:
- left `取消`, 12px `#7d7f8c`
- right `点亮星球` for create, `保存星球` for edit, 12px `#f5f2e9`
- disabled primary `#555763`
- no divider, pill, border, or filled button

Edit-only secondary actions move into the bottom of the scrollable body after galaxy memberships:
- `恢复上一版本`
- `让它离开宇宙`
- 11px `#555763`

## Behavior constraints

Do not change:
- title-required validation
- type values
- tag parsing
- canonical galaxy membership shape `{id, weight}`
- node create/update payloads
- revision restore/delete behavior
- save reconciliation
- desktop editor UI
- node detail UI
- relation UI
- Universe map/homepage

## Verification

Focused tests lock the approved mobile hierarchy, exact shell geometry, field removal, form dimensions, percentage/canonical weight conversion, fixed footer copy, and unchanged save behavior.