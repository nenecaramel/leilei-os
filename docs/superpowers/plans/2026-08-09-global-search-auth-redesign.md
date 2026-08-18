# Global Search, Quick Search, and Auth Surface Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the full Global Search page, add a lightweight active-record Quick Search to the mobile top bar, and simplify Auth0 login/loading/error surfaces into Leilei OS's accepted white mobile visual language.

**Architecture:** Keep the existing Global Search service, API, URL parser, cursor pagination, detail routes, and history snapshot behavior intact. Extract only the result/navigation helpers needed by both full Global Search and Quick Search, keep Quick Search in its own layout component, keep `MobileTopBar` trigger-only, and isolate auth presentation changes in `ProtectedApp`. The first implementation batch must reach one coherent mobile preview before any pixel-level correction pass.

**Tech Stack:** React 19, TypeScript, React Router, Auth0 React SDK, existing `WebApiClient`, existing Global Search REST endpoint, CSS in `web/src/styles.css`, Node test runner through `tsx`.

## Global Constraints

- Base branch: `codex/phase-6-web-ui-foundation` at `c4da43bb3d908b1e2f626be8fcdd055b993d237d` when this feature branch was created.
- Feature branch: `leilei/global-search-auth-redesign-2026-08-09`.
- Do not change Global Search backend ranking, schema, repository semantics, Auth0 provider behavior, detail lifecycle semantics, or safe return-target rules.
- Keep backend `normal` and `phrase` support; remove matching mode only from the visible UI.
- Quick Search always uses Memory + Diary + Task, scope `active`, mode `normal`, no date bounds, and `limit=5`.
- Quick Search renders no backdrop/veil and does not change the route while open.
- Full Global Search groups results in fixed order Memory → Diary → Task and omits empty groups.
- Full Global Search result rows show stable name + matched snippet + compact business date; do not restore legacy `matched_field` / `match_reason` metadata.
- Auth login/loading/error surfaces use a pure-white viewport and no legacy auth card.
- Preserve iOS-safe real input sizing and the accepted mobile top-bar safe-area behavior.
- `web/preview.html` and `web/src/preview-main.tsx` remain untracked and must never be staged or committed.
- Implementation changes remain uncommitted through visual acceptance. The spec and this plan may be committed; implementation is committed only after the user accepts the completed visual batch and a fresh final verification passes.
- Do not force-push.

---

## File Structure

### New files

- `web/src/pages/global-search-result.ts`
  - Shared `GlobalSearchResult` type.
  - Module labels.
  - Compact business-date formatter.
  - Safe helper that maps a search result to existing Memory/Diary/Task active or archived detail URLs.
- `web/src/pages/GlobalSearchPageHeader.tsx`
  - Full-page heading, subtitle, three tools, their popovers, and the always-visible search field.
  - Owns transient menu-open state only; filter values and search behavior remain controlled by `GlobalSearchPageContent`.
- `web/src/layout/QuickSearchPanel.tsx`
  - Quick Search request lifecycle, debounce, abort/stale-response protection, mixed result list, outside-click/Escape handling, detail navigation, and View All navigation.
- `tests/global-search-mobile-redesign.test.ts`
  - Focused presentation contract for the redesigned full page.
- `tests/quick-search.test.ts`
  - Focused Quick Search behavior contract.
- `tests/auth-surface-redesign.test.ts`
  - Focused auth presentation contract.

### Existing files to modify

- `web/src/pages/GlobalSearchPage.tsx`
  - Preserve request/history/pagination logic while replacing old filter-card and result-card presentation.
- `web/src/pages/global-search-location.ts`
  - Reuse existing defaults and URL helpers; only add a small helper if required to build a normal/default `/search?q=...` target without duplicating filter literals.
- `web/src/layout/MobileTopBar.tsx`
  - Replace direct `/search` `Link` with a button trigger.
- `web/src/layout/AppShell.tsx`
  - Coordinate Quick Search open state, trigger ref, and API client; render the panel adjacent to the top bar.
- `web/src/components/icons.tsx`
  - Add neutral `ScopeIcon` built from two offset rounded rectangles.
- `web/src/auth/ProtectedApp.tsx`
  - Replace legacy auth card/login/error composition while keeping existing Auth0 calls and loading label.
- `web/src/styles.css`
  - Add Global Search, Quick Search, and auth visual rules; reuse accepted search-field/header primitives where possible instead of duplicating a new design system.
- `tests/global-search-web.test.ts`
  - Keep existing behavior/history/pagination assertions; update only expectations made obsolete by the new visible presentation.
- `tests/app-shell-mobile.test.ts`
  - Update top-bar contract from direct search link to Quick Search trigger while preserving navigation drawer/direct `/search` behavior.

---

### Task 1: Extract shared search-result helpers without changing behavior

**Files:**
- Create: `web/src/pages/global-search-result.ts`
- Modify: `web/src/pages/GlobalSearchPage.tsx`
- Test: `tests/global-search-mobile-redesign.test.ts`
- Regression: `tests/global-search-web.test.ts`

**Interfaces:**
- Produces:
  - `export type GlobalSearchResult = { entity_type: SearchModule; entity_id: string; stable_name: string; snippet: string; matched_field: string; match_reason: string; lifecycle_status: "active" | "archived"; business_time: string; time_basis: string; updated_at: string; detail_tool: "get_memory" | "get_diary" | "get_task"; detail_arguments: { id: string; scope: "active" | "archived" } }`
  - `export const GLOBAL_SEARCH_MODULE_LABELS: Record<SearchModule, string>`
  - `export function formatGlobalSearchBusinessDate(value: string): string`
  - `export function createGlobalSearchResultDetailLocation(result: GlobalSearchResult, returnTo: string): string`
- Consumes existing `createMemoryDetailLocation`, `createArchivedMemoryDetailLocation`, Diary equivalents, and Task equivalents.

- [ ] **Step 1: Write the failing shared-result test**

Add focused assertions to `tests/global-search-mobile-redesign.test.ts` that import the new helper module and require stable module labels, `MM.DD` output, and active/archived route mapping:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  createGlobalSearchResultDetailLocation,
  formatGlobalSearchBusinessDate,
  GLOBAL_SEARCH_MODULE_LABELS,
  type GlobalSearchResult,
} from "../web/src/pages/global-search-result.ts";

const memory: GlobalSearchResult = {
  entity_type: "memory",
  entity_id: "memory-1",
  stable_name: "UI",
  snippet: "mobile search",
  matched_field: "content",
  match_reason: "field_match",
  lifecycle_status: "active",
  business_time: "2026-08-09T07:30:00.000Z",
  time_basis: "created_at",
  updated_at: "2026-08-09T07:30:00.000Z",
  detail_tool: "get_memory",
  detail_arguments: { id: "memory-1", scope: "active" },
};

test("Global Search shared result presentation stays module-neutral", () => {
  assert.equal(GLOBAL_SEARCH_MODULE_LABELS.memory, "Memory");
  assert.match(formatGlobalSearchBusinessDate(memory.business_time), /^\d{2}\.\d{2}$/);
  assert.match(createGlobalSearchResultDetailLocation(memory, "/search?q=mobile"), /^\/memory\?/);
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm exec tsx --test tests/global-search-mobile-redesign.test.ts
```

Expected: FAIL because `web/src/pages/global-search-result.ts` does not exist.

- [ ] **Step 3: Implement the shared helper module**

Create `web/src/pages/global-search-result.ts` with the exact exported type above. Use the existing location helpers and a fixed module switch for detail URL mapping. Format the compact date with a browser-local `Date` and zero-padded month/day joined by `.`; invalid dates return an empty string rather than throwing.

Core implementation shape:

```ts
export const GLOBAL_SEARCH_MODULE_LABELS: Record<SearchModule, string> = {
  memory: "Memory",
  diary: "Diary",
  task: "Task",
};

export function formatGlobalSearchBusinessDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return [date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join(".");
}
```

- [ ] **Step 4: Replace local duplication in `GlobalSearchPage.tsx`**

Remove the local `GlobalSearchResult` type and module-label record. Import them from `global-search-result.ts`. Replace the current inline detail-route ternary with `createGlobalSearchResultDetailLocation(result, returnTo)` while keeping snapshot persistence exactly where it is.

- [ ] **Step 5: Run GREEN + existing Global Search regression**

Run:

```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/global-search-mobile-redesign.test.ts \
  tests/global-search-web.test.ts
```

Expected: PASS. If an existing test fails only because it asserts the now-extracted implementation shape rather than behavior, update that assertion narrowly; do not weaken request/history/detail-route coverage.

- [ ] **Step 6: Checkpoint only — do not commit implementation**

Run `git diff --check` and inspect that only Task 1 files changed. Leave changes uncommitted for the later visual acceptance gate.

---

### Task 2: Redesign the full Global Search page while preserving search state/history

**Files:**
- Create: `web/src/pages/GlobalSearchPageHeader.tsx`
- Modify: `web/src/pages/GlobalSearchPage.tsx`
- Modify: `web/src/components/icons.tsx`
- Modify: `web/src/styles.css`
- Test: `tests/global-search-mobile-redesign.test.ts`
- Regression: `tests/global-search-web.test.ts`
- Regression: `tests/native-date-layout.test.ts`

**Interfaces:**
- `GlobalSearchPageHeader` consumes:

```ts
type GlobalSearchPageHeaderProps = {
  subtitle: string;
  queryInput: string;
  draftFilters: GlobalSearchFilters;
  dateError: string;
  queryError: string;
  busy: boolean;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  onQueryInputChange(value: string): void;
  onModulesChange(modules: SearchModule[]): void;
  onScopeChange(scope: GlobalSearchFilters["scope"]): void;
  onDateRangeChange(dateFrom: string, dateTo: string): void;
  onClearDateRange(): void;
};
```

- `GlobalSearchPageContent` remains the owner of committed filters, debouncing, requests, pagination, snapshot/history restoration, and detail navigation.

- [ ] **Step 1: Extend failing presentation tests**

Add source/runtime assertions that require:

```ts
assert.match(pageSource, /GlobalSearchPageHeader/);
assert.doesNotMatch(pageSource, /匹配方式/);
assert.doesNotMatch(pageSource, /exact_phrase|精确短语/);
assert.match(headerSource, /Global Search/);
assert.match(headerSource, /DashboardIcon/);
assert.match(headerSource, /CalendarIcon/);
assert.match(headerSource, /ScopeIcon/);
assert.match(headerSource, /全部模块/);
assert.match(headerSource, /自定义范围/);
assert.match(headerSource, /已归档/);
```

Also add behavior coverage that a ready response is grouped in fixed Memory → Diary → Task order, an empty group is omitted, and row markup contains stable name, snippet, compact date, and only low-emphasis `Archived` text for archived items.

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm exec tsx --test tests/global-search-mobile-redesign.test.ts
```

Expected: FAIL because the old filter card and mixed card grid are still rendered and `ScopeIcon`/`GlobalSearchPageHeader` do not exist.

- [ ] **Step 3: Add `ScopeIcon`**

In `web/src/components/icons.tsx`, add a neutral layers/scope icon using two offset rounded rectangles, for example:

```tsx
export const ScopeIcon = (props: IconProps) => (
  <IconBase {...props}>
    <rect x="5" y="5" width="13" height="13" rx="2.5" />
    <path d="M8 3h10a3 3 0 0 1 3 3v10" />
  </IconBase>
);
```

Keep the shared `IconBase` stroke rules unchanged.

- [ ] **Step 4: Implement `GlobalSearchPageHeader`**

Use the accepted `memory-page-header`, `memory-page-heading`, `memory-page-title`, `memory-page-count`, `memory-page-tools`, `memory-page-tool-wrap`, `memory-page-popover`, and `memory-page-search` visual language where compatible, with Global-Search-specific wrapper classes only for spacing/layout differences.

Behavior requirements:
- title `Global Search`;
- subtitle passed by parent;
- exactly three tool buttons in Module → Date → Scope order;
- Module popover supports `全部模块` and checkbox-like Memory/Diary/Task toggles; never emit an empty module array;
- Date popover supports `全部时间` and `自定义范围`; custom mode renders two existing `NativeDateInput` controls and allows one-sided bounds;
- Scope popover maps labels `当前`, `已归档`, `全部` to `active`, `archived`, `all`;
- Escape closes a transient tool menu;
- always-visible search field uses `<SearchIcon />`, `maxLength={200}`, and the same iOS-safe input treatment as accepted module search fields.

- [ ] **Step 5: Replace old full-page presentation**

In `GlobalSearchPage.tsx`:
- remove `PageHeader` and the legacy `.global-search-filters` card;
- compute subtitle as `Memory · Diary · Task` until a valid response completes, then `${results.length}条结果` for ready/empty states;
- keep request state machine and existing debounce;
- render initial copy exactly `搜索 Memory、Diary 与 Task 中保存的内容`;
- render loading copy `正在搜索…`;
- render empty copy `没有找到匹配内容`;
- render error copy `搜索暂时失败` plus the existing retry behavior;
- group `results` with `SEARCH_MODULES.map(...)`, preserving API order inside each group;
- omit groups with zero rows;
- render one group card containing multiple row buttons; each row shows stable name, snippet, compact date, and optional `Archived` text only;
- keep cursor-based load-more and dedupe behavior unchanged.

- [ ] **Step 6: Add the first-pass page CSS**

In `web/src/styles.css`, add only the geometry necessary for a coherent first preview:
- Global Search page spacing aligned with Memory/Diary/Task mobile heading position;
- three 44px tool targets;
- persistent search field width/spacing;
- section labels;
- one rounded white card per module group;
- row separators inside a group except after the final row;
- two-line row typography with date aligned to the second-line right edge;
- low-emphasis archived marker;
- quiet initial/loading/empty/error copy.

Do not spend this step micro-tuning shadow strength or pixel offsets; visual acceptance happens after all three surfaces exist.

- [ ] **Step 7: Run GREEN + regressions**

Run:

```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/global-search-mobile-redesign.test.ts \
  tests/global-search-web.test.ts \
  tests/native-date-layout.test.ts
```

Expected: PASS with existing history/snapshot/pagination coverage intact.

- [ ] **Step 8: Checkpoint only — do not commit implementation**

Run `git diff --check`. Confirm backend `src/domains/global-search/**` and API route files are untouched.

---

### Task 3: Add non-modal mobile Quick Search and change only the top-bar entry

**Files:**
- Create: `web/src/layout/QuickSearchPanel.tsx`
- Modify: `web/src/layout/MobileTopBar.tsx`
- Modify: `web/src/layout/AppShell.tsx`
- Modify: `web/src/pages/global-search-location.ts` only if a default-query URL helper meaningfully removes duplication
- Modify: `web/src/styles.css`
- Test: `tests/quick-search.test.ts`
- Modify regression: `tests/app-shell-mobile.test.ts`
- Regression: `tests/global-search-web.test.ts`

**Interfaces:**

`MobileTopBar` becomes trigger-only for search:

```ts
type MobileTopBarProps = {
  menuOpen: boolean;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  onMenuClick(): void;
  searchOpen: boolean;
  searchButtonRef: RefObject<HTMLButtonElement | null>;
  onSearchClick(): void;
};
```

`QuickSearchPanel` consumes:

```ts
type QuickSearchPanelProps = {
  open: boolean;
  api: WebApiClient;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose(): void;
};
```

- [ ] **Step 1: Write failing Quick Search tests**

Require the top bar to render a `<button>` rather than a `/search` link, while `NavigationGroups` still contains a direct `/search` Global Search item. Add source/behavior assertions for Quick Search's request contract and transient behavior:

```ts
assert.match(quickSource, /limit.*5|limit=5/);
assert.match(quickSource, /scope.*active/);
assert.match(quickSource, /mode.*normal/);
assert.doesNotMatch(quickSource, /backdrop|overlay-mask/);
assert.match(quickSource, /查看全部结果/);
```

Add a mock API test whose old request is unresolved, a newer query resolves first, and the old response must not replace the newer result list.

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/quick-search.test.ts \
  tests/app-shell-mobile.test.ts
```

Expected: FAIL because the current top-bar search is still a direct `Link` and no Quick Search panel exists.

- [ ] **Step 3: Convert only `MobileTopBar` search entry to a button**

Remove `Link` import from `MobileTopBar.tsx`. Render a 44×44 search button with:

```tsx
<button
  ref={searchButtonRef}
  className="mobile-search-link"
  type="button"
  aria-label={searchOpen ? "关闭快速搜索" : "打开快速搜索"}
  aria-expanded={searchOpen}
  aria-controls="quick-search-panel"
  onClick={onSearchClick}
>
  <SearchIcon />
</button>
```

Do not change `NavigationGroups`; drawer/sidebar Global Search must still use `/search`.

- [ ] **Step 4: Implement `QuickSearchPanel` request state**

Use local state `queryInput`, `state`, and `results`, plus an `AbortController` ref and monotonically increasing sequence number.

Request shape after a short debounce and normalized non-empty query:

```ts
const params = new URLSearchParams({
  query,
  modules: SEARCH_MODULES.join(","),
  scope: "active",
  mode: "normal",
  limit: "5",
});
api.request<SearchResponse>(`/search?${params.toString()}`, { signal: controller.signal });
```

Rules:
- blank query sends no request and clears results;
- >200-code-point query shows a restrained validation error and sends no request;
- abort previous request before starting another;
- ignore stale tickets and aborted failures;
- keep API order; do not group Quick Search results;
- never show more than five rows.

- [ ] **Step 5: Implement focus, outside-click, Escape, and navigation**

When `open` becomes true, requestAnimationFrame-focus the input. Register `pointerdown` and `keydown` listeners only while open. Ignore pointer events inside the panel or on `triggerRef.current`; otherwise call `onClose()`.

For a result:

```ts
const returnTo = createGlobalSearchLocation({
  ...DEFAULT_GLOBAL_SEARCH_FILTERS,
  q: normalizeGlobalSearchQuery(queryInput),
});
const target = createGlobalSearchResultDetailLocation(result, returnTo);
onClose();
navigateWithinApp(target, window.history.state);
```

For `查看全部结果`, close then navigate to the same default `/search?q=...` URL.

- [ ] **Step 6: Coordinate the panel in `AppShell`**

Add:
- `quickSearchOpen` state;
- `searchButtonRef`;
- `const api = useWebApiClient()`;
- `MobileTopBar` props above;
- `<QuickSearchPanel ... />` immediately after the top bar so its top anchoring is not coupled to routed page content.

When opening Quick Search, close the mobile navigation drawer first so the two transient surfaces never overlap.

- [ ] **Step 7: Add first-pass Quick Search CSS**

Requirements:
- `position: fixed` below `44px + safe-area-inset-top`;
- mobile horizontal inset around 20px;
- white surface;
- no backdrop element;
- restrained border, radius, and light shadow;
- search field as the first element;
- mixed result rows with small module label + title + short snippet;
- footer View All action;
- top anchored when keyboard opens;
- z-index above page content and below no unrelated blocking layer.

- [ ] **Step 8: Run GREEN + regressions**

Run:

```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/quick-search.test.ts \
  tests/app-shell-mobile.test.ts \
  tests/global-search-web.test.ts \
  tests/route-scroll.test.ts
```

Expected: PASS. Route-scroll tests must remain unchanged unless they have a literal top-bar link assertion that is now obsolete; do not change scroll behavior.

- [ ] **Step 9: Checkpoint only — do not commit implementation**

Run `git diff --check` and verify `NavigationGroups.tsx` did not lose the direct `/search` entry.

---

### Task 4: Simplify Auth0 login/loading/error surfaces

**Files:**
- Modify: `web/src/auth/ProtectedApp.tsx`
- Modify: `web/src/styles.css`
- Create: `tests/auth-surface-redesign.test.ts`
- Regression: `tests/web-api-auth.test.ts`
- Regression: `tests/oauth-auth.test.ts`

**Interfaces:**
- Keep `useAuth0()` fields and `loginWithRedirect()` behavior unchanged.
- Keep `SettingsProvider` wrapping authenticated children unchanged.

- [ ] **Step 1: Write the failing auth presentation test**

Read `ProtectedApp.tsx` and `styles.css`; assert the old unauthenticated copy/card is absent and the new minimal copy exists:

```ts
assert.doesNotMatch(source, /Personal operations, quietly organized/);
assert.doesNotMatch(source, /欢迎回到 Leilei OS/);
assert.doesNotMatch(source, /className="brand-mark"/);
assert.match(source, />Leilei OS</);
assert.match(source, />\s*使用 Auth0 登录\s*</);
assert.match(source, /loading-orb/);
assert.match(css, /\.auth-screen[\s\S]*background:\s*#fff/i);
```

Also assert both login and retry actions still invoke `loginWithRedirect()`.

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm exec tsx --test tests/auth-surface-redesign.test.ts
```

Expected: FAIL because the legacy card/brand/copy are still present and auth background is not the new pure-white composition.

- [ ] **Step 3: Replace login composition**

For `!isAuthenticated`, render only:

```tsx
<main className="auth-screen auth-screen-login">
  <section className="auth-minimal" aria-label="登录 Leilei OS">
    <h1>Leilei OS</h1>
    <button
      className="auth-text-action"
      type="button"
      onClick={() => loginWithRedirect()}
    >
      使用 Auth0 登录
    </button>
  </section>
</main>
```

No legacy auth card, L mark, eyebrow, welcome heading, explanation, border, or filled button.

- [ ] **Step 4: Simplify loading and error states**

Loading keeps only the current accessible `loading-orb` on `auth-screen auth-screen-loading`.

Error renders a minimal white surface with concise heading `暂时无法登录`, the existing safe `error.message`, and an `auth-text-action` button `重新登录` that calls `loginWithRedirect()`.

- [ ] **Step 5: Add auth CSS**

Requirements:
- viewport pure white;
- `auth-minimal` centered horizontally and optically slightly above true vertical center using a small translate/negative offset that can be tuned later;
- `Leilei OS` around 25–28px / 500 in the Apple system stack;
- login action around 13px / 400, light gray by default and darker on hover/focus/active;
- visible `:focus-visible` treatment even though the control has no border box at rest;
- loading orb keeps its existing animation/shadow rules, only its surrounding background changes.

- [ ] **Step 6: Run GREEN + auth regressions**

Run:

```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/auth-surface-redesign.test.ts \
  tests/web-api-auth.test.ts \
  tests/oauth-auth.test.ts
```

Expected: PASS.

- [ ] **Step 7: Checkpoint only — do not commit implementation**

Run `git diff --check`; confirm Auth0 configuration/provider files are untouched.

---

### Task 5: Build one integrated visual-acceptance preview and run the pre-acceptance gate

**Files:**
- Create untracked only: `web/preview.html`
- Create untracked only: `web/src/preview-main.tsx`
- Modify only if automated checks reveal a real implementation defect: files from Tasks 1–4
- Test: all focused tests above

**Interfaces:**
- Preview helpers are local fixtures only. They must not be tracked.
- The preview should exercise production components where practical; auth states may use isolated fixture markup/classes if Auth0 state cannot be safely injected without changing production auth configuration.

- [ ] **Step 1: Run focused integrated tests**

Run:

```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/global-search-mobile-redesign.test.ts \
  tests/global-search-web.test.ts \
  tests/quick-search.test.ts \
  tests/app-shell-mobile.test.ts \
  tests/auth-surface-redesign.test.ts \
  tests/native-date-layout.test.ts \
  tests/route-scroll.test.ts
```

Expected: PASS with zero failures.

- [ ] **Step 2: Run typecheck/build/diff checks before preview**

Run:

```bash
pnpm typecheck
pnpm build
(cd web && pnpm typecheck)
(cd web && pnpm build)
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Create the untracked visual fixture**

`web/preview.html` loads `web/src/preview-main.tsx` exactly as prior mobile visual rounds do.

`preview-main.tsx` must expose query-selectable fixtures for at least:
- `?view=search-empty`
- `?view=search-results`
- `?view=search-module`
- `?view=search-date`
- `?view=search-scope`
- `?view=quick`
- `?view=quick-results`
- `?view=auth-login`
- `?view=auth-loading`
- `?view=auth-error`

Use realistic Memory/Diary/Task result data and `393×852` mobile rendering. Production search/header/result components should be reused rather than manually redrawing them whenever their props allow it.

- [ ] **Step 4: Verify preview helpers are untracked**

Run:

```bash
git ls-files --error-unmatch web/preview.html && exit 1 || true
git ls-files --error-unmatch web/src/preview-main.tsx && exit 1 || true
```

Expected: neither helper is tracked.

- [ ] **Step 5: Run web typecheck with preview present**

Run:

```bash
(cd web && pnpm typecheck)
```

Expected: PASS.

- [ ] **Step 6: Start a local Vite preview and hand off visual acceptance**

Use an available port in the existing 4330–4390 preview range, bind `0.0.0.0`, print both localhost and LAN URLs for each fixture, and keep the process PID in `/tmp` for deterministic cleanup.

Visual acceptance checklist:
- Global Search heading/subtitle position matches Memory/Diary/Task.
- Three tools have correct order and optical alignment.
- Search field feels identical to the accepted module search family.
- Initial page is quiet; no accidental cards or extra information.
- Result groups and row density are readable without becoming heavy.
- Quick Search floats without dimming the page and remains top-anchored with keyboard.
- Quick Search width/radius/border/shadow feel light rather than modal.
- Login composition is horizontally centered and slightly above vertical center.
- Loading orb reads naturally against pure white.

Per the agreed workflow, collect all spacing/font/icon/shadow/detail notes in this one pass and fix them together rather than producing one patch per pixel issue.

- [ ] **Step 7: Stop before commit/merge/push**

Do not commit implementation, merge, or push after this task. Wait for explicit visual acceptance or a consolidated correction list.

---

### Task 6: After visual acceptance, apply one correction pass and finalize safely

**Files:**
- Modify only accepted implementation/test files from Tasks 1–5.
- Remove local preview helpers before staging.

- [ ] **Step 1: Convert the consolidated visual notes into focused regression assertions where deterministic**

Examples include exact icon count/order, class geometry contracts, shared search-field inheritance, auth white background, Quick Search no-backdrop contract, and any agreed copy changes. Do not encode brittle pixel values unless the visual requirement is intentionally exact.

- [ ] **Step 2: Apply one visual correction patch**

Change only the minimum CSS/markup required by the accepted notes. Do not reopen backend search semantics or unrelated page design.

- [ ] **Step 3: Re-run focused tests**

Run the Task 5 focused test command and require zero failures.

- [ ] **Step 4: Run fresh deterministic full gate**

Discover all `tests/**/*.test.ts` files with `find`, sort them, and run:

```bash
pnpm exec tsx --test --test-concurrency=1 <all-discovered-test-files>
pnpm typecheck
pnpm build
(cd web && pnpm typecheck)
(cd web && pnpm build)
git diff --check
```

Expected: zero test failures and all commands exit 0.

- [ ] **Step 5: Remove and verify preview helpers before staging**

Delete only untracked `web/preview.html` and `web/src/preview-main.tsx`; abort if either path is tracked.

- [ ] **Step 6: Stage only the durable allowlist**

Expected durable files are limited to the approved spec/plan, focused tests, and implementation files named in this plan. Print `git diff --cached --name-status` and abort on unrelated paths.

- [ ] **Step 7: Commit the accepted implementation**

Use one coherent implementation commit such as:

```bash
git commit -m "style: redesign Global Search and auth surfaces"
```

- [ ] **Step 8: Verify base did not move, fast-forward merge locally, and verify merged result**

Fetch `origin/codex/phase-6-web-ui-foundation`. If remote base no longer equals the expected fork point, stop and inspect rather than force. Otherwise fast-forward merge the feature branch into the base and re-run focused tests plus root/web typechecks on the merged result.

- [ ] **Step 9: Push base without force and verify remote SHA**

Push `codex/phase-6-web-ui-foundation`, fetch it, and require local HEAD == remote HEAD.

- [ ] **Step 10: Clean local feature branch and update Notion only after verified push**

Delete the merged local feature branch, require a clean worktree, then update Notion `🎨 UI` with the final commit SHA and the accepted Global Search / Quick Search / auth state. Never update Notion to claim completion before the remote SHA is verified.
