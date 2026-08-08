# Memory Paper Interaction Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the accepted Memory mobile design fully into the Home/Todo interaction language: refined header tools, stationary list background under papers, paper-native create/edit, editable key/category/content/tags, and archive geometry that matches the active Memory page.

**Architecture:** Keep the current Memory URL/history, request invalidation, scroll restoration, mutation gate/ownership, archive lifecycle, and shared `PaperDetailDialog`. Extend only the authenticated Web update path so an active Memory can update its existing `key` and `category` fields. On mobile, keep the active list mounted while detail/edit/create papers overlay it, introduce a Memory-specific paper editor rather than reusing Todo row semantics, and reuse the same active month-card geometry for Archive.

**Tech Stack:** React 19, TypeScript, React Router DOM, Express, Drizzle ORM/PostgreSQL, CSS, Node test runner (`tsx --test`).

## Global Constraints

- Mobile acceptance viewport is `393 × 852`.
- Desktop Memory presentation is not redesigned.
- Global `MobileTopBar` is unchanged.
- The Memory page uses the already-accepted Home mobile shell: pure white background, `width: min(860px, calc(100% - 48px))`, centered content, and no duplicated horizontal padding.
- Header tool order remains category → tags → search → archive → create.
- Every page tool retains a `44 × 44px` tap target while the glyph stays visually smaller than the global top-bar controls.
- Active detail/edit/create keeps the active Memory list visually stationary underneath the paper; no detail-page `PageHeader` replaces the list.
- Memory detail/edit/create/archive detail reuse `PaperDetailDialog`; Memory must not override Todo paper width, height, viewport placement, date position/typography, or signature position/typography.
- Existing active Memory edit supports `key`, `category`, `content`, and `tags`; category is restricted to `profile | preference | goal | project`.
- Archived Memory records remain read-only; restore behavior remains unchanged.
- Bottom-right signature remains fixed `N` in this batch.
- Existing URL/history semantics, 300ms search debounce, latest-request invalidation, scroll restoration, quick-create intent, unsaved-change protection, mutation single-flight gate/ownership, and authenticated ownership checks must remain.
- No database schema migration, new Memory endpoint, MCP Memory contract change, archived editing, or signature persistence.
- `web/preview.html` and `web/src/preview-main.tsx` are local-only untracked visual-acceptance helpers and must never be staged or committed.

---

### Task 1: Extend the authenticated Web Memory update contract

**Files:**
- Modify: `src/domains/memory/memory-repository.ts`
- Modify: `src/domains/memory/memory-service.ts`
- Modify: `src/web-api/memory-router.ts`
- Modify: `tests/memory-service.test.ts`
- Modify: `tests/memory-lifecycle-repository.integration.test.ts`
- Modify: `tests/web-memory-api.test.ts`

**Interfaces:**
- Consumes: existing `MemoryCategory`, `MemoryRepository.updateMemory`, `MemoryService.updateMemory`, `PATCH /memory`.
- Produces: `UpdateMemoryInput` carrying `{ userId, id, key, category, content, tags? }`; the router forwards all four editable fields; repository update remains restricted to the authenticated user's active assistant-visible record.

- [ ] **Step 1: Write service RED tests for key/category validation and forwarding**

Add focused `MemoryService.updateMemory` tests that call:

```ts
await service.updateMemory({
  userId: "user-1",
  id: "memory-1",
  key: "new_key",
  category: "project",
  content: "updated content",
  tags: ["one", "two"],
});
```

Assert the repository receives trimmed/validated `key`, legal `category`, trimmed `content`, and normalized tags. Add failure cases for blank/over-100-char key and an unsupported category, expecting the existing `INVALID_MEMORY_KEY` and `INVALID_MEMORY_CATEGORY` domain codes.

- [ ] **Step 2: Run the service tests and verify RED**

Run:

```bash
npx tsx --test --test-name-pattern="updateMemory" tests/memory-service.test.ts
```

Expected: FAIL because `UpdateMemoryInput` and `updateMemory` do not yet accept/forward `key` and `category`.

- [ ] **Step 3: Extend service and repository types minimally**

Change both update input types to:

```ts
export type UpdateMemoryInput = {
  userId: string;
  id: string;
  key: string;
  category: MemoryCategory;
  content: string;
  tags?: readonly string[];
};
```

In `MemoryService.updateMemory`, normalize key with `normalizeRequiredText(..., MAX_KEY_LENGTH, "INVALID_MEMORY_KEY")`, validate the one category through the existing category validator, normalize content with `normalizeRequiredText(..., MAX_CONTENT_LENGTH, "INVALID_MEMORY_CONTENT")`, and normalize tags when supplied. Preserve `MEMORY_NOT_FOUND` behavior.

In `DrizzleMemoryRepository.updateMemory`, set:

```ts
.set({
  key: input.key,
  category: input.category,
  content: input.content,
  ...(input.tags === undefined ? {} : { tags: input.tags }),
  updatedAt: new Date(),
})
```

Keep the existing `id + userId + status=active + visibility=assistant` predicate unchanged.

- [ ] **Step 4: Run service tests and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Write repository integration RED test**

Add a test that creates/uses an active assistant Memory, calls repository `updateMemory` with a new key/category/content/tags, then reads it back and asserts all four fields changed. Also assert an archived or other-user record is not changed by the same method.

- [ ] **Step 6: Run repository integration test and verify behavior**

Run:

```bash
npx tsx --test --test-name-pattern="updates.*key.*category|updateMemory" tests/memory-lifecycle-repository.integration.test.ts
```

Expected after Step 3: PASS. If the test reveals a real persistence constraint, stop and diagnose before changing behavior.

- [ ] **Step 7: Write Web API RED test for the expanded PATCH body**

In `tests/web-memory-api.test.ts`, assert authenticated `PATCH /memory` forwards:

```ts
{
  userId: "user-1",
  id: "memory-1",
  key: "renamed_key",
  category: "goal",
  content: "changed",
  tags: ["a"]
}
```

Also keep the existing unauthenticated/404/error mappings intact.

- [ ] **Step 8: Run Web API test and verify RED**

```bash
npx tsx --test --test-name-pattern="PATCH|update" tests/web-memory-api.test.ts
```

Expected: FAIL because the router currently forwards only `id/content/tags`.

- [ ] **Step 9: Extend the router dependency contract and PATCH forwarding**

Update `MemoryApiDependencies.memoryService.updateMemory` and `createUpdateMemoryApiHandler` to pass `request.body.key` and `request.body.category` in addition to existing fields. Do not add a route.

- [ ] **Step 10: Run Task 1 verification and commit**

```bash
npx tsx --test tests/memory-service.test.ts tests/memory-lifecycle-repository.integration.test.ts tests/web-memory-api.test.ts && git diff --check
git add src/domains/memory/memory-repository.ts src/domains/memory/memory-service.ts src/web-api/memory-router.ts tests/memory-service.test.ts tests/memory-lifecycle-repository.integration.test.ts tests/web-memory-api.test.ts
git commit -m "feat: expand Memory web editing fields"
```

---

### Task 2: Refine Memory header icons and the single search surface

**Files:**
- Modify: `web/src/components/icons.tsx`
- Modify: `web/src/pages/MemoryPageHeader.tsx`
- Modify: `web/src/styles.css`
- Modify: `tests/memory-page.test.ts`
- Modify: `tests/memory-list-styles.test.ts`

**Interfaces:**
- Consumes: `MemoryPageHeader` props and existing shared SVG icon conventions.
- Produces: explicit four-square category glyph, visually balanced search glyph, clear archive-box glyph, horizontally mirrored create pen, and one focus surface for expanded search.

- [ ] **Step 1: Write header structure RED tests**

Add assertions that `MemoryPageHeader` renders, in order, buttons with accessible names `筛选分类`, `筛选标签`, `搜索记忆`, `查看归档`, `新增记忆`; that category contains an SVG/data marker representing four independent square elements; and that search/archive/create use SVG icons instead of the current text glyphs `⌕`, `▣`, `✎`.

- [ ] **Step 2: Run focused header test and verify RED**

```bash
npx tsx --test --test-name-pattern="Memory.*header|header.*Memory" tests/memory-page.test.ts
```

Expected: FAIL on current text glyph implementation.

- [ ] **Step 3: Add/refine shared icon components and wire the header**

In `icons.tsx`, add a Memory category-grid icon made from four separate small `<rect>` elements. Reuse/refine `SearchIcon` and `ArchiveIcon` so the archive reads as a storage box/tray. Add a pen icon if no suitable shared icon exists. In `MemoryPageHeader`, render the SVG components. Apply horizontal mirroring to only the pen glyph with a Memory-specific class or SVG transform; do not reverse button order or hit-box geometry.

- [ ] **Step 4: Write search-surface CSS RED assertions**

Lock that `.memory-page-search` owns the light-gray surface and its inner `input[type="search"]` has transparent background, no border, no box-shadow, and no outline/focus ring rectangle. Lock a larger search SVG size/visual weight that matches neighboring glyphs while all parent buttons stay `44px` hit targets.

- [ ] **Step 5: Run style test and verify RED**

```bash
npx tsx --test tests/memory-list-styles.test.ts
```

Expected: FAIL because the current native search input still creates a second visible field/focus surface and current glyph sizing is not locked.

- [ ] **Step 6: Implement minimal mobile CSS**

Keep `.memory-page-search` as the sole visible rounded/light-gray field. Set the child search input to transparent/no border/no shadow, suppress WebKit search-decoration chrome where needed, and keep keyboard focus discoverable by applying focus-visible treatment to the outer search shell rather than drawing a second inner rectangle.

- [ ] **Step 7: Run Task 2 verification and commit**

```bash
npx tsx --test tests/memory-page.test.ts tests/memory-list-styles.test.ts && npm --prefix web run typecheck && git diff --check
git add web/src/components/icons.tsx web/src/pages/MemoryPageHeader.tsx web/src/styles.css tests/memory-page.test.ts tests/memory-list-styles.test.ts
git commit -m "style: refine Memory mobile tools"
```

---

### Task 3: Keep the active Memory list stationary underneath detail papers

**Files:**
- Modify: `web/src/pages/MemoryPage.tsx`
- Modify: `tests/memory-page.test.ts`
- Modify: `tests/memory-scroll-restoration.test.ts`

**Interfaces:**
- Consumes: existing list `state`, `location.memoryId`, `PaperDetailDialog`, `createMemoryDetailLocation`, scroll storage helpers.
- Produces: active list remains mounted during active detail; detail fetch overlays it without calling `window.scrollTo({ top: 0 })`; closing detail returns to the same filtered/scrolled list without forcing a list reload.

- [ ] **Step 1: Write DOM RED test for stationary background**

Render an active list with at least two month groups, open a row, resolve `/memory/:id`, then assert the DOM simultaneously contains the active `.memory-page-header`, `.memory-months`/clicked row, and `#memory-detail-paper`. Assert no legacy detail `PageHeader`/`返回记忆列表` button appears.

- [ ] **Step 2: Write scroll RED test**

Start at a non-zero `window.scrollY`, click a row, resolve detail, and assert opening detail does not call/reset scroll to `0`. Close the paper and assert the list remains at/restores the saved position without refetching merely because detail closed.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npx tsx --test --test-name-pattern="stationary|background|scroll" tests/memory-page.test.ts tests/memory-scroll-restoration.test.ts
```

Expected: FAIL because current rendering replaces the active list with the detail branch and the detail effect calls `window.scrollTo({ top: 0 })`.

- [ ] **Step 4: Keep active list request/state alive while active detail is open**

Change the active-list request effect so `isDetail` alone does not abort or suppress the list. It may still suppress active list requests when Archive or archived detail owns the page. Remove `isDetail` from conditions/dependencies that cause an unnecessary list reset.

- [ ] **Step 5: Render active list first and overlay detail second**

For the active Memory context, always render `MemoryPageHeader` plus active loading/error/empty/month content. Render `MemoryDetail` as an additional sibling overlay when `isDetail` is true. Remove the detail-only `PageHeader` branch. Keep `paperTriggerRef` focus restoration.

- [ ] **Step 6: Stop detail fetch from changing page scroll**

Remove the active-detail `window.scrollTo({ top: 0 })`. Let `PaperDetailDialog` lock body overflow while open. On close, restore URL/history and state without setting the already-valid active list to `loading` solely because the overlay closed.

- [ ] **Step 7: Run Task 3 verification and commit**

```bash
npx tsx --test tests/memory-page.test.ts tests/memory-scroll-restoration.test.ts tests/memory-filter-history.test.ts tests/memory-location.test.ts && npm --prefix web run typecheck && git diff --check
git add web/src/pages/MemoryPage.tsx tests/memory-page.test.ts tests/memory-scroll-restoration.test.ts
git commit -m "fix: keep Memory list behind detail paper"
```

---

### Task 4: Introduce a Memory-native borderless paper editor

**Files:**
- Create: `web/src/pages/MemoryPaperEditor.tsx`
- Modify: `web/src/styles.css`
- Create: `tests/memory-paper-editor.test.ts`
- Modify: `tests/memory-paper-styles.test.ts`

**Interfaces:**
- Consumes: `MemoryCategory = "profile" | "preference" | "goal" | "project"` and the existing paper slots.
- Produces: reusable controlled editor for `key`, `category`, `content`, `tags`; an imperative `focusKey()` handle for quick-create; no conventional boxed form chrome.

Define the editor contract as:

```ts
export type MemoryPaperEditorHandle = {
  focusKey(): void;
};

export type MemoryPaperEditorProps = {
  keyValue: string;
  category: MemoryCategory;
  content: string;
  tagsValue: string;
  disabled: boolean;
  onKeyChange(value: string): void;
  onCategoryChange(value: MemoryCategory): void;
  onContentChange(value: string): void;
  onTagsChange(value: string): void;
};
```

- [ ] **Step 1: Write component RED tests**

Test that the editor exposes a title-position key textarea/input, body-position content textarea, bottom-left metadata controls, and a category menu with exactly Profile/Preference/Goal/Project. Assert the component source/DOM contains no `<select>` and no generic stacked `.memory-paper-form` field wrappers. Assert changing each field calls the corresponding controlled callback.

- [ ] **Step 2: Run the new component test and verify RED**

```bash
npx tsx --test tests/memory-paper-editor.test.ts
```

Expected: FAIL because `MemoryPaperEditor` does not exist.

- [ ] **Step 3: Implement the controlled paper editor**

Create a dedicated component rather than reusing `TodoPaperEditor` row/status semantics. Key is always the first/title region and uses title typography even when it wraps. Content is a transparent borderless textarea in the paper body. Bottom-left metadata shows category and tags; category opens a lightweight anchored menu of the four legal values; tags switch to a small transparent inline editor in the same metadata position. No visible rectangular input/select/textarea borders are allowed.

Expose `focusKey()` with `forwardRef/useImperativeHandle` so quick-create can focus the title position once.

- [ ] **Step 4: Write CSS RED assertions for paper-native controls**

Lock transparent background, `border: 0`, `box-shadow: none`, inherited font/color, `resize: none`, and title typography for the key editor. Lock long-key wrapping without font-size reduction. Lock category popover as lightweight/anchored and metadata-sized.

- [ ] **Step 5: Run style test and verify RED**

```bash
npx tsx --test tests/memory-paper-styles.test.ts
```

Expected: FAIL until the new classes are styled.

- [ ] **Step 6: Implement styles without changing shared paper geometry**

Add only Memory field/editor styles. Do not modify `.paper-detail-paper`, `.paper-detail-date`, `.paper-detail-signature` geometry for Memory-specific reasons.

- [ ] **Step 7: Run Task 4 verification and commit**

```bash
npx tsx --test tests/memory-paper-editor.test.ts tests/memory-paper-styles.test.ts && npm --prefix web run typecheck && git diff --check
git add web/src/pages/MemoryPaperEditor.tsx web/src/styles.css tests/memory-paper-editor.test.ts tests/memory-paper-styles.test.ts
git commit -m "feat: add Memory paper-native editor"
```

---

### Task 5: Wire active detail edit and create into the paper-native editor

**Files:**
- Modify: `web/src/pages/MemoryPage.tsx`
- Modify: `tests/memory-page.test.ts`
- Modify: `tests/memory-detail-service.test.ts`

**Interfaces:**
- Consumes: Task 1 expanded PATCH contract and Task 4 `MemoryPaperEditor`.
- Produces: active edit and create happen directly on the paper; edit sends `{ id, key, category, content, tags }`; dirty-state protection includes key/category/content/tags; quick-create focuses the key title.

- [ ] **Step 1: Write active-edit RED test**

Open an active detail, click `编辑`, and assert the same `#memory-detail-paper` remains open while key/category/content/tags become editable through `MemoryPaperEditor`. Assert no `.memory-paper-form`, boxed `select`, or legacy labeled field stack appears. Change all four fields, click Save, and assert PATCH body equals:

```ts
{
  id: "memory-1",
  key: "renamed_key",
  category: "project",
  content: "new body",
  tags: ["alpha", "beta"]
}
```

- [ ] **Step 2: Write dirty-state RED coverage**

Assert changing only key or only category marks edit dirty and triggers the existing unsaved-close confirmation. Cancel must restore the fetched values. Save failure must keep the paper open with the inline paper error.

- [ ] **Step 3: Run active-edit tests and verify RED**

```bash
npx tsx --test --test-name-pattern="Memory.*edit|editing|PATCH|unsaved" tests/memory-page.test.ts tests/memory-detail-service.test.ts
```

Expected: FAIL because current edit tracks only content/tags and renders a conventional form.

- [ ] **Step 4: Expand edit controller state**

Track `editingKey` and `editingCategory` alongside content/tags. Include all four values in `editDirty`, discard/reset paths, popstate cleanup, and `handleUpdate`. Keep content and key required before Save; category must always be one legal enum.

- [ ] **Step 5: Replace detail edit form with `MemoryPaperEditor`**

Read-only detail still renders title/body and bottom-left metadata. Edit mode swaps those same paper positions to the controlled editor, while top-right becomes `取消 · 保存`. Keep top-left date and bottom-right `N` provided by the same `PaperDetailDialog`.

- [ ] **Step 6: Write create RED test**

Click the mirrored pen and assert `#memory-create-paper` opens directly in editor mode: first/title area key, body content, editable bottom-left category/tags, no boxed field stack. Assert key/content are required, create POST remains `{ category, key, content, tags }`, and quick-create calls the editor's key focus once.

- [ ] **Step 7: Run create test and verify RED**

```bash
npx tsx --test --test-name-pattern="create|quick-create|新增" tests/memory-page.test.ts
```

Expected: FAIL against the current `<select>` + labeled input/textarea form.

- [ ] **Step 8: Replace create form with `MemoryPaperEditor`**

Reuse existing create state values and mutation protections. Use `MemoryPaperEditorHandle.focusKey()` in the existing one-shot quick-create focus effect. Bottom-right remains `N` and top-right remains concise `取消 · 保存`.

- [ ] **Step 9: Run Task 5 verification and commit**

```bash
npx tsx --test tests/memory-page.test.ts tests/memory-detail-service.test.ts tests/memory-paper-editor.test.ts tests/memory-paper-styles.test.ts tests/web-unsaved-changes.test.ts && npm --prefix web run typecheck && git diff --check
git add web/src/pages/MemoryPage.tsx tests/memory-page.test.ts tests/memory-detail-service.test.ts
git commit -m "feat: edit Memory directly on paper"
```

---

### Task 6: Make Archive use the same header and month geometry as active Memory

**Files:**
- Modify: `web/src/pages/MemoryPage.tsx`
- Modify: `web/src/styles.css`
- Modify: `tests/memory-page.test.ts`
- Modify: `tests/memory-list-styles.test.ts`

**Interfaces:**
- Consumes: existing `ArchivedMemoryList`, active `.memory-page-heading`, `.memory-page-title`, `.memory-page-count`, `.memory-months`, `.memory-month-card`, `.memory-row` styles.
- Produces: title `Archive`, identical title/count geometry to active Memory, compact borderless return text with a 44px tap target, and identical first-month/card vertical start.

- [ ] **Step 1: Write Archive header RED tests**

Open Archive and assert title text is exactly `Archive`, subtitle is `${count}条记忆`, and the return control is text-only with an accessible name. Assert Archive does not render active category/tag/search/archive/create tools.

- [ ] **Step 2: Write geometry RED style assertions**

Assert Archive reuses the active heading/title/count classes or an explicitly shared class set. Assert the return control has no border/background but keeps `min-width`/`min-height: 44px` or equivalent tap geometry. Assert Archive month content uses `.memory-months`, `.memory-month-section`, `.memory-month-card`, `.memory-row` without archive-specific top padding/margins that shift the first month/card.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npx tsx --test --test-name-pattern="Archive|archive" tests/memory-page.test.ts tests/memory-list-styles.test.ts
```

Expected: FAIL on current `已归档记忆` copy and archive-specific header spacing.

- [ ] **Step 4: Refactor Archive header to shared Memory geometry**

Render the same heading structure as active Memory with title `Archive` and count below it. Place the borderless return text control on the right at the same visual level as active tools. Keep loading/empty/error Archive states inside the same header shell so the user never loses the return control.

- [ ] **Step 5: Remove archive-only list offsets**

Use the same active month-list classes and vertical padding for ready/loading/empty/error families where applicable. Do not change card row typography or archived detail behavior.

- [ ] **Step 6: Run Task 6 verification and commit**

```bash
npx tsx --test tests/memory-page.test.ts tests/memory-list-styles.test.ts tests/memory-scroll-restoration.test.ts && npm --prefix web run typecheck && git diff --check
git add web/src/pages/MemoryPage.tsx web/src/styles.css tests/memory-page.test.ts tests/memory-list-styles.test.ts
git commit -m "style: align Memory archive with active view"
```

---

### Task 7: Lock shared paper geometry and remove obsolete Memory form/detail presentation

**Files:**
- Modify: `tests/memory-paper-styles.test.ts`
- Modify: `tests/paper-detail-memory-slots.test.ts`
- Modify: `tests/memory-page.test.ts`
- Modify: `web/src/pages/MemoryPage.tsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: shared `PaperDetailDialog` and Tasks 3–6 UI.
- Produces: no Memory-specific paper geometry overrides, no legacy stacked paper form, no detail-only page header, no obsolete edit CSS paths.

- [ ] **Step 1: Add geometry regression assertions**

Assert detail, edit, create, and archived detail all render `PaperDetailDialog` with `.paper-detail-date` and `.paper-detail-signature`. In CSS/source tests assert Memory selectors do not redefine `.paper-detail-paper` width/height/inset/transform, `.paper-detail-date` corner coordinates, or `.paper-detail-signature` corner coordinates.

- [ ] **Step 2: Add obsolete-path regression assertions**

Assert active/detail/create source and rendered DOM contain no legacy `.memory-paper-form`, conventional `.memory-form-field`, detail `PageHeader`, `返回记忆列表`, or boxed select/input presentation paths. Keep any shared `.memory-grid/.memory-card` selectors that are still used by Diary/Task/Global Search.

- [ ] **Step 3: Run tests and observe failures**

```bash
npx tsx --test tests/memory-page.test.ts tests/memory-paper-styles.test.ts tests/paper-detail-memory-slots.test.ts
```

If stale paths remain, expected: FAIL on the exact obsolete selector/markup.

- [ ] **Step 4: Remove only proven-obsolete Memory code/styles**

Delete dead form/detail CSS and unreachable/unused component branches exposed by the regression tests. Do not globally delete selectors used by other pages.

- [ ] **Step 5: Run focused Memory regression gate and commit**

```bash
npx tsx --test tests/memory-presentation.test.ts tests/memory-page.test.ts tests/memory-detail-service.test.ts tests/memory-filter-history.test.ts tests/memory-location.test.ts tests/memory-scroll-restoration.test.ts tests/memory-list-styles.test.ts tests/memory-paper-editor.test.ts tests/memory-paper-styles.test.ts tests/paper-detail-memory-slots.test.ts tests/todo-paper-dialog.test.ts tests/web-memory-api.test.ts tests/memory-service.test.ts && npm --prefix web run typecheck && git diff --check
git add tests/memory-paper-styles.test.ts tests/paper-detail-memory-slots.test.ts tests/memory-page.test.ts web/src/pages/MemoryPage.tsx web/src/styles.css
git commit -m "refactor: remove obsolete Memory form presentation"
```

---

### Task 8: Mobile visual acceptance at 393 × 852

**Files:**
- Local-only, untracked if needed: `web/preview.html`
- Local-only, untracked if needed: `web/src/preview-main.tsx`
- Modify tracked files only when a visual defect is first captured by a failing automated test.

**Interfaces:**
- Consumes: Tasks 1–7 complete behavior.
- Produces: accepted 393 × 852 mobile presentation with no tracked preview helpers.

- [ ] **Step 1: Confirm preview files remain untracked**

```bash
git status --short
```

Expected entries may include only:

```text
?? web/preview.html
?? web/src/preview-main.tsx
```

Never add them to a commit.

- [ ] **Step 2: Extend the local preview mock only as needed for visual interaction**

If edit/create/archive/restore cannot be exercised because the current local mock supports only GET, add local-only handlers for `POST /memory`, `PATCH /memory`, `DELETE /memory`, and archived restore inside `web/src/preview-main.tsx`. Keep the helper untracked.

- [ ] **Step 3: Accept active Memory header/list at 393 × 852**

Visually confirm:

- Home-style white page shell and spacing remain accepted;
- category reads as four small squares;
- create pen is horizontally mirrored;
- search glyph visually matches neighboring tools;
- archive glyph clearly reads as archive storage;
- expanded search shows exactly one light-gray field surface with no second focus rectangle;
- month labels/cards/rows remain compact, with long title/meta truncation and whole-row click.

- [ ] **Step 4: Accept active detail/edit/create paper**

Visually compare directly with Home Todo paper:

- same paper size, viewport position, and overlay behavior;
- underlying Memory list does not jump or disappear;
- top-left date/time position and typography match Todo;
- bottom-right `N` position/typography match Todo;
- read-only key/body/meta feel like paper content;
- Edit changes the same positions into borderless key/category/content/tags editing;
- long key wraps while retaining title typography;
- Create is the same paper-native editor, not a form;
- long content scrolls inside the paper while paper corners stay fixed.

- [ ] **Step 5: Accept Archive**

Visually confirm:

- title is `Archive`;
- count position/font matches active Memory;
- return control is small borderless text aligned with active tool height;
- first month label/card starts at the same vertical position as active Memory;
- archived detail uses the same paper geometry, has no edit action, and restore returns to active Memory.

- [ ] **Step 6: For every visual defect, return to TDD before editing tracked production code**

Add a focused failing test that demonstrates the defect, verify RED, make the minimum tracked fix, re-run GREEN, then repeat the affected visual check.

---

### Task 9: Final verification and integration readiness

**Files:**
- No new implementation files expected.

- [ ] **Step 1: Run the complete focused Memory suite**

```bash
npx tsx --test tests/memory-presentation.test.ts tests/memory-page.test.ts tests/memory-detail-service.test.ts tests/memory-filter-history.test.ts tests/memory-location.test.ts tests/memory-scroll-restoration.test.ts tests/memory-list-styles.test.ts tests/memory-paper-editor.test.ts tests/memory-paper-styles.test.ts tests/paper-detail-memory-slots.test.ts tests/todo-paper-dialog.test.ts tests/web-memory-api.test.ts tests/memory-service.test.ts
```

Expected: all relevant tests PASS.

- [ ] **Step 2: Run web typecheck and full repository suite**

```bash
npm --prefix web run typecheck && npm test
```

Expected: typecheck PASS and full suite has zero failures (existing intentional skips may remain).

- [ ] **Step 3: Run diff/staging safety checks**

```bash
git diff --check && git status --short && git diff --stat codex/phase-6-web-ui-foundation...HEAD && git diff --check codex/phase-6-web-ui-foundation...HEAD
```

Expected: no diff-check errors; `web/preview.html` and `web/src/preview-main.tsx` remain untracked and unstaged.

- [ ] **Step 4: Use verification-before-completion and finishing-a-development-branch**

Re-read the required skills before claiming completion or integrating. Follow the established fast-forward integration flow only after fresh evidence: feature branch clean except the two preview helpers, fast-forward into `codex/phase-6-web-ui-foundation`, post-merge verification, push base, remote SHA verification, then delete the feature branch according to the finishing skill.

- [ ] **Step 5: Sync the Notion `UI` control page after integration**

Mark Memory redesign complete only after the merged/pushed base is remotely verified, then record the next roadmap step: use Memory as the mobile visual/interaction template for Diary, Task, and Chat Archive.
