# Memory Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the mobile Memory presentation around Home-style month cards and Todo-style paper detail/create/edit/archive views while preserving all existing Memory API, URL, history, lifecycle, and mutation semantics.

**Architecture:** Keep `MemoryPageContent` as the controller for requests, navigation, filters, dirty-state, and mutations. Add small presentation helpers/components for deterministic month grouping and the compact page header, extend the existing shared `PaperDetailDialog` with optional fixed corner slots, then replace only the Memory render layer and Memory-specific CSS. No backend, schema, route contract, or desktop redesign work is part of this batch.

**Tech Stack:** React 19, TypeScript, Vite, node:test + JSDOM, existing Web API client, existing `PaperDetailDialog`, existing Memory location/filter/scroll/submission helpers, shared `web/src/styles.css`.

## Global Constraints

- Primary acceptance viewport is exactly `393 × 852`.
- Preserve the shared global `MobileTopBar` unchanged.
- Preserve existing Memory list ordering request: `ordering: "updated_desc"`.
- Preserve create fields: `category`, `key`, `content`, `tags`; trimmed `key` and `content` remain required.
- Preserve update fields: `id`, `content`, `tags`; `key` and `category` are read-only after creation.
- Preserve archive/restore API paths and existing confirmation/error semantics.
- Preserve 300ms search debounce, URL-backed filters/history, detail/archive return paths, scroll restoration, quick-create, latest-request invalidation, single-flight mutation gating, mutation ownership, and unsaved-change protection.
- Active and archived lists use Home-style month cards; rows remain newest-first within the server-provided ordering.
- Invalid `updated_at` values go into a deterministic `时间未知` group after dated groups.
- Detail/create/edit/archive-detail use the existing Todo paper shell.
- Paper top-left date/time reuses `.paper-detail-date`; bottom-right fixed Memory signature is `N` using the existing Todo signature primitive.
- Paper top-right actions and bottom-left `category · tags` use the same small metadata family.
- Desktop must remain functional but receives no dedicated redesign.
- `web/preview.html` and `web/src/preview-main.tsx` remain untracked and must never be staged or committed.

---

## File Structure

- Create `web/src/pages/memory-presentation.ts`
  - Pure functions for month grouping, row title, row metadata, compact row date, and paper date/time formatting.
  - No React state and no Web API access.
- Create `web/src/pages/MemoryPageHeader.tsx`
  - Compact Memory title/count, five tools, category/tag popovers, expandable search field.
  - Receives current filter/search values and callbacks; owns only transient popover/search-open UI state.
- Modify `web/src/pages/PaperDetailDialog.tsx`
  - Add optional fixed `topRight` and `bottomLeft` slots without changing existing Todo behavior.
- Modify `web/src/pages/MemoryPage.tsx`
  - Keep request/navigation/mutation state and handlers.
  - Replace old `PageHeader`, filters block, card grid, detail blocks, and create block with the approved Memory presentation.
- Modify `web/src/styles.css`
  - Add Memory mobile header/tools/popovers/search/month cards/rows/paper body/edit styles.
  - Add shared paper fixed-corner slot styles next to existing paper primitives.
  - Remove or neutralize only obsolete Memory presentation selectors after tests no longer depend on them.
- Create `tests/memory-presentation.test.ts`
  - Pure deterministic presentation-helper tests.
- Modify `tests/memory-page.test.ts`
  - Update old visible-structure assertions and add interaction tests for header tools, row triggers, paper flows, create/edit/archive states.
- Modify `tests/todo-paper-dialog.test.ts`
  - Lock optional paper corner slots while proving existing Todo shell remains unchanged when slots are absent.

---

### Task 1: Add deterministic Memory presentation helpers

**Files:**
- Create: `web/src/pages/memory-presentation.ts`
- Create: `tests/memory-presentation.test.ts`

**Interfaces:**
- Produces:
  - `type MemoryPresentationRecord = { id: string; category: string; key: string; content: string; tags: string[]; updated_at: string }`
  - `type MemoryMonthGroup<T> = { key: string; label: string; memories: T[]; unknown: boolean }`
  - `groupMemoriesByMonth<T extends MemoryPresentationRecord>(memories: readonly T[]): MemoryMonthGroup<T>[]`
  - `getMemoryRowTitle(memory: Pick<MemoryPresentationRecord, "key" | "content">): string`
  - `formatMemoryRowDate(value: string): string`
  - `formatMemoryRowMeta(memory: Pick<MemoryPresentationRecord, "category" | "tags">, categoryLabel: string): string`
  - `formatMemoryPaperDate(value: string): string`

- [ ] **Step 1: Write failing pure-helper tests**

Create `tests/memory-presentation.test.ts` with explicit cases:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMemoryPaperDate,
  formatMemoryRowMeta,
  getMemoryRowTitle,
  groupMemoriesByMonth,
} from "../web/src/pages/memory-presentation.js";

const records = [
  { id: "a", category: "goal", key: "august_goal", content: "A", tags: ["focus"], updated_at: "2026-08-07T12:00:00.000Z" },
  { id: "b", category: "goal", key: "", content: "\nFirst visible line\nSecond", tags: [], updated_at: "2026-08-01T08:00:00.000Z" },
  { id: "c", category: "project", key: "july_project", content: "C", tags: ["OS", "UI"], updated_at: "2026-07-31T12:00:00.000Z" },
  { id: "d", category: "profile", key: "unknown", content: "D", tags: [], updated_at: "not-a-date" },
];

test("Memory presentation groups months in input order and keeps unknown time last", () => {
  const groups = groupMemoriesByMonth(records);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0].memories.map((item) => item.id), ["a", "b"]);
  assert.deepEqual(groups[1].memories.map((item) => item.id), ["c"]);
  assert.equal(groups[2].label, "时间未知");
  assert.deepEqual(groups[2].memories.map((item) => item.id), ["d"]);
});

test("Memory row title prefers key then first non-empty content line", () => {
  assert.equal(getMemoryRowTitle(records[0]), "august_goal");
  assert.equal(getMemoryRowTitle(records[1]), "First visible line");
});

test("Memory row metadata never leaves a dangling separator", () => {
  assert.equal(formatMemoryRowMeta(records[0], "Goal"), "Goal · #focus");
  assert.equal(formatMemoryRowMeta(records[1], "Goal"), "Goal");
  assert.equal(formatMemoryRowMeta(records[2], "Project"), "Project · #OS #UI");
});

test("Memory paper date is deterministic for valid and invalid timestamps", () => {
  assert.match(formatMemoryPaperDate(records[0].updated_at), /2026/);
  assert.equal(formatMemoryPaperDate("invalid"), "时间未知");
});
```

Do not assert an exact timezone-dependent clock string; the browser locale/timezone owns local display time.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
npx tsx --test tests/memory-presentation.test.ts
```

Expected: FAIL because `web/src/pages/memory-presentation.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure helper module**

Create `web/src/pages/memory-presentation.ts` with these rules:

```ts
export type MemoryPresentationRecord = {
  id: string;
  category: string;
  key: string;
  content: string;
  tags: string[];
  updated_at: string;
};

export type MemoryMonthGroup<T> = {
  key: string;
  label: string;
  memories: T[];
  unknown: boolean;
};

export function getMemoryRowTitle(
  memory: Pick<MemoryPresentationRecord, "key" | "content">,
): string {
  const key = memory.key.trim();
  if (key) return key;
  return memory.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "未命名记忆";
}

export function formatMemoryRowMeta(
  memory: Pick<MemoryPresentationRecord, "category" | "tags">,
  categoryLabel: string,
): string {
  const tags = memory.tags.map((tag) => `#${tag}`).join(" ");
  return tags ? `${categoryLabel} · ${tags}` : categoryLabel;
}

export function groupMemoriesByMonth<T extends MemoryPresentationRecord>(
  memories: readonly T[],
): MemoryMonthGroup<T>[] {
  const dated: MemoryMonthGroup<T>[] = [];
  const byKey = new Map<string, MemoryMonthGroup<T>>();
  const unknown: T[] = [];

  for (const memory of memories) {
    const date = new Date(memory.updated_at);
    if (Number.isNaN(date.getTime())) {
      unknown.push(memory);
      continue;
    }
    const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        label: `${date.getFullYear()}年${date.getMonth() + 1}月`,
        memories: [],
        unknown: false,
      };
      byKey.set(key, group);
      dated.push(group);
    }
    group.memories.push(memory);
  }

  return unknown.length
    ? [...dated, { key: "unknown", label: "时间未知", memories: unknown, unknown: true }]
    : dated;
}
```

Implement `formatMemoryRowDate` with local month/day formatting and `formatMemoryPaperDate` with local year/month/day plus hour/minute. Both return `时间未知` for invalid timestamps.

- [ ] **Step 4: Run helper tests and verify GREEN**

Run:

```bash
npx tsx --test tests/memory-presentation.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit the helper slice**

```bash
git add web/src/pages/memory-presentation.ts tests/memory-presentation.test.ts
git commit -m "feat: add Memory presentation helpers"
```

---

### Task 2: Extend the shared Todo paper shell with fixed corner slots

**Files:**
- Modify: `web/src/pages/PaperDetailDialog.tsx`
- Modify: `web/src/styles.css`
- Modify: `tests/todo-paper-dialog.test.ts`

**Interfaces:**
- Existing props remain unchanged.
- Adds optional props:
  - `topRight?: ReactNode`
  - `bottomLeft?: ReactNode`
- When absent, Todo DOM/behavior remains equivalent to today.
- When present, content is fixed outside `.paper-detail-scroll`.

- [ ] **Step 1: Add failing paper-slot tests**

In `tests/todo-paper-dialog.test.ts`, add a dedicated render that passes:

```ts
topRight: React.createElement("button", { type: "button" }, "编辑"),
bottomLeft: React.createElement("span", null, "Goal · #focus"),
```

Assert:

```ts
const topRight = harness.container.querySelector(".paper-detail-top-right");
const bottomLeft = harness.container.querySelector(".paper-detail-bottom-left");
const scroll = harness.container.querySelector(".paper-detail-scroll");
assert.ok(topRight);
assert.ok(bottomLeft);
assert.ok(scroll);
assert.equal(scroll.contains(topRight), false);
assert.equal(scroll.contains(bottomLeft), false);
assert.equal(topRight.textContent, "编辑");
assert.equal(bottomLeft.textContent, "Goal · #focus");
```

Keep the existing test that renders no slots and asserts no buttons inside the paper; it proves Todo's default shell is unchanged.

Add CSS contract assertions that `.paper-detail-top-right` is fixed at the top/right and `.paper-detail-bottom-left` is fixed at the bottom/left with `font-size: 13px`.

- [ ] **Step 2: Run the paper tests and verify RED**

Run:

```bash
npx tsx --test tests/todo-paper-dialog.test.ts
```

Expected: new slot test fails because the props/classes do not exist.

- [ ] **Step 3: Add the optional slots to `PaperDetailDialog`**

Extend the prop type and render fixed slots next to the existing date/signature:

```tsx
export type PaperDetailDialogProps = {
  // existing props...
  topRight?: ReactNode;
  bottomLeft?: ReactNode;
};
```

Inside `.paper-detail-paper`:

```tsx
<span className="paper-detail-date">{dateLabel}</span>
{topRight ? (
  <div className="paper-detail-top-right">{topRight}</div>
) : null}
<div className="paper-detail-scroll">...</div>
{bottomLeft ? (
  <div className="paper-detail-bottom-left">{bottomLeft}</div>
) : null}
<span className="paper-detail-signature">{signature}</span>
```

Do not change `requestClose`, Escape, focus trap, veil behavior, body scroll lock, or signature/date props.

- [ ] **Step 4: Add shared fixed-corner styles next to existing paper primitives**

In `web/src/styles.css`, include the two new classes in the absolute metadata family and use the approved small type:

```css
.paper-detail-top-right,
.paper-detail-bottom-left {
  position: absolute;
  z-index: 2;
  color: #6d6d6d;
  font-size: 13px;
  letter-spacing: 0.04em;
}

.paper-detail-top-right {
  top: 13px;
  right: 24px;
}

.paper-detail-bottom-left {
  left: 24px;
  bottom: 14px;
  max-width: calc(100% - 92px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.paper-detail-top-right button {
  min-height: 44px;
  padding: 0 4px;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
}
```

Keep `.paper-detail-date` at `top: 13px; left: 24px; font-size: 13px` and `.paper-detail-signature` at its existing right/bottom/font treatment.

- [ ] **Step 5: Run the shared paper tests and typecheck**

Run:

```bash
npx tsx --test tests/todo-paper-dialog.test.ts && npm --prefix web run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit the shared primitive slice**

```bash
git add web/src/pages/PaperDetailDialog.tsx web/src/styles.css tests/todo-paper-dialog.test.ts
git commit -m "feat: extend paper detail metadata slots"
```

---

### Task 3: Replace the Memory page header and old filter block

**Files:**
- Create: `web/src/pages/MemoryPageHeader.tsx`
- Modify: `web/src/pages/MemoryPage.tsx`
- Modify: `web/src/styles.css`
- Modify: `tests/memory-page.test.ts`

**Interfaces:**
- `MemoryPageHeader` consumes current list metadata and callbacks; it does not fetch data or mutate history itself.
- Props:

```ts
type MemoryPageHeaderProps = {
  count: number;
  categories: Array<{ value: string; label: string }>;
  tags: string[];
  category: string;
  tag: string;
  searchDraft: string;
  busy: boolean;
  onCategoryChange(value: string): void;
  onTagChange(value: string): void;
  onSearchChange(value: string): void;
  onClearFilters(): void;
  onOpenArchive(trigger: HTMLElement): void;
  onCreate(trigger: HTMLElement): void;
};
```

- [ ] **Step 1: Replace old header/filter assertions with failing new-header assertions**

In `tests/memory-page.test.ts`, add/adjust a populated-list test to assert:

```ts
assert.equal(page.container.querySelector(".page-header"), null);
assert.equal(page.container.querySelector(".memory-filters"), null);
assert.equal(page.container.querySelector(".memory-page-title")?.textContent, "Memory");
assert.match(page.container.querySelector(".memory-page-count")?.textContent ?? "", /1条记忆/);

const labels = [...page.container.querySelectorAll<HTMLButtonElement>(".memory-page-tools button")]
  .map((button) => button.getAttribute("aria-label"));
assert.deepEqual(labels, ["筛选分类", "筛选标签", "搜索记忆", "查看归档", "新增记忆"]);
```

Add interactions:

```ts
page.container.querySelector<HTMLButtonElement>('[aria-label="筛选分类"]')?.click();
assert.ok(page.container.querySelector('[role="menu"][aria-label="Memory 分类"]'));

page.container.querySelector<HTMLButtonElement>('[aria-label="搜索记忆"]')?.click();
assert.ok(page.container.querySelector('input[aria-label="搜索记忆"]'));
```

Retain existing debounce/history assertions; they must continue to drive `updateSearch` and `commitFilters` in `MemoryPageContent`.

- [ ] **Step 2: Run focused Memory tests and verify RED**

Run:

```bash
npx tsx --test tests/memory-page.test.ts tests/memory-filter-history.test.ts
```

Expected: new header assertions fail against the old `PageHeader` + `.memory-filters` UI.

- [ ] **Step 3: Implement `MemoryPageHeader` as a presentation component**

Create the component with:

- left `.memory-page-heading` containing `Memory` and `${count}条记忆`;
- right `.memory-page-tools` with exactly five 44×44 button hit targets in the approved order;
- category and tag popovers using `role="menu"` and menu buttons with current selection state;
- an internal `openMenu: "category" | "tag" | null` state;
- an internal `searchOpen` state initialized from `Boolean(searchDraft)` so a URL query is visible on first render;
- Escape closes the open popover/search shell but does not clear the query;
- explicit clear button calls `onClearFilters` only when the user chooses to clear;
- archive/create callbacks receive `event.currentTarget` so the paper trigger ref can be recorded later.

Use the existing icon set where a matching icon exists. For the category grid and `#` tag tool, use compact inline SVG/text rather than adding a dependency.

- [ ] **Step 4: Wire the new header to existing controller callbacks**

In `MemoryPage.tsx`:

- remove the `PageHeader` import and old render;
- derive count as `state.status === "ready" ? state.result.metadata.count : 0` in active-list context;
- map `availableCategories` through existing `categoryLabels`;
- category callback calls `commitFilters({ ...filters, q: searchDraft, category: value as MemoryFilterCategory })`;
- tag callback calls `commitFilters({ ...filters, q: searchDraft, tag: value })`;
- search callback remains `updateSearch(value)`;
- clear remains `commitFilters(EMPTY_MEMORY_FILTERS)`;
- archive remains `openArchive()`;
- create toggling continues to use `confirmAndDiscardDraft`, `invalidateMutationContext`, `setShowCreate`, and `setActionError` exactly as today.

Add `const paperTriggerRef = useRef<HTMLElement | null>(null);` and assign the archive/create trigger before calling those handlers. Do not move API or history responsibilities into `MemoryPageHeader`.

- [ ] **Step 5: Add mobile header/tool/popover/search CSS**

Add Memory-specific selectors under the existing mobile/Home presentation area. Required geometry:

- white background and Apple system font within `.memory-page` on mobile;
- header horizontal padding aligned with Home content;
- title near-black, medium weight;
- count light gray and smaller;
- five tool hit areas exactly `44px` square while glyphs remain visually smaller;
- popovers white, light border, restrained shadow/radius;
- search field expands full width under header with a light-gray background and no theme-color fill.

Do not alter `.mobile-top-bar` or desktop sidebar rules.

- [ ] **Step 6: Run header/filter tests and verify GREEN**

Run:

```bash
npx tsx --test tests/memory-page.test.ts tests/memory-filter-history.test.ts
```

Expected: header/popover/search tests pass and existing filter/history behavior remains green.

- [ ] **Step 7: Commit the header slice**

```bash
git add web/src/pages/MemoryPageHeader.tsx web/src/pages/MemoryPage.tsx web/src/styles.css tests/memory-page.test.ts
git commit -m "feat: redesign Memory page header"
```

---

### Task 4: Replace active Memory cards with month sections and whole-row triggers

**Files:**
- Modify: `web/src/pages/MemoryPage.tsx`
- Modify: `web/src/styles.css`
- Modify: `tests/memory-page.test.ts`
- Test: `tests/memory-presentation.test.ts`

**Interfaces:**
- Consumes `groupMemoriesByMonth`, `getMemoryRowTitle`, `formatMemoryRowDate`, `formatMemoryRowMeta` from Task 1.
- `openMemory` remains the only controller path that writes the detail URL and saves list scroll position.

- [ ] **Step 1: Add failing active-list structure tests**

Use a response containing at least two August records and one July record. Assert:

```ts
assert.equal(page.container.querySelector(".memory-message h2")?.textContent === "记忆列表", false);
assert.equal(page.container.querySelectorAll(".memory-card").length, 0);
assert.equal(page.container.textContent?.includes("查看详情"), false);

const labels = [...page.container.querySelectorAll(".memory-month-label")]
  .map((node) => node.textContent);
assert.deepEqual(labels, ["2026年8月", "2026年7月"]);

const augustRows = [...page.container.querySelectorAll(".memory-month-section")[0]
  .querySelectorAll<HTMLButtonElement>(".memory-row")];
assert.deepEqual(augustRows.map((row) => row.dataset.memoryId), ["newer-id", "older-id"]);
```

Add one record with empty key and multiline content; assert its visible row title is the first non-empty content line.

Add a no-tags record and assert row metadata is category only, without `·`.

- [ ] **Step 2: Run active-list tests and verify RED**

Run:

```bash
npx tsx --test tests/memory-presentation.test.ts tests/memory-page.test.ts
```

Expected: UI assertions fail against `.memory-grid` / `.memory-card`.

- [ ] **Step 3: Implement month-section rendering**

In the active ready branch:

```tsx
const groups = groupMemoriesByMonth(visibleMemories);
```

Render:

```tsx
<section className="memory-months" aria-label="Memory 列表">
  {groups.map((group) => (
    <section className="memory-month-section" key={group.key}>
      <h2 className="memory-month-label">{group.label}</h2>
      <div className="memory-month-card">
        {group.memories.map((memory) => (
          <button
            key={memory.id}
            type="button"
            className="memory-row"
            data-memory-id={memory.id}
            disabled={busy}
            onClick={(event) => {
              paperTriggerRef.current = event.currentTarget;
              openMemory(memory.id);
            }}
          >
            <span className="memory-row-title">{getMemoryRowTitle(memory)}</span>
            <span className="memory-row-meta">
              <span>{formatMemoryRowDate(memory.updated_at)}</span>
              <span>{formatMemoryRowMeta(memory, categoryLabels[memory.category])}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  ))}
</section>
```

Preserve the incoming array order; do not sort rows again.

- [ ] **Step 4: Replace active loading/empty/error presentation**

- Loading: render two `.memory-month-skeleton` blocks shaped like a month label + card rows.
- Empty without filters: compact text `还没有记忆`.
- Empty with q/category/tag: `没有匹配的记忆` plus a `清除筛选` control wired to `commitFilters(EMPTY_MEMORY_FILTERS)`.
- Error: compact `暂时无法读取记忆` and existing reload callback.

No large icon or old Dashboard card shell.

- [ ] **Step 5: Add month-card/row/skeleton CSS**

Use Home-derived visual values:

- one white outer card per month;
- light border and restrained shadow;
- no theme fill;
- row padding large enough for touch comfort;
- sibling divider only between rows;
- title single-line ellipsis;
- metadata flex row with left date/right category-tags and overflow protection;
- subtle `:active` background;
- month label outside the card in small secondary text.

- [ ] **Step 6: Run list tests and typecheck**

Run:

```bash
npx tsx --test tests/memory-presentation.test.ts tests/memory-page.test.ts && npm --prefix web run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the active-list slice**

```bash
git add web/src/pages/MemoryPage.tsx web/src/styles.css tests/memory-page.test.ts
git commit -m "feat: group Memory list by month"
```

---

### Task 5: Move active detail, edit, and create into the shared paper shell

**Files:**
- Modify: `web/src/pages/MemoryPage.tsx`
- Modify: `web/src/styles.css`
- Modify: `tests/memory-page.test.ts`
- Test: `tests/todo-paper-dialog.test.ts`

**Interfaces:**
- Consumes `PaperDetailDialog` optional corner slots from Task 2.
- Consumes `formatMemoryPaperDate` and `formatMemoryRowMeta` from Task 1.
- Uses fixed `signature="N"`.
- Existing handlers remain authoritative: `handleCreate`, `handleUpdate`, `handleArchive`, `openMemory`, `closeMemory`, dirty-state helpers, and quick-create effect.

- [ ] **Step 1: Add failing active paper tests**

In `tests/memory-page.test.ts`, for active detail assert:

```ts
const dialog = page.container.querySelector<HTMLElement>('[role="dialog"]');
assert.ok(dialog);
assert.equal(dialog.classList.contains("paper-detail-paper"), true);
assert.equal(dialog.querySelector(".paper-detail-signature")?.textContent, "N");
assert.match(dialog.querySelector(".paper-detail-top-right")?.textContent ?? "", /归档.*编辑/);
assert.match(dialog.querySelector(".paper-detail-bottom-left")?.textContent ?? "", /Goal/);
assert.equal(page.container.querySelector(".memory-detail"), null);
```

Add detail-title behavior:

- non-empty key is visible as `.memory-paper-title`;
- empty key produces no `.memory-paper-title`; full content still renders.

Add edit assertions after clicking `编辑`:

```ts
assert.ok(dialog.querySelector('textarea[aria-label="编辑记忆内容"]'));
assert.ok(dialog.querySelector('input[aria-label="编辑记忆标签"]'));
assert.equal(dialog.querySelector('input[aria-label="编辑记忆 Key"]'), null);
assert.equal(dialog.querySelector('select[aria-label="编辑记忆分类"]'), null);
assert.match(dialog.querySelector(".paper-detail-top-right")?.textContent ?? "", /取消.*保存/);
```

Add create assertions after clicking the pen tool:

```ts
const createDialog = page.container.querySelector('[role="dialog"]');
assert.ok(createDialog);
assert.ok(createDialog.querySelector('input[placeholder="Key"]'));
assert.ok(createDialog.querySelector('textarea[placeholder="Content"]'));
assert.equal(createDialog.querySelector(".paper-detail-signature")?.textContent, "N");
```

Keep the existing quick-create focus test and update it to expect the key input inside the dialog.

- [ ] **Step 2: Run focused active-paper tests and verify RED**

Run:

```bash
npx tsx --test tests/memory-page.test.ts tests/todo-paper-dialog.test.ts
```

Expected: Memory paper assertions fail; Todo paper tests stay green.

- [ ] **Step 3: Render active detail with `PaperDetailDialog`**

Replace `MemoryDetail`'s old `.memory-message memory-detail` shell. For ready state:

```tsx
<PaperDetailDialog
  id={`memory-paper-${memory.id}`}
  open
  label={`Memory ${getMemoryRowTitle(memory)}`}
  dateLabel={formatMemoryPaperDate(memory.updated_at)}
  signature="N"
  triggerRef={paperTriggerRef}
  onRequestClose={() => {
    if (!confirmAndDiscardDraft()) return false;
    closeMemory(true);
    return true;
  }}
  topRight={editing ? editActions : detailActions}
  bottomLeft={formatMemoryRowMeta(memory, categoryLabels[memory.category])}
  errorMessage={actionError || null}
>
  {paperBody}
</PaperDetailDialog>
```

Important: `closeMemory(true)` is used only after the paper's `onRequestClose` has already performed the unsaved-change decision; this prevents a duplicate confirm. Do not remove `closeMemory` safety for other call sites.

Detail top-right actions:

- `归档` calls existing `handleArchive(memory.id, memory.key)`;
- separator text `·`;
- `编辑` seeds `editingId`, `editingContent`, `editingTags` exactly as today.

Edit top-right actions:

- `取消` uses existing confirm/discard logic;
- separator `·`;
- `保存` calls `handleUpdate(memory.id)` and respects `updatingId` / empty-content disable state.

- [ ] **Step 4: Render create inside `PaperDetailDialog`**

Keep `showCreate` state and existing create fields/handlers. Replace the old `.memory-message` form with:

```tsx
<PaperDetailDialog
  id="memory-create-paper"
  open={showCreate}
  label="创建 Memory"
  dateLabel={formatMemoryPaperDate(new Date().toISOString())}
  signature="N"
  triggerRef={paperTriggerRef}
  onRequestClose={() => {
    if (!confirmAndDiscardDraft()) return false;
    setShowCreate(false);
    setActionError("");
    return true;
  }}
  topRight={createActions}
  bottomLeft={categoryLabels[category]}
  errorMessage={actionError || null}
>
  <div className="memory-paper-form">...</div>
</PaperDetailDialog>
```

The create form retains:

- category selector;
- key input with existing `createKeyInput` ref;
- content textarea;
- tags input;
- current field labels/placeholders used by tests.

Move save/cancel actions to the paper top-right small-control area; do not add large bottom buttons.

- [ ] **Step 5: Keep loading/error detail states compact without breaking direct links**

For `DetailState` loading/error before a ready record exists, render a compact Memory status block in the page so direct `/memory?id=...` navigation still communicates state. Once ready, replace it with the paper dialog.

The detail fetch, URL, return path, and reload effects remain unchanged.

- [ ] **Step 6: Add Memory paper body/form CSS**

Add only Memory content styling inside the shared paper geometry:

- `.memory-paper-title`: restrained larger text, no giant heading;
- `.memory-paper-content`: preserve newlines with `white-space: pre-wrap`, readable line height;
- `.memory-paper-form`: compact transparent controls compatible with lined paper;
- `.memory-paper-control` buttons: borderless, background transparent, same 13px metadata family;
- read-only key/category may be shown as muted text in edit mode, not editable fields;
- ensure fixed top/bottom metadata does not overlap scroll body padding.

Do not duplicate `.paper-detail-paper`, `.paper-detail-date`, or `.paper-detail-signature` geometry.

- [ ] **Step 7: Run active Memory lifecycle tests, Todo paper tests, and typecheck**

Run:

```bash
npx tsx --test tests/memory-page.test.ts tests/memory-detail-service.test.ts tests/memory-filter-history.test.ts tests/memory-scroll-restoration.test.ts tests/todo-paper-dialog.test.ts && npm --prefix web run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit the active-paper slice**

```bash
git add web/src/pages/MemoryPage.tsx web/src/styles.css tests/memory-page.test.ts
git commit -m "feat: move Memory editing into paper view"
```

---

### Task 6: Apply the month/paper system to archived Memory

**Files:**
- Modify: `web/src/pages/MemoryPage.tsx`
- Modify: `web/src/styles.css`
- Modify: `tests/memory-page.test.ts`

**Interfaces:**
- Archive list consumes the same Task 1 grouping/row helpers.
- Archived detail consumes the same `PaperDetailDialog` shell.
- Existing `openArchive`, `closeArchive`, `openArchivedMemory`, `closeArchivedMemory`, and `restoreArchivedMemory` remain authoritative.

- [ ] **Step 1: Add failing archive presentation tests**

For archive list assert:

```ts
assert.equal(page.container.querySelectorAll(".memory-card").length, 0);
assert.ok(page.container.querySelector(".memory-archive-header"));
assert.ok(page.container.querySelector(".memory-month-card"));
assert.equal(page.container.textContent?.includes("查看详情"), false);
```

Click an archived row and assert ready archived detail becomes a paper:

```ts
const dialog = page.container.querySelector('[role="dialog"]');
assert.ok(dialog);
assert.equal(dialog.querySelector(".paper-detail-signature")?.textContent, "N");
assert.match(dialog.querySelector(".paper-detail-top-right")?.textContent ?? "", /恢复/);
assert.equal(dialog.querySelector('textarea[aria-label="编辑记忆内容"]'), null);
```

Retain existing restore request assertions, duplicate-submission prevention, and active-list return behavior.

- [ ] **Step 2: Run archive-focused tests and verify RED**

Run:

```bash
npx tsx --test tests/memory-page.test.ts
```

Expected: archive presentation assertions fail against the old archive grid/detail block.

- [ ] **Step 3: Render archive list with the same month sections/rows**

Replace `ArchivedMemoryList`'s `.memory-grid` with Task 4's month-section structure. Use the same row title/date/meta rules and whole-row button trigger. On row click:

```tsx
paperTriggerRef.current = event.currentTarget;
openArchivedMemory(memory.id);
```

Archive header contains:

- `Archive` or `已归档记忆` title;
- `${count}条记忆` secondary count;
- one concise return control wired to `closeArchive`;
- no category, tag, search, or create controls.

Use the same compact loading/empty/error style family.

- [ ] **Step 4: Render archived detail as a read-only paper**

For ready archived detail:

```tsx
<PaperDetailDialog
  id={`memory-archive-paper-${memory.id}`}
  open
  label={`已归档 Memory ${getMemoryRowTitle(memory)}`}
  dateLabel={formatMemoryPaperDate(memory.updated_at)}
  signature="N"
  triggerRef={paperTriggerRef}
  onRequestClose={() => {
    closeArchivedMemory();
    return true;
  }}
  topRight={restoreAction}
  bottomLeft={formatMemoryRowMeta(memory, categoryLabels[memory.category])}
  errorMessage={actionError || null}
>
  {memory.key.trim() ? <h2 className="memory-paper-title">{memory.key}</h2> : null}
  <p className="memory-paper-content">{memory.content}</p>
</PaperDetailDialog>
```

`恢复` calls existing `restoreArchivedMemory(memory.id)` and displays disabled/busy state from `restoringId`. No edit controls exist in archive detail.

- [ ] **Step 5: Run archive/lifecycle tests and typecheck**

Run:

```bash
npx tsx --test tests/memory-page.test.ts tests/memory-detail-service.test.ts tests/memory-scroll-restoration.test.ts && npm --prefix web run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the archive slice**

```bash
git add web/src/pages/MemoryPage.tsx web/src/styles.css tests/memory-page.test.ts
git commit -m "feat: redesign archived Memory views"
```

---

### Task 7: Remove obsolete Memory presentation paths and run regression gates

**Files:**
- Modify: `web/src/pages/MemoryPage.tsx`
- Modify: `web/src/styles.css`
- Modify: `tests/memory-page.test.ts`
- Test: all existing Memory/Todo/full-suite tests

**Interfaces:**
- No new public interface.
- This task removes only render helpers/selectors made unreachable by Tasks 3–6.

- [ ] **Step 1: Add a focused regression assertion against old presentation classes/copy**

In `tests/memory-page.test.ts`, for ready active and archive states assert absence of:

```ts
assert.equal(page.container.querySelector(".memory-grid"), null);
assert.equal(page.container.querySelector(".memory-card"), null);
assert.equal(page.container.querySelector(".memory-filters"), null);
assert.doesNotMatch(page.container.textContent ?? "", /记忆列表|查看详情/);
```

Do not forbid `.memory-message` globally until loading/error direct-link states are inspected; compact status rendering may still intentionally use a renamed or retained status primitive.

- [ ] **Step 2: Run focused tests before cleanup**

Run:

```bash
npx tsx --test tests/memory-presentation.test.ts tests/memory-page.test.ts tests/todo-paper-dialog.test.ts
```

Expected: PASS before cleanup.

- [ ] **Step 3: Remove unreachable old UI helpers and selectors**

From `MemoryPage.tsx`, remove only functions no longer referenced after the redesign, such as old card-only `MemoryMetadata`, `MemoryTags`, or old `MemoryLoading` implementations when replacement equivalents fully cover their behavior.

From `styles.css`, remove obsolete Memory-specific Dashboard selectors only after confirming no other page/test references them. Keep shared classes used by Diary/Task/other pages.

Run repository text search locally before deleting a selector:

```bash
grep -R "memory-grid\|memory-card\|memory-filters" web/src tests --exclude=styles.css
```

Expected: only intentional negative assertions or no runtime references.

- [ ] **Step 4: Run all focused Memory tests**

Run:

```bash
npx tsx --test \
  tests/memory-presentation.test.ts \
  tests/memory-page.test.ts \
  tests/memory-detail-service.test.ts \
  tests/memory-filter-history.test.ts \
  tests/memory-location.test.ts \
  tests/memory-scroll-restoration.test.ts \
  tests/todo-paper-dialog.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run Web typecheck**

```bash
npm --prefix web run typecheck
```

Expected: `tsc -b` exits 0.

- [ ] **Step 6: Run the full repository test suite**

```bash
npm test
```

Expected: 0 failures. Existing intentional skips may remain.

- [ ] **Step 7: Run diff and staging safety checks**

```bash
git diff --check && git status --short
```

Expected: no diff-check errors. `web/preview.html` and `web/src/preview-main.tsx` remain untracked (`??`) and unstaged.

- [ ] **Step 8: Inspect the feature diff against the base**

```bash
git diff --stat codex/phase-6-web-ui-foundation...HEAD && git diff --check codex/phase-6-web-ui-foundation...HEAD
```

Confirm the diff is limited to the Memory redesign, shared paper-slot extension, focused tests, design spec, and this implementation plan.

- [ ] **Step 9: Commit cleanup if Step 3 changed tracked files**

```bash
git add web/src/pages/MemoryPage.tsx web/src/styles.css tests/memory-page.test.ts
git commit -m "refactor: remove obsolete Memory presentation"
```

If Step 3 produced no tracked changes, do not create an empty commit.

---

### Task 8: Mobile visual acceptance before integration

**Files:**
- No tracked file is required unless visual acceptance exposes a defect.
- Untracked preview helpers may be edited only for local preview routing and must remain untracked.

**Interfaces:**
- Acceptance target: `393 × 852`.

- [ ] **Step 1: Start or confirm the existing Vite preview path**

Use the existing local preview approach that bypasses unavailable auth without changing tracked app behavior. Do not stage preview helpers.

- [ ] **Step 2: Verify active Memory at 393 × 852**

Check all of the following manually:

- global mobile top bar unchanged;
- `Memory` + `n条记忆` hierarchy;
- five tools in category / tag / search / archive / pen order;
- 44px tool hit areas without oversized glyphs;
- category popover selection and close;
- tag popover selection and close;
- search expansion, clear, and non-destructive close;
- multiple month labels/cards;
- one-row and multi-row month cards;
- long title and long category/tags truncation;
- whole-row press/click behavior;
- unfiltered empty, filtered empty, loading, and request error states when preview fixtures permit.

- [ ] **Step 3: Verify active paper flows**

Check:

- detail paper geometry matches Todo;
- top-left date/time matches Todo metadata typography;
- top-right `归档 · 编辑` uses the same small metadata language;
- bottom-left `category · tags` uses the same small metadata language;
- bottom-right `N` matches Todo signature typography/placement;
- long content scrolls while all four corner metadata areas stay fixed;
- edit stays inside the same paper;
- only content/tags are editable;
- create opens the same paper system and quick-create focus still works;
- close/escape/back preserve unsaved-change protection.

- [ ] **Step 4: Verify archive flows**

Check:

- archive list uses month cards/rows;
- active-list filter/search tools are absent in archive mode;
- archived detail uses the same paper and fixed `N` signature;
- no edit control exists;
- restore works and returns to active Memory according to existing behavior.

- [ ] **Step 5: Verify return state**

From a filtered/scrolled active list:

1. apply category/tag/query;
2. scroll down;
3. open a Memory;
4. close the paper;
5. confirm the same URL filters and prior scroll position are restored.

Repeat archive list → archived detail → close for archive scroll restoration.

- [ ] **Step 6: Re-run automated verification after any visual fix**

If visual acceptance required tracked code changes, rerun:

```bash
npx tsx --test tests/memory-presentation.test.ts tests/memory-page.test.ts tests/todo-paper-dialog.test.ts && npm --prefix web run typecheck && npm test && git diff --check && git status --short
```

Expected: focused tests green, typecheck green, full suite 0 failures, preview helpers still only untracked.

- [ ] **Step 7: Stop before merge/push integration**

Do not merge, delete the feature branch, or move the base branch until the human has accepted the mobile visual result and the finishing-a-development-branch workflow has been invoked.
