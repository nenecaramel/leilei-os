# Todo Multiline Editing and Home Preview Design

## Goal
Fix multiline Todo editing and make Home preview truncate by visual lines instead of Todo count.

## Dialog behavior
- One Todo remains one logical entry even when text wraps onto multiple visual lines.
- Wrapped text expands to its full height immediately when editing begins.
- Clicking any wrapped visual line edits the same Todo and preserves a caret position near the click.
- The status mark stays aligned with the first visual line.
- Enter continues to move to the next Todo rather than inserting a manual newline.

## Home preview
- Show at most three visual text lines, not three Todo entries.
- Todo text may naturally wrap across those three lines.
- When content exceeds three visual lines, show a subtle left-aligned `...` below the third line.
- Keep the `...` close to the third line.
- Do not change card dimensions, signature position, or unrelated Home geometry.

## Testing
Add regression coverage for textarea auto-sizing on activation and visual-line-based Home overflow behavior.
