# Todo Paper Vertical Offset Design

## Goal

Move the Todo paper dialog downward by 31px from its current centered position.

## Scope

- Add `transform: translateY(31px)` to `.paper-detail-paper`.
- Keep the paper width, height, internal layout, date, rules, Todo rows, signature, veil, and Home layout unchanged.
- Do not change Calendar, Todo preview cards, Records cards, or any other Home geometry.

## Verification

Add a focused regression assertion for the 31px paper transform, then run the existing Todo paper and Home regression tests plus web typecheck.
