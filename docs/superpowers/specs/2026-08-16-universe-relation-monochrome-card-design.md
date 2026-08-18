# Universe relation monochrome card design

## Goal

Redesign only the mobile “让两个思想相遇” relation-creation paper so it uses the same outer card geometry and visual language as the accepted Universe node detail card, while keeping the already-merged direct relation flow and save behavior unchanged.

## Scope

### In scope

- Mobile relation paper outer geometry exactly follows the current accepted node detail paper:
  - width `min(665px, calc(100vw - 46px))`
  - height `clamp(506px, calc(78dvh - 54px), 666px)`
  - short-viewport height `calc(100dvh - 50px)`
  - `border-radius: 14px`
  - `transform: translateY(16px)`
  - same detail veil: `rgba(3, 4, 9, 0.5)` with `blur(4px)`
  - same shadow and fixed three-row card structure
- Relation paper uses only the existing warm black/white/gray palette:
  - card `#101119`
  - warm white `#f5f2e9`
  - bright gray `#d7d5d0`
  - secondary gray `#7d7f8c`
  - border/track gray `#343640`
  - disabled gray `#555763`
- Remove the mobile green line, `CREATE CONNECTION` eyebrow, and top-right close button.
- Outside veil click remains the close interaction through the existing `PaperDetailDialog` behavior.
- Top context line: `当前思想 · {source.title}`, 12px, `#7d7f8c`.
- Main title: `让两个思想相遇`, 24px, weight 500, `#f5f2e9`, line-height 1.08.
- Intro: `选择另一个思想，并定义它们之间的关系。`, 13px, `#7d7f8c`.
- “连接到” and “它们如何彼此影响？” labels: 12px, `#7d7f8c`.
- Select controls:
  - height 44px
  - radius 10px
  - border `1px solid #343640`
  - background `#101119`
  - selected text 15px `#d7d5d0`
  - empty/default text visually secondary
  - no shadow
  - focus border changes only to `#7d7f8c`; no accent color
- Vertical rhythm:
  - label-to-control gap 8px
  - target-to-relation group spacing 18px
- Connection strength:
  - label 12px `#7d7f8c`
  - percentage 15px `#f5f2e9`
  - track height 3px
  - active track `#d7d5d0`
  - inactive track `#343640`
  - thumb approximately 18px, `#f5f2e9`
  - no glow or accent color
- Footer is fixed to the bottom like node detail actions:
  - no divider
  - left `取消`, 12px `#7d7f8c`
  - right `建立连接`, 12px `#f5f2e9`
  - disabled `建立连接` uses `#555763`
  - no pill background or border
  - saving copy remains `保存中…`

### Out of scope

- Node detail visuals.
- Universe homepage/map visuals.
- Relation type semantics, available relation types, strength values, target filtering, API payloads, persistence, save reconciliation, or direct-flow behavior.
- Desktop relation-paper redesign.

## Interaction and data behavior

- Current source remains fixed.
- Target selector still excludes the source and starts empty.
- Save remains disabled until a valid target is selected.
- Relation type and strength continue to use the existing state and save payload.
- Clicking the outside veil closes the paper using `PaperDetailDialog`; no in-card close icon is shown on mobile.

## Implementation boundary

Use relation-specific mobile overrides rather than changing the shared editor/create visual language. The accepted detail geometry is the source of truth for outer shell measurements.

## Verification

Focused regression assertions must lock:

1. No mobile eyebrow or close button remains in the relation body.
2. Context/title/intro copy and hierarchy are present.
3. Relation outer shell matches the detail card geometry and veil values.
4. Mobile controls and footer use the monochrome values above and contain no `#d9ff70` relation-specific accent styling.
5. Target selection, relation type, strength, disabled-save and save payload behavior remain unchanged.
