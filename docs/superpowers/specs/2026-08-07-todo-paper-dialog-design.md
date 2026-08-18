# Todo Paper Dialog Design

## Scope

Replace the current L/G Todo dialog with a reusable paper-style detail shell. This batch is a local-only prototype; no backend or other module data is changed.

## Shared paper shell

- One centered white paper surface using the Home card border, about 14px radius, and a soft broad shadow.
- Keep the current width; use a fixed viewport-safe height about 1.25 times the current dialog.
- Very light veil; no header, title, close button, or save button.
- Pale horizontal rules leave space at both sides.
- Fixed date at upper-left in `YYYY.MM.DD`; fixed `L`/`G` signature at lower-right.
- Only the body scrolls.
- Outside click and Escape use the same close flow; inside click never closes; focus returns to the opening card.
- The shell must later be reusable by Memory, Diary, Task, and Universe.

## Todo behavior

Each paper contains all entries for one author on one local date. Every row keeps `id`, `author`, `kind` (`pending | completed | record`), and `text`.

- Open directly in edit mode.
- Enter creates the next row.
- Backspace in an empty row removes it and focuses the previous row.
- Always keep one empty creation row; empty rows are never saved.
- Text may wrap; order is preserved without priority meaning.
- Status column has fixed width:
  - pending: 14px light-gray hollow ring;
  - completed: same-size gray filled circle with white check;
  - record: 7–8px darker solid dot.
- Clicking status cycles `pending → completed → record → pending`.

## Persistence

Use a storage adapter with key:

`leilei.home.todo-paper.v1:{YYYY-MM-DD}:{L|G}`

L/G and dates are isolated. Missing data seeds from existing fixtures without writing immediately. Saved valid data overrides fixtures; invalid data is ignored. Normalize by trimming text, dropping empty rows, preserving order and existing IDs, and assigning IDs to new rows.

No changes: close without writing. Changes: save, update the matching Home preview, then close. Save failure keeps the paper open, preserves edits, and shows a small inline error.

## Home preview

After save, the matching card updates immediately. Compact cards still show three entries; the third keeps the current fade. Compact status marks match the editor but are not interactive.

## Components

- `PaperDetailDialog`: veil, paper, fixed date/signature, body scrolling, close path, focus.
- `TodoPaperEditor`: rows, keyboard behavior, status cycling, dirty state, errors.
- Storage adapter: keys, validation, read/write, failures.
- Home owner: selected author/date and preview refresh.

## Acceptance

The new paper has no legacy header/buttons; date/signature stay fixed; body scrolls; outside click/Escape save only when dirty; row editing and status cycling work; data survives refresh without L/G/date collisions; save failure never loses edits; Calendar remains unchanged.
