# System Restore UI Design

## Goal

Bring System → Data → Restore into the already accepted Leilei OS System visual language without changing import/recovery semantics.

## Source of truth

The visual reference is the existing accepted System UI:

- `SystemDataPageContent.tsx` data summary rows
- `system-export-ui-polish.css` Export header/actions/audit rows
- `SystemConnectionsPageContent.tsx` left/right status rows
- `SystemAboutPageContent.tsx` left/right detail rows
- existing `system-state-copy` / `system-export-error` text states

No new visual language is introduced.

## Product constraints

- Mobile is the acceptance target. Desktop receives only non-breaking shared layout behavior; no desktop redesign.
- Keep import preview/execute API behavior, fingerprint validation, no-overwrite semantics, and transaction behavior unchanged.
- Do not add icons, pills, progress bars, modal dialogs, colored success cards, or warning cards.
- Do not expose raw planner vocabulary (`create`, `duplicate`, `conflict`, `invalid`) as a technical dump.
- State changes replace content in place instead of growing an unbounded stack below the card.

## Card geometry

Restore remains one `system-section` sibling after Export, using the same card shell.

- 60px-ish header row: `Restore`
- subsequent rows separated by the same thin top divider used by Export
- actions are plain text actions matching `.system-export-action`, not `.secondary-button`
- muted secondary copy uses the existing System muted typography

## States

### Idle

```text
Restore
────────────────────────
Export file                         Choose
```

No long explanatory paragraph. No large button.

### Selected

```text
Restore
────────────────────────
backup.json · 16.2 KB              Preview
```

Selecting a file remains local-only. Preview is explicit.

### Previewing

```text
Restore
────────────────────────
backup.json · 16.2 KB          Validating…
```

No extra row appears solely for loading.

### Ready — restoreable

Only non-zero module rows are shown.

```text
Restore
────────────────────────
backup.json · 16.2 KB               Change
────────────────────────
Memory                                3 new
Diary                                 1 new
────────────────────────
4 new records                       Restore
```

If duplicates are present, the final summary may say `4 new · 2 already here`.

### Ready — everything already present

```text
Restore
────────────────────────
backup.json · 16.2 KB               Change
────────────────────────
Everything is already here
```

No disabled `Restore 0 records` control.

### Ready — blocked by conflict / invalid data

Show only affected non-zero module rows with human-facing labels such as `Conflict` or `Invalid`, followed by a short plain-language reason. Do not render raw count matrices. Do not render a disabled restore action.

### Restoring

```text
Restore
────────────────────────
backup.json · 16.2 KB
────────────────────────
Restoring…
```

### Success

```text
Restore
────────────────────────
Restored 4 records
```

If duplicates were skipped, retain the existing useful skipped-count information in compact copy.

### Error

Use the specific safe `WebApiError` message already returned by the backend when available (unsupported export version, wrong account, conflict, stale preview, nothing to restore, too large, unavailable). Fall back to the current generic validation/restore copy for unknown errors.

## Acceptance

- Mobile Restore card visually matches accepted System/Data/Export row language.
- File selection does not create a second large button or a vertically stacked technical panel.
- Preview shows only useful non-zero human-facing information.
- Import semantics and API call ordering remain unchanged.
- Existing Export UI remains unchanged.
