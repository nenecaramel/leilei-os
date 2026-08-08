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
  key: " new_key ",
  category: "project",
  content: " updated content ",
  tags: ["one", " two "],
});
```

Assert the repository receives normalized `key: "new_key"`, legal `category: "project"`, normalized `content: "updated content"`, and normalized tags. Add failure cases for blank/over-100-char key and unsupported category, expecting `INVALID_MEMORY_KEY` and `INVALID_MEMORY_CATEGORY`.

- [ ] **Step 2: Run service tests and verify RED**

```bash
npx tsx --test --test-name-pattern="updateMemory" tests/memory-service.test.ts
```

Expected: FAIL because `UpdateMemoryInput` and service forwarding do not yet support `key/category`.

- [ ] **Step 3: Implement only the service/type layer needed for GREEN**

Change repository/service update input types to include:

```ts
{
  userId: string;
  id: string;
  key: string;
  category: MemoryCategory;
  content: string;
  tags?: readonly string[];
}
```

In `MemoryService.updateMemory`, normalize key with `normalizeRequiredText(..., MAX_KEY_LENGTH, "INVALID_MEMORY_KEY")`, validate the single category through the existing category validator, normalize content with `normalizeRequiredText(..., MAX_CONTENT_LENGTH, "INVALID_MEMORY_CONTENT")`, normalize tags when supplied, and forward all fields to the repository. Do not yet change the Drizzle `.set(...)` implementation.

- [ ] **Step 4: Re-run service tests and verify GREEN**

Run Step 2 again. Expected: PASS.

- [ ] **Step 5: Write repository RED integration coverage before changing persistence**

Add a test that calls repository `updateMemory` with new key/category/content/tags and then reads the record back. Assert all four values changed. Also assert an archived record and a different user's record are not changed.

- [ ] **Step 6: Run repository test and verify RED**

```bash
npx tsx --test --test-name-pattern="updateMemory|updates.*key.*category" tests/memory-lifecycle-repository.integration.test.ts
```

Expected: FAIL because the Drizzle update still writes only content/tags.

- [ ] **Step 7: Extend Drizzle update minimally**

Update only the existing `.set(...)` payload:

```ts
.set({
  key: input.key,
  category: input.category,
  content: input.content,
  ...(input.tags === undefined ? {} : { tags: [...input.tags] }),
  updatedAt: new Date(),
})
```

Keep the existing `id + userId + status=active + visibility=assistant` predicate unchanged.

- [ ] **Step 8: Re-run repository test and verify GREEN**

Run Step 6 again. Expected: PASS.

- [ ] **Step 9: Write Web API RED test for expanded PATCH forwarding**

Assert authenticated `PATCH /memory` forwards:

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

Keep existing unauthenticated/404/error mapping assertions.

- [ ] **Step 10: Run Web API test and verify RED**

```bash
npx tsx --test --test-name-pattern="PATCH|update" tests/web-memory-api.test.ts
```

Expected: FAIL because the router forwards only `id/content/tags`.

- [ ] **Step 11: Extend router contract and forwarding**

Update `MemoryApiDependencies.memoryService.updateMemory` and `createUpdateMemoryApiHandler` to pass `request.body.key` and `request.body.category` with existing fields. Do not add a route.

- [ ] **Step 12: Run Task 1 verification and commit**

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

Assert tool order/accessibility remains `筛选分类`, `筛选标签`, `搜索记忆`, `查看归档`, `新增记忆`; category renders four independent square shapes; search/archive/create use SVG icons instead of current text glyphs `⌕`, `▣`, `✎`.

- [ ] **Step 2: Run focused header test and verify RED**

```bash
npx tsx --test --test-name-pattern="Memory.*header|header.*Memory" tests/memory-page.test.ts
```

Expected: FAIL on current text glyphs.

- [ ] **Step 3: Implement SVG tool icons**

In `icons.tsx`, add a Memory category-grid icon from four separate small `<rect>` elements. Reuse/refine `SearchIcon` and `ArchiveIcon` so Archive reads as a storage box/tray. Add a pen icon if needed. Wire them into `MemoryPageHeader`. Horizontally mirror only the pen glyph; do not reverse tool order or button hit boxes.

- [ ] **Step 4: Re-run header test and verify GREEN**

Run Step 2 again. Expected: PASS.

- [ ] **Step 5: Write search-surface CSS RED assertions**

Lock `.memory-page-search` as the only visible light-gray field surface. Assert its `input[type="search"]` has transparent background, `border: 0`, no box-shadow, and no second focus rectangle. Lock search SVG visual size/weight while tool buttons retain 44px hit targets.

- [ ] **Step 6: Run style test and verify RED**

```bash
npx tsx --test tests/memory-list-styles.test.ts
```

Expected: FAIL until the inner search control is visually neutralized.

- [ ] **Step 7: Implement minimal mobile search/icon CSS**

Keep the outer search shell as the one rounded/light-gray field. Remove visible native inner search chrome and apply keyboard focus treatment to the outer shell. Keep neighboring glyphs balanced and smaller than global top-bar icons.

- [ ] **Step 8: Run Task 2 verification and commit**

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
- Consumes: active list `state`, `location.memoryId`, `PaperDetailDialog`, Memory URL helpers, scroll storage helpers.
- Produces: active list stays mounted during active detail; opening detail does not reset page scroll; closing returns to the unchanged filtered/scrolled list without an unnecessary list reload.

- [ ] **Step 1: Write DOM RED test for stationary background**

Render an active list with at least two month groups, open a row, resolve `/memory/:id`, then assert the DOM simultaneously contains `.memory-page-header`, `.memory-months`/clicked row, and `#memory-detail-paper`. Assert no detail-only `PageHeader` or `返回记忆列表` appears.

- [ ] **Step 2: Write scroll RED test**

Start at non-zero `window.scrollY`, click a row, resolve detail, and assert opening detail does not reset scroll to zero. Close the paper and assert the saved list position/state remains without a detail-close-only refetch.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npx tsx --test --test-name-pattern="stationary|background|scroll" tests/memory-page.test.ts tests/memory-scroll-restoration.test.ts
```

Expected: FAIL because current detail replaces the list and calls `window.scrollTo({ top: 0 })`.

- [ ] **Step 4: Keep active list state/request alive during active detail**

Do not abort/suppress the active list merely because `isDetail` is true. Archive/archived-detail may still own a separate page. Remove `isDetail` dependencies that trigger unnecessary active-list reset.

- [ ] **Step 5: Render active list first, detail overlay second**

For active Memory context, render `MemoryPageHeader` plus active loading/error/empty/month content regardless of active detail. Render `MemoryDetail` as an additional sibling overlay when `isDetail`. Remove the detail-only `PageHeader` branch. Preserve focus restoration to `paperTriggerRef`.

- [ ] **Step 6: Stop active-detail fetch from moving page scroll**

Remove active-detail `window.scrollTo({ top: 0 })`. Let `PaperDetailDialog` lock body overflow. Close detail by restoring URL/history and overlay state without forcing an already-valid list to loading.

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
- Consumes: `MemoryCategory = "profile" | "preference" | "goal" | "project"` and shared paper slots.
- Produces: controlled editor for key/category/content/tags and imperative `focusKey()` for quick-create.

Use this contract:

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

Assert a title-position key editor, body content editor, bottom-left metadata controls, and a category menu containing exactly Profile/Preference/Goal/Project. Assert no `<select>` and no stacked `.memory-paper-form` field wrapper. Assert each controlled callback fires.

- [ ] **Step 2: Run component test and verify RED**

```bash
npx tsx --test tests/memory-paper-editor.test.ts
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement controlled paper editor**

Create a Memory-specific component instead of reusing Todo row/status semantics. Key stays in the first/title region and retains title typography when wrapping. Content is a transparent borderless textarea in the body. Bottom-left metadata shows category/tags; category opens a lightweight anchored menu of four legal values; tags edit inline in the same metadata position. Expose `focusKey()` via `forwardRef/useImperativeHandle`.

- [ ] **Step 4: Re-run component test and verify GREEN**

Run Step 2 again. Expected: PASS.

- [ ] **Step 5: Write paper-native CSS RED assertions**

Lock transparent background, `border: 0`, no box-shadow, inherited color/font, `resize: none`, title typography for key, long-key wrapping without font shrink, and lightweight metadata/category-menu styling.

- [ ] **Step 6: Run style test and verify RED**

```bash
npx tsx --test tests/memory-paper-styles.test.ts
```

Expected: FAIL until new editor classes are styled.

- [ ] **Step 7: Implement editor styles without touching shared paper geometry**

Add only Memory editor/metadata styles. Do not alter shared `.paper-detail-paper`, `.paper-detail-date`, or `.paper-detail-signature` geometry.

- [ ] **Step 8: Run Task 4 verification and commit**

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
- Produces: active edit/create directly on paper; PATCH sends `{ id, key, category, content, tags }`; dirty protection covers all four fields; quick-create focuses key title once.

- [ ] **Step 1: Write active-edit RED test**

Open active detail, click `编辑`, and assert the same `#memory-detail-paper` remains while key/category/content/tags become editable. Assert no stacked form/select. Change all four fields and assert Save PATCH body is:

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

Changing only key or only category must mark the edit dirty and trigger existing unsaved-close confirmation. Cancel restores fetched values. Save failure keeps the paper open with inline paper error.

- [ ] **Step 3: Run edit tests and verify RED**

```bash
npx tsx --test --test-name-pattern="Memory.*edit|editing|PATCH|unsaved" tests/memory-page.test.ts tests/memory-detail-service.test.ts
```

Expected: FAIL because current edit tracks only content/tags and renders conventional fields.

- [ ] **Step 4: Expand edit controller state and render editor**

Track `editingKey` and `editingCategory` with content/tags. Include all four in dirty/reset/popstate paths and `handleUpdate`. Key/content are required. Read-only detail keeps title/body/bottom-left metadata; edit mode swaps those same positions to `MemoryPaperEditor`; top-right becomes `取消 · 保存`.

- [ ] **Step 5: Re-run edit tests and verify GREEN**

Run Step 3 again. Expected: PASS.

- [ ] **Step 6: Write create RED test**

Click the pen and assert `#memory-create-paper` opens directly in editor mode with title key, body content, editable bottom-left category/tags, no stacked form. Assert key/content required, POST remains `{ category, key, content, tags }`, and quick-create focuses key once.

- [ ] **Step 7: Run create test and verify RED**

```bash
npx tsx --test --test-name-pattern="create|quick-create|新增" tests/memory-page.test.ts
```

Expected: FAIL against current `<select>` + labeled input/textarea form.

- [ ] **Step 8: Replace create form with `MemoryPaperEditor`**

Reuse existing create values/mutation protections. Use `MemoryPaperEditorHandle.focusKey()` in the one-shot focus effect. Bottom-right remains `N`; top-right remains `取消 · 保存`.

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
- Consumes: active Memory heading/month classes and existing `ArchivedMemoryList`.
- Produces: title `Archive`, identical title/count geometry, compact borderless return text with 44px tap target, identical first-month/card vertical start, and return control present in ready/loading/empty/error archive states.

- [ ] **Step 1: Write Archive header RED tests**

Open Archive and assert title exactly `Archive`, subtitle `${count}条记忆`, borderless text return control, and absence of active filter/search/create tools. Assert the same header/return shell is present for loading, empty, and request-error states.

- [ ] **Step 2: Write geometry RED assertions**

Assert Archive reuses active heading/title/count classes (or one shared class set). Assert return has no visible border/background while retaining 44px tap geometry. Assert Archive uses `.memory-months`, `.memory-month-section`, `.memory-month-card`, `.memory-row` without archive-only top offsets.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npx tsx --test --test-name-pattern="Archive|archive" tests/memory-page.test.ts tests/memory-list-styles.test.ts
```

Expected: FAIL on current `已归档记忆`, header spacing, and non-ready return-control gap.

- [ ] **Step 4: Implement shared Archive heading/list geometry**

Render title `Archive` and count with the active heading structure. Put small text-only return on the right. Keep the header in loading/empty/error/ready states. Reuse active month-list classes and remove archive-only vertical offsets.

- [ ] **Step 5: Run Task 6 verification and commit**

```bash
npx tsx --test tests/memory-page.test.ts tests/memory-list-styles.test.ts tests/memory-scroll-restoration.test.ts && npm --prefix web run typecheck && git diff --check
git add web/src/pages/MemoryPage.tsx web/src/styles.css tests/memory-page.test.ts tests/memory-list-styles.test.ts
git commit -m "style: align Memory archive with active view"
```

---

### Task 7: Lock shared paper geometry and remove obsolete Memory presentation

**Files:**
- Modify: `tests/memory-paper-styles.test.ts`
- Modify: `tests/paper-detail-memory-slots.test.ts`
- Modify: `tests/memory-page.test.ts`
- Modify: `web/src/pages/MemoryPage.tsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: shared `PaperDetailDialog` and Tasks 3–6.
- Produces: no Memory-specific paper geometry overrides, no legacy stacked paper form, no active-detail page header, no obsolete edit CSS.

- [ ] **Step 1: Add geometry/obsolete-path RED assertions**

Assert detail/edit/create/archived detail all use `PaperDetailDialog` with shared `.paper-detail-date` and `.paper-detail-signature`. Assert Memory selectors do not redefine paper width/height/inset/transform or date/signature corner coordinates. Assert no legacy `.memory-paper-form`, conventional `.memory-form-field`, detail `PageHeader`, or `返回记忆列表` remains.

- [ ] **Step 2: Run tests and verify any remaining stale paths fail**

```bash
npx tsx --test tests/memory-page.test.ts tests/memory-paper-styles.test.ts tests/paper-detail-memory-slots.test.ts
```

Expected: FAIL only if stale presentation remains; if already green, do not invent cleanup.

- [ ] **Step 3: Remove only proven-obsolete Memory code/styles**

Delete only selectors/branches identified by Step 2. Keep shared `.memory-grid/.memory-card` selectors still used by Diary/Task/Global Search.

- [ ] **Step 4: Run focused Memory regression gate and commit only if tracked cleanup exists**

```bash
npx tsx --test tests/memory-presentation.test.ts tests/memory-page.test.ts tests/memory-detail-service.test.ts tests/memory-filter-history.test.ts tests/memory-location.test.ts tests/memory-scroll-restoration.test.ts tests/memory-list-styles.test.ts tests/memory-paper-editor.test.ts tests/memory-paper-styles.test.ts tests/paper-detail-memory-slots.test.ts tests/todo-paper-dialog.test.ts tests/web-memory-api.test.ts tests/memory-service.test.ts && npm --prefix web run typecheck && git diff --check
```

If tracked cleanup exists:

```bash
git add tests/memory-paper-styles.test.ts tests/paper-detail-memory-slots.test.ts tests/memory-page.test.ts web/src/pages/MemoryPage.tsx web/src/styles.css
git commit -m "refactor: remove obsolete Memory form presentation"
```

---

### Task 8: Mobile visual acceptance at 393 × 852

**Files:**
- Local-only, untracked if needed: `web/preview.html`
- Local-only, untracked if needed: `web/src/preview-main.tsx`
- Modify tracked files only after a visual defect is captured by a failing automated test.

- [ ] **Step 1: Confirm preview files remain untracked**

```bash
git status --short
```

Expected local-only entries may include exactly:

```text
?? web/preview.html
?? web/src/preview-main.tsx
```

- [ ] **Step 2: Extend local preview mock only as needed**

If interaction cannot be exercised because the current mock supports only GET, add local-only `POST /memory`, `PATCH /memory`, `DELETE /memory`, and restore handlers inside `web/src/preview-main.tsx`. Keep the helper untracked.

- [ ] **Step 3: Accept active Memory header/list**

At `393 × 852`, confirm Home-style white shell, four-square category icon, mirrored pen, balanced search icon, clear archive icon, exactly one search field surface, compact month cards, long title/meta truncation, and whole-row click.

- [ ] **Step 4: Accept active detail/edit/create paper**

Compare directly with Home Todo: same paper size/viewport placement, stationary Memory list behind it, same top-left date and bottom-right `N` coordinates/typography, borderless paper-native key/category/content/tags editing, long key retaining title typography, create using the same editor, and long body scrolling inside fixed paper corners.

- [ ] **Step 5: Accept Archive**

Confirm title `Archive`, count position/font matching Memory, small borderless return text, first month/card aligned with active Memory, read-only archived detail on the same paper geometry, and restore returning to active Memory.

- [ ] **Step 6: For every visual defect, return to RED first**

Add a focused failing automated test, verify RED, implement the smallest tracked fix, verify GREEN, then repeat the affected visual check.

---

### Task 9: Final verification and integration readiness

**Files:**
- No new implementation files expected.

- [ ] **Step 1: Run complete focused Memory suite**

```bash
npx tsx --test tests/memory-presentation.test.ts tests/memory-page.test.ts tests/memory-detail-service.test.ts tests/memory-filter-history.test.ts tests/memory-location.test.ts tests/memory-scroll-restoration.test.ts tests/memory-list-styles.test.ts tests/memory-paper-editor.test.ts tests/memory-paper-styles.test.ts tests/paper-detail-memory-slots.test.ts tests/todo-paper-dialog.test.ts tests/web-memory-api.test.ts tests/memory-service.test.ts
```

Expected: all relevant tests PASS.

- [ ] **Step 2: Run web typecheck and full repository suite**

```bash
npm --prefix web run typecheck && npm test
```

Expected: typecheck PASS and full suite has zero failures; existing intentional skips may remain.

- [ ] **Step 3: Run diff/staging safety checks**

```bash
git diff --check && git status --short && git diff --stat codex/phase-6-web-ui-foundation...HEAD && git diff --check codex/phase-6-web-ui-foundation...HEAD
```

Expected: no diff-check errors; preview helpers remain untracked/unstaged.

- [ ] **Step 4: Use verification-before-completion and finishing-a-development-branch**

Re-read the required skills before claiming completion or integrating. Follow the established fast-forward integration flow only after fresh evidence: feature branch clean except preview helpers, fast-forward into `codex/phase-6-web-ui-foundation`, post-merge verification, push base, remote SHA verification, then delete the feature branch according to the finishing skill.

- [ ] **Step 5: Sync Notion `UI` after integration**

Mark Memory redesign complete only after merged/pushed base is remotely verified, then record the next roadmap step: use Memory as the mobile visual/interaction template for Diary, Task, and Chat Archive.
