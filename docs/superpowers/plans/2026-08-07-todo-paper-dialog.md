# Todo Paper Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy L/G Today dialog with a reusable paper detail shell and a local-only editable Todo paper that autosaves by author and local date.

**Architecture:** Introduce a storage adapter, a reusable `PaperDetailDialog`, a Todo-specific editor, and a thin `TodoPaperDialog` coordinator. `DashboardPageContent` owns the current L/G preview arrays so a successful save updates Home immediately, while persistence stays isolated behind the adapter.

**Tech Stack:** React, TypeScript, CSS, browser `localStorage`, Node test runner, JSDOM.

## Global Constraints

- Do not change Calendar geometry, typography, or positioning.
- Keep the compact Home Todo cards limited to three visible entries; the third keeps the existing fade.
- Keep `web/preview.html` and `web/src/preview-main.tsx` untracked and out of commits.
- Use local-only persistence; do not call Task, Diary, Memory, Universe, or backend APIs.
- Use the shared paper shell for geometry and close behavior; keep Todo row behavior in Todo-specific code.
- Date format is exactly `YYYY.MM.DD`; storage date segment is exactly `YYYY-MM-DD`.
- Clicking outside or pressing Escape uses the same save-before-close path.
- A failed write keeps the dialog open and preserves edits.

---

## File Map

- Create `web/src/pages/todo-paper-storage.ts`: versioned keys, validation, normalization, safe reads and writes.
- Create `web/src/pages/PaperDetailDialog.tsx`: reusable modal veil, paper surface, fixed date/signature, scroll body, focus and close behavior.
- Create `web/src/pages/TodoPaperEditor.tsx`: editable rows, trailing creation row, keyboard behavior, status cycling.
- Create `web/src/pages/TodoPaperDialog.tsx`: load/edit/save coordination and dirty-state close contract.
- Modify `web/src/pages/DashboardPage.tsx`: current L/G state, open selected author, update preview after save.
- Modify `web/src/pages/TodayPanel.tsx`: shared CSS status marks instead of text glyphs.
- Modify `web/src/pages/home-prototype-data.ts`: reuse existing `HomeNote` types as Todo entry types.
- Delete `web/src/pages/TodayPanelDialog.tsx` after replacement is wired.
- Modify `web/src/styles.css`: paper shell, ruled body, editor rows, status marks, veil, responsive height.
- Create `tests/todo-paper-storage.test.ts`: storage and normalization tests.
- Create `tests/todo-paper-dialog.test.ts`: dialog/editor interaction tests.
- Modify `tests/mobile-home-shell.test.ts`: Home integration and CSS assertions.
- Modify `docs/superpowers/specs/2026-08-07-todo-paper-dialog-design.md` only if implementation reveals an actual contradiction.

---

### Task 1: Versioned Todo Paper Storage

**Files:**
- Create: `web/src/pages/todo-paper-storage.ts`
- Create: `tests/todo-paper-storage.test.ts`
- Reuse: `web/src/pages/home-prototype-data.ts`

**Interfaces:**
- Consumes: `HomeAuthor`, `HomeNote`, `HomeNoteKind`.
- Produces:
  - `formatTodoStorageDate(date: Date): string`
  - `formatTodoPaperDate(date: Date): string`
  - `todoPaperStorageKey(author: HomeAuthor, dateKey: string): string`
  - `normalizeTodoPaperEntries(entries: readonly HomeNote[]): HomeNote[]`
  - `readTodoPaperEntries(storage, author, dateKey, seed): HomeNote[]`
  - `writeTodoPaperEntries(storage, author, dateKey, entries): void`
  - `createTodoPaperEntryId(author: HomeAuthor): string`

- [ ] **Step 1: Write failing storage tests**

Create `tests/todo-paper-storage.test.ts` with real in-memory storage:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTodoPaperDate,
  formatTodoStorageDate,
  normalizeTodoPaperEntries,
  readTodoPaperEntries,
  todoPaperStorageKey,
  writeTodoPaperEntries,
} from "../web/src/pages/todo-paper-storage.js";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test("Todo paper dates use local YYYY-MM-DD keys and YYYY.MM.DD labels", () => {
  const date = new Date(2026, 7, 7, 12, 0, 0);
  assert.equal(formatTodoStorageDate(date), "2026-08-07");
  assert.equal(formatTodoPaperDate(date), "2026.08.07");
});

test("Todo paper keys isolate date and author", () => {
  assert.equal(
    todoPaperStorageKey("L", "2026-08-07"),
    "leilei.home.todo-paper.v1:2026-08-07:L",
  );
  assert.notEqual(
    todoPaperStorageKey("L", "2026-08-07"),
    todoPaperStorageKey("G", "2026-08-07"),
  );
});

test("Missing or malformed storage falls back to a cloned fixture seed", () => {
  const storage = new MemoryStorage();
  const seed = [{ id: "l-1", author: "L" as const, kind: "pending" as const, text: " seed " }];
  assert.deepEqual(readTodoPaperEntries(storage, "L", "2026-08-07", seed), seed);
  storage.setItem(todoPaperStorageKey("L", "2026-08-07"), "{bad json");
  assert.deepEqual(readTodoPaperEntries(storage, "L", "2026-08-07", seed), seed);
});

test("Writing trims text, drops empty rows, and saved data overrides fixtures", () => {
  const storage = new MemoryStorage();
  writeTodoPaperEntries(storage, "G", "2026-08-07", [
    { id: "g-1", author: "G", kind: "record", text: " kept " },
    { id: "g-empty", author: "G", kind: "pending", text: "   " },
  ]);
  assert.deepEqual(
    readTodoPaperEntries(storage, "G", "2026-08-07", []),
    [{ id: "g-1", author: "G", kind: "record", text: "kept" }],
  );
});

test("Normalization preserves order and existing ids", () => {
  assert.deepEqual(normalizeTodoPaperEntries([
    { id: "2", author: "L", kind: "record", text: " second " },
    { id: "1", author: "L", kind: "completed", text: " first " },
  ]), [
    { id: "2", author: "L", kind: "record", text: "second" },
    { id: "1", author: "L", kind: "completed", text: "first" },
  ]);
});
```

- [ ] **Step 2: Run the storage tests and verify RED**

Run:

```bash
node --import tsx --test tests/todo-paper-storage.test.ts
```

Expected: FAIL because `todo-paper-storage.ts` does not exist.

- [ ] **Step 3: Implement the storage adapter**

Create `web/src/pages/todo-paper-storage.ts`:

```ts
import type { HomeAuthor, HomeNote, HomeNoteKind } from "./home-prototype-data";

const STORAGE_PREFIX = "leilei.home.todo-paper.v1";
const KINDS = new Set<HomeNoteKind>(["pending", "completed", "record"]);

const twoDigits = (value: number) => String(value).padStart(2, "0");

export function formatTodoStorageDate(date: Date): string {
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
}

export function formatTodoPaperDate(date: Date): string {
  return formatTodoStorageDate(date).replaceAll("-", ".");
}

export function todoPaperStorageKey(author: HomeAuthor, dateKey: string): string {
  return `${STORAGE_PREFIX}:${dateKey}:${author}`;
}

function isHomeNote(value: unknown, author: HomeAuthor): value is HomeNote {
  if (!value || typeof value !== "object") return false;
  const note = value as Partial<HomeNote>;
  return (
    typeof note.id === "string" &&
    note.id.length > 0 &&
    note.author === author &&
    typeof note.kind === "string" &&
    KINDS.has(note.kind as HomeNoteKind) &&
    typeof note.text === "string"
  );
}

export function normalizeTodoPaperEntries(entries: readonly HomeNote[]): HomeNote[] {
  return entries
    .map((entry) => ({ ...entry, text: entry.text.trim() }))
    .filter((entry) => entry.text.length > 0);
}

export function readTodoPaperEntries(
  storage: Pick<Storage, "getItem">,
  author: HomeAuthor,
  dateKey: string,
  seed: readonly HomeNote[],
): HomeNote[] {
  try {
    const raw = storage.getItem(todoPaperStorageKey(author, dateKey));
    if (raw === null) return seed.map((entry) => ({ ...entry }));
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((entry) => isHomeNote(entry, author))) {
      return seed.map((entry) => ({ ...entry }));
    }
    return normalizeTodoPaperEntries(parsed);
  } catch {
    return seed.map((entry) => ({ ...entry }));
  }
}

export function writeTodoPaperEntries(
  storage: Pick<Storage, "setItem">,
  author: HomeAuthor,
  dateKey: string,
  entries: readonly HomeNote[],
): void {
  storage.setItem(
    todoPaperStorageKey(author, dateKey),
    JSON.stringify(normalizeTodoPaperEntries(entries)),
  );
}

export function createTodoPaperEntryId(author: HomeAuthor): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${author.toLowerCase()}-${suffix}`;
}
```

- [ ] **Step 4: Run storage tests and typecheck**

Run:

```bash
node --import tsx --test tests/todo-paper-storage.test.ts
npm --prefix web run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit storage adapter**

```bash
git add web/src/pages/todo-paper-storage.ts tests/todo-paper-storage.test.ts
git commit -m "feat: add Todo paper storage"
```

---

### Task 2: Reusable Paper Detail Shell

**Files:**
- Create: `web/src/pages/PaperDetailDialog.tsx`
- Create: `tests/todo-paper-dialog.test.ts`
- Modify later: `web/src/styles.css`

**Interfaces:**
- Produces:

```ts
export type PaperDetailDialogProps = {
  id: string;
  open: boolean;
  label: string;
  dateLabel: string;
  signature: string;
  triggerRef: React.RefObject<HTMLElement | null>;
  onRequestClose: () => boolean | Promise<boolean>;
  children: React.ReactNode;
  errorMessage?: string | null;
};
```

`onRequestClose` returns `true` only when the shell may close. Returning `false` keeps it open.

- [ ] **Step 1: Write failing shell tests**

In `tests/todo-paper-dialog.test.ts`, install JSDOM and render `PaperDetailDialog`. Test:

```ts
test("Paper detail shell has fixed metadata, no close button, and outside-click close", async () => {
  // render open shell with date 2026.08.07 and signature L
  // assert role=dialog, aria-modal=true
  // assert .paper-detail-date and .paper-detail-signature are outside .paper-detail-scroll
  // assert no button with close/save label
  // click inside .paper-detail-paper and assert close count stays 0
  // click .paper-detail-veil and assert close count becomes 1
});

test("Escape uses the same close request and focus returns to trigger", async () => {
  // open from a focused trigger
  // dispatch Escape
  // rerender closed after approved close
  // assert trigger regains focus
});

test("Rejected close keeps the paper open", async () => {
  // onRequestClose resolves false
  // click veil
  // assert dialog remains and request is not re-entered while pending
});
```

- [ ] **Step 2: Run the shell tests and verify RED**

```bash
node --import tsx --test tests/todo-paper-dialog.test.ts
```

Expected: FAIL because `PaperDetailDialog.tsx` does not exist.

- [ ] **Step 3: Implement `PaperDetailDialog`**

Create `web/src/pages/PaperDetailDialog.tsx` with:

- body scroll locking while open;
- `requestClose` guarded by a `closingRef`;
- veil as a semantic button with `aria-label="关闭纸张"`;
- paper `role="dialog"`, `aria-modal="true"`, and `aria-label={label}`;
- fixed date and signature siblings around `.paper-detail-scroll`;
- 24 decorative line spans in `.paper-detail-rules`, all `aria-hidden`;
- Escape calling the same guarded close path;
- initial focus on the first `[data-paper-autofocus]`, otherwise the paper;
- cleanup restoring the trigger focus;
- a simple Tab focus loop over buttons, inputs, and textareas inside the paper.

Core structure:

```tsx
<div className="paper-detail-layer" role="presentation">
  <button className="paper-detail-veil" type="button" aria-label="关闭纸张" onClick={requestClose} />
  <section
    id={id}
    className="paper-detail-paper"
    role="dialog"
    aria-modal="true"
    aria-label={label}
    tabIndex={-1}
    ref={paperRef}
  >
    <span className="paper-detail-date">{dateLabel}</span>
    <div className="paper-detail-scroll">
      <div className="paper-detail-rules" aria-hidden="true">
        {Array.from({ length: 24 }, (_, index) => <span key={index} />)}
      </div>
      <div className="paper-detail-body">{children}</div>
    </div>
    {errorMessage ? <p className="paper-detail-error" role="alert">{errorMessage}</p> : null}
    <span className="paper-detail-signature">{signature}</span>
  </section>
</div>
```

- [ ] **Step 4: Run shell tests and typecheck**

```bash
node --import tsx --test tests/todo-paper-dialog.test.ts
npm --prefix web run typecheck
```

Expected: PASS for shell behavior; CSS assertions are added in Task 5.

- [ ] **Step 5: Commit the shared shell**

```bash
git add web/src/pages/PaperDetailDialog.tsx tests/todo-paper-dialog.test.ts
git commit -m "feat: add reusable paper detail shell"
```

---

### Task 3: Todo Row Editor

**Files:**
- Create: `web/src/pages/TodoPaperEditor.tsx`
- Modify: `tests/todo-paper-dialog.test.ts`

**Interfaces:**
- Consumes `HomeAuthor`, `HomeNote`.
- Produces:

```ts
export type TodoPaperEditorHandle = {
  getNormalizedEntries(): HomeNote[];
  focusFirstRow(): void;
};

export type TodoPaperEditorProps = {
  author: HomeAuthor;
  initialEntries: readonly HomeNote[];
  onDirtyChange: (dirty: boolean) => void;
};
```

- [ ] **Step 1: Add failing editor tests**

Append tests that render the editor through a small harness:

```ts
test("Todo editor keeps one creation row and Enter creates the next row", async () => {
  // start with one entry
  // assert two textareas: one entry plus one empty creation row
  // press Enter in first textarea
  // assert a new row exists immediately after it and receives focus
});

test("Backspace removes an empty non-final row and focuses the previous row", async () => {
  // create a row, leave it empty, press Backspace
  // assert row count drops and previous textarea is focused
});

test("Status control cycles pending completed record pending", async () => {
  // click one status button three times
  // assert data-kind sequence and accessible label sequence
});

test("Normalized editor output drops empty rows and trims text", async () => {
  // edit rows with leading/trailing whitespace
  // call the exposed handle
  // assert normalized HomeNote[]
});
```

- [ ] **Step 2: Run editor tests and verify RED**

```bash
node --import tsx --test tests/todo-paper-dialog.test.ts
```

Expected: FAIL because `TodoPaperEditor.tsx` does not exist.

- [ ] **Step 3: Implement the editor**

Create `web/src/pages/TodoPaperEditor.tsx` using `forwardRef`.

Internal row shape:

```ts
type EditableTodoRow = HomeNote & { creation?: boolean };
```

Rules:

- initialize with cloned entries plus one empty pending creation row;
- when the creation row gains non-whitespace text, convert it to a normal row and append a fresh creation row;
- Enter prevents newline, inserts a pending row after the current row, and focuses it on the next animation frame;
- Backspace on an empty row removes it unless it is the only creation row;
- status button uses:

```ts
const NEXT_KIND = {
  pending: "completed",
  completed: "record",
  record: "pending",
} as const;
```

- textareas use `rows={1}` and an `onInput` helper that sets `style.height = "auto"` then `style.height = `${scrollHeight}px``;
- first textarea gets `data-paper-autofocus`;
- status button carries `data-kind`, `aria-label`, and a visual span;
- every state change reports dirty by comparing normalized JSON with the normalized initial snapshot;
- the imperative handle returns normalized entries and focuses the first row.

- [ ] **Step 4: Run editor tests and typecheck**

```bash
node --import tsx --test tests/todo-paper-dialog.test.ts
npm --prefix web run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the editor**

```bash
git add web/src/pages/TodoPaperEditor.tsx tests/todo-paper-dialog.test.ts
git commit -m "feat: add editable Todo paper rows"
```

---

### Task 4: Todo Paper Coordinator and Home State

**Files:**
- Create: `web/src/pages/TodoPaperDialog.tsx`
- Modify: `web/src/pages/DashboardPage.tsx`
- Modify: `web/src/pages/TodayPanel.tsx`
- Delete: `web/src/pages/TodayPanelDialog.tsx`
- Modify: `tests/todo-paper-dialog.test.ts`
- Modify: `tests/mobile-home-shell.test.ts`

**Interfaces:**
- `TodoPaperDialog` props:

```ts
type TodoPaperDialogProps = {
  author: HomeAuthor;
  date: Date;
  open: boolean;
  entries: readonly HomeNote[];
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onSaved: (entries: HomeNote[]) => void;
  onClosed: () => void;
};
```

- [ ] **Step 1: Add failing save and integration tests**

Add tests for:

- opening L displays `2026.08.07`, signature `L`, all L entries, and no legacy header or close button;
- no-change outside click closes without `setItem`;
- changed outside click writes the L/date key before closing and calls `onSaved`;
- write failure keeps the dialog open and shows an alert;
- L and G Home previews update independently after successful saves;
- compact cards still render exactly three `.today-note` rows per card;
- status marks are CSS elements with no `○`, `✓`, or `●` text glyphs.

Inject storage into `TodoPaperDialog` through an optional `storage?: Storage` prop used only by tests; default to `window.localStorage`.

- [ ] **Step 2: Run targeted tests and verify RED**

```bash
node --import tsx --test \
  tests/todo-paper-dialog.test.ts \
  tests/mobile-home-shell.test.ts
```

Expected: FAIL because the coordinator and integration do not exist.

- [ ] **Step 3: Implement `TodoPaperDialog`**

Create `web/src/pages/TodoPaperDialog.tsx`:

- derive `dateKey` and `dateLabel`;
- keep `dirty` and `saveError`;
- hold `TodoPaperEditorHandle`;
- on close request:
  - if not dirty, call `onClosed()` and return `true`;
  - otherwise call `writeTodoPaperEntries`;
  - on success, call `onSaved(normalized)`, then `onClosed()`, then return `true`;
  - on failure, set `saveError` and return `false`;
- render `PaperDetailDialog` and `TodoPaperEditor`;
- reset error when reopened or edited;
- use accessible label `${author} Todo ${dateLabel}`.

- [ ] **Step 4: Update `DashboardPageContent`**

Replace fixture-only render data with current local state:

```ts
const dateKey = formatTodoStorageDate(today);
const storage = typeof window === "undefined" ? null : window.localStorage;

const [lNotes, setLNotes] = useState<HomeNote[]>(() =>
  storage ? readTodoPaperEntries(storage, "L", dateKey, L_HOME_NOTES) : [...L_HOME_NOTES],
);
const [gNotes, setGNotes] = useState<HomeNote[]>(() =>
  storage ? readTodoPaperEntries(storage, "G", dateKey, G_HOME_NOTES) : [...G_HOME_NOTES],
);
```

Render `TodayPanel` from `lNotes` and `gNotes`.

Render one selected `TodoPaperDialog`, or two author-specific instances if that produces simpler focus restoration. In either case:

- L save calls `setLNotes`;
- G save calls `setGNotes`;
- closing sets `dialogAuthor` to `null`;
- no API requests are introduced.

- [ ] **Step 5: Replace compact glyphs with semantic CSS marks**

In `TodayPanel.tsx`, replace glyph content with:

```tsx
<span className="today-note-mark" data-kind={note.kind} aria-hidden="true">
  <span />
</span>
```

Keep the third-row fade and `notes.slice(0, 3)` unchanged.

- [ ] **Step 6: Remove the legacy dialog**

Delete `web/src/pages/TodayPanelDialog.tsx` after all imports are gone.

- [ ] **Step 7: Run targeted tests and typecheck**

```bash
node --import tsx --test \
  tests/todo-paper-storage.test.ts \
  tests/todo-paper-dialog.test.ts \
  tests/mobile-home-shell.test.ts

npm --prefix web run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit integration**

```bash
git add \
  web/src/pages/DashboardPage.tsx \
  web/src/pages/TodayPanel.tsx \
  web/src/pages/TodoPaperDialog.tsx \
  web/src/pages/TodayPanelDialog.tsx \
  tests/todo-paper-dialog.test.ts \
  tests/mobile-home-shell.test.ts

git commit -m "feat: connect Todo paper editing to Home"
```

---

### Task 5: Paper and Status Visual System

**Files:**
- Modify: `web/src/styles.css`
- Modify: `tests/mobile-home-shell.test.ts`
- Modify: `tests/todo-paper-dialog.test.ts`

**Interfaces:**
- Uses class names created in Tasks 2–4.
- Must not alter `.calendar-frame`, `.calendar-preview-header`, `.calendar-weekdays`, `.calendar-grid`, or `.calendar-day`.

- [ ] **Step 1: Write failing CSS assertions**

Add exact assertions for:

- `.paper-detail-layer` fixed full-screen and centered;
- `.paper-detail-veil` uses a light translucent white background;
- `.paper-detail-paper` width `min(680px, calc(100vw - 32px))`;
- `.paper-detail-paper` height `clamp(560px, 78dvh, 720px)`;
- white background, thin neutral border, `14px` radius, broad low-opacity shadow;
- `.paper-detail-scroll` is the only `overflow-y: auto` area;
- `.paper-detail-date` upper-left and `.paper-detail-signature` lower-right;
- `.paper-detail-rules span` has a pale bottom border and horizontal inset;
- no `linear-gradient`, `radial-gradient`, or `color-mix` is added to the Home v2 section;
- pending/completed outer marks are 14px;
- record mark is 8px and darker;
- completed check is drawn with CSS and remains white;
- editor status column has fixed width;
- paper has a mobile height fallback inside `@media (max-height: 680px)`.

- [ ] **Step 2: Run CSS tests and verify RED**

```bash
node --import tsx --test \
  tests/todo-paper-dialog.test.ts \
  tests/mobile-home-shell.test.ts
```

Expected: FAIL because the paper CSS is not present.

- [ ] **Step 3: Replace legacy dialog CSS**

Remove legacy selectors:

- `.today-panel-dialog-layer`
- `.today-panel-dialog-backdrop`
- `.today-panel-dialog`
- `.today-panel-dialog-header`
- `.today-panel-dialog-content`
- `.today-dialog-note`

Add the shared paper rules. Use line elements, not gradients:

```css
.paper-detail-layer {
  position: fixed;
  z-index: 90;
  inset: 0;
  display: grid;
  place-items: center;
  padding: max(16px, env(safe-area-inset-top, 0px))
    max(16px, env(safe-area-inset-right, 0px))
    max(16px, env(safe-area-inset-bottom, 0px))
    max(16px, env(safe-area-inset-left, 0px));
}

.paper-detail-veil {
  position: absolute;
  border: 0;
  inset: 0;
  background: rgba(255, 255, 255, 0.82);
}

.paper-detail-paper {
  position: relative;
  z-index: 1;
  width: min(680px, calc(100vw - 32px));
  height: clamp(560px, 78dvh, 720px);
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.11);
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 18px 56px rgba(0, 0, 0, 0.09);
}

.paper-detail-scroll {
  position: absolute;
  inset: 58px 0 52px;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 28px;
}

.paper-detail-rules {
  position: absolute;
  z-index: 0;
  inset: 0 28px;
  display: grid;
  grid-auto-rows: 30px;
  pointer-events: none;
}

.paper-detail-rules span {
  border-bottom: 1px solid rgba(0, 0, 0, 0.075);
}
```

Keep date, signature, error, and editor body above the rules with `z-index: 1`.

- [ ] **Step 4: Implement status marks once and reuse them**

Apply the same visual language to `.today-note-mark` and `.todo-paper-status`:

- fixed 22px status column;
- pending ring: 14px, 1px gray border;
- completed: 14px gray fill with a white check built from a rotated border;
- record: 8px dark-gray solid circle;
- no text glyphs.

- [ ] **Step 5: Add editor row styling**

- grid columns `22px minmax(0, 1fr)`;
- row min-height aligned to 30px rules;
- transparent borderless textarea;
- no resize handle;
- `font: inherit`;
- focus visible through a subtle underline or outline that does not cover the ruled line;
- signature/date remain non-scrolling;
- error occupies fixed space above signature and does not shift the body.

- [ ] **Step 6: Add short-screen fallback**

```css
@media (max-height: 680px) {
  .paper-detail-paper {
    height: calc(100dvh - 24px);
  }
}
```

- [ ] **Step 7: Run tests, typecheck, and visual preview**

```bash
node --import tsx --test \
  tests/todo-paper-storage.test.ts \
  tests/todo-paper-dialog.test.ts \
  tests/mobile-home-shell.test.ts \
  tests/app-shell-mobile.test.ts \
  tests/dashboard-page.test.ts \
  tests/dashboard-visual-theme.test.ts

npm --prefix web run typecheck
git diff --check
```

Then refresh:

```text
http://192.168.31.88:5175/preview.html
```

Verify manually:

- L and G open the correct paper;
- date and signature do not scroll;
- long rows wrap;
- the body scrolls independently;
- outside click with no edits closes immediately;
- outside click after edits saves and updates the compact card;
- refresh restores saved entries;
- failed storage write can be simulated in tests and never discards edits;
- Calendar is visually unchanged.

- [ ] **Step 8: Commit visual system**

```bash
git add web/src/styles.css tests/mobile-home-shell.test.ts tests/todo-paper-dialog.test.ts
git commit -m "style: add ruled Todo paper dialog"
```

---

### Task 6: Full Regression and Documentation Check

**Files:**
- Review: all files changed in Tasks 1–5
- Modify only if needed: `docs/superpowers/specs/2026-08-07-todo-paper-dialog-design.md`

- [ ] **Step 1: Run the full relevant suite**

```bash
node --import tsx --test \
  tests/todo-paper-storage.test.ts \
  tests/todo-paper-dialog.test.ts \
  tests/mobile-home-shell.test.ts \
  tests/app-shell-mobile.test.ts \
  tests/dashboard-page.test.ts \
  tests/dashboard-visual-theme.test.ts

npm --prefix web run typecheck
git diff --check
```

Expected: all tests pass, typecheck exits 0, and `git diff --check` prints nothing.

- [ ] **Step 2: Confirm prohibited files are not staged**

```bash
git status --short
git diff --cached --name-only
```

Expected: neither `web/preview.html` nor `web/src/preview-main.tsx` appears in staged files.

- [ ] **Step 3: Review the implementation against the spec**

Check every acceptance criterion in `docs/superpowers/specs/2026-08-07-todo-paper-dialog-design.md`. Fix only demonstrated gaps; do not broaden scope.

- [ ] **Step 4: Final implementation commit if verification required fixes**

```bash
git add \
  web/src/pages \
  web/src/styles.css \
  tests \
  docs/superpowers/specs/2026-08-07-todo-paper-dialog-design.md

git reset -- web/preview.html web/src/preview-main.tsx 2>/dev/null || true
git commit -m "fix: complete Todo paper dialog verification"
```

Skip this commit when no post-verification changes exist.

- [ ] **Step 5: Record the final state**

```bash
git --no-pager log --oneline -6
git status --short
```

The branch is ready for independent review only after visual acceptance in the 5175 preview.
