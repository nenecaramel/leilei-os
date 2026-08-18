# Global Search, Quick Search, and Auth Surface Redesign

Date: 2026-08-09
Branch: `leilei/global-search-auth-redesign-2026-08-09`
Base: `codex/phase-6-web-ui-foundation` @ `c4da43bb3d908b1e2f626be8fcdd055b993d237d`

## Goal

Bring Global Search, the mobile top-bar search entry, and the unauthenticated/loading surfaces into the same restrained mobile visual language already established by Home, Memory, Diary, and Task.

This is primarily a presentation and interaction redesign. Existing Global Search backend semantics, authentication provider behavior, detail routes, archived lifecycle rules, pagination, and search snapshot restoration remain intact unless explicitly noted below.

The visual acceptance pass comes after the first complete implementation batch. Fine spacing, font-size, icon optical alignment, shadow strength, and similar pixel-level details are intentionally tuned together during that pass rather than piecemeal during implementation.

## Scope

This batch contains three isolated UI surfaces:

1. Full `/search` Global Search page redesign.
2. Lightweight Quick Search opened from the mobile top-bar search icon.
3. Auth0 login, loading, and authentication-error visual simplification.

No Settings redesign is included in this batch.

## 1. Full Global Search page

### 1.1 Header

Use the same mobile heading geometry and visual hierarchy as Memory, Diary, and Task.

Left side:
- Main title: `Global Search`.
- Before a search has run, subtitle: `Memory · Diary · Task`.
- After a valid search has produced a response, subtitle: `<n>条结果`.
- `n` means the number of results currently loaded in the page, not an unavailable backend-wide total. It increases when more results are loaded.

Right side: exactly three tools, in this order:
1. Module.
2. Date.
3. Scope.

### 1.2 Module tool

Use the same four-square `DashboardIcon` already used by Memory's category control.

Popover behavior:
- `全部模块`
- `Memory`
- `Diary`
- `Task`

Module selection remains multi-select because cross-module search is the core value of Global Search.

Rules:
- Default: all three modules selected.
- The final remaining module cannot be deselected; an empty module set is not a valid UI state.
- `全部模块` restores all three modules.
- Existing search request semantics remain unchanged.

### 1.3 Date tool

Use the existing `CalendarIcon`.

Popover behavior:
- `全部时间`
- `自定义范围`

When custom range is active, reuse the accepted native date input language already used by Diary/Task rather than inventing a new date-control family.

Rules:
- Start-only and end-only ranges remain valid because the current backend supports one-sided date bounds.
- Start later than end shows the existing safe validation error and does not send an invalid request.
- Choosing `全部时间` clears both date boundaries.
- Do not add presets such as Today, 7 Days, or This Month in this batch.

### 1.4 Scope tool

Add one new neutral `ScopeIcon`/layers-style icon: two lightly offset rounded rectangles. The icon represents record scope rather than archive specifically.

Popover options:
- `当前`
- `已归档`
- `全部`

Rules:
- Default: `当前`.
- Map directly to existing backend scopes `active`, `archived`, and `all`.
- Do not use `ArchiveIcon` as the top-level scope icon because that would visually imply archived-only even when the active scope is selected.

### 1.5 Matching mode

Remove the `普通检索 / 精确短语` control from the visible UI.

Do not delete backend support for `normal` or `phrase`, and do not change the API/schema in this batch.

New Global Search interactions use the normal mode by default. Existing routing/parser compatibility for legacy URLs is preserved rather than performing a backend cleanup as part of a visual redesign.

### 1.6 Persistent search box

The search field is always visible directly below the page header. It is not hidden behind a search icon or another disclosure control.

Visual behavior:
- Reuse the accepted Memory/Diary/Task inline search-field language: restrained gray field, search icon at the left, no decorative card around it.
- Keep the real input font at iOS-safe 16px when required; optical sizing may be applied using the same established technique rather than reintroducing Safari focus zoom.
- Search remains debounced rather than requiring an explicit Search button.
- Preserve the current 200-character limit and safe query validation.

### 1.7 Initial, loading, empty, and error states

Before any searchable query exists, do not render result cards or generic system panels. Show only one light line of copy in the content area:

`搜索 Memory、Diary 与 Task 中保存的内容`

Loading state:
- Keep the page structure stable.
- Use a quiet inline `正在搜索…` status rather than a large loading card.

Valid search with zero matches:
- Show `没有找到匹配内容` as the single empty-state line.

Request failure:
- Show `搜索暂时失败` plus one restrained retry action.
- Preserve current safe retry behavior and stale-request protection.

### 1.8 Results layout

After search, results are grouped by module in fixed visual order:
1. Memory
2. Diary
3. Task

Do not render an empty group.

Each visible group contains:
- Group label using the established section-label hierarchy.
- One rounded white result card containing one or more result rows.

Within each module, preserve the order returned by the search API. Grouping changes presentation only; it does not create new ranking logic.

Each result row uses two information lines:
- First line: `stable_name`, falling back to the existing unnamed-record copy if needed.
- Second line: matched `snippet` on the left and a compact business date on the right.

Do not display category, mood, Task status, tags, `matched_field`, or `match_reason` as persistent row metadata in this redesign. The matched snippet itself answers why the item appeared.

Archived results:
- Show only a small, low-emphasis `Archived` text marker.
- Do not use a pill/badge.

The row remains a single clear detail-navigation target with accepted mobile touch sizing.

### 1.9 Pagination and count

Keep the current cursor-based pagination and `Load more` behavior/functionality.

When additional results are loaded:
- Deduplicate using the existing entity key behavior.
- Merge into the existing module groups.
- Update the subtitle count to the number of loaded unique results.
- Preserve current error/retry handling for load-more failures.

### 1.10 Detail navigation and restoration

Keep the existing Global Search snapshot/history behavior:
- Current search URL remains restorable.
- Loaded results remain restorable where the existing snapshot supports it.
- Scroll position and focused result restoration continue to work after returning from detail.
- Memory, Diary, and Task details continue to use their existing active/archived detail routes and safe return-target rules.

## 2. Mobile top-bar Quick Search

### 2.1 Entry behavior

The right-side search affordance in `MobileTopBar` changes from a direct `/search` link into a button that opens Quick Search.

This change applies only to the mobile top-bar search icon.

The existing `Global Search` item in the navigation drawer/sidebar continues to navigate directly to the full `/search` page.

### 2.2 Panel geometry and visual treatment

Quick Search is a lightweight floating panel anchored immediately below the mobile top bar.

Visual rules:
- White surface.
- No dark or gray backdrop/veil.
- The underlying page remains fully visible.
- Very light border and very light shadow provide separation.
- Mobile horizontal inset follows the established app rhythm, approximately 18–24px subject to visual acceptance.
- Rounded corners are restrained and visually related to the existing card family.
- The panel remains top-anchored when the software keyboard is open rather than recentering vertically.

### 2.3 Open and close behavior

On open:
- Focus the Quick Search input.
- Do not change route.
- Do not scroll the current page unnecessarily.

Close on:
- Clicking/tapping outside the panel.
- Pressing the top-bar search button again.
- Escape.
- Navigating to a result.
- Choosing `查看全部结果`.

No backdrop is rendered, so outside-click handling must not block normal layout after the panel closes.

### 2.4 Query behavior

Before input exists, render only the search field. Do not add `Search Leilei OS`, recent searches, suggestions, or instructional text in this batch.

Quick Search always searches:
- Modules: Memory + Diary + Task.
- Scope: active/current only.
- Mode: normal.
- No date bounds.
- Limit: 5.

The existing Global Search service already accepts `limit` from 1–25, so Quick Search should request `limit=5` rather than fetching a larger page and slicing client-side.

Use the existing query normalization, maximum length, abort/stale-request protection, and a short debounce consistent with the current full-page search behavior.

Do not search archived records in Quick Search.

### 2.5 Quick results

Quick Search results are mixed in the API's global result order rather than grouped, because this surface optimizes for fastest access.

Show at most five results.

Each result row contains:
- Small module label (`Memory`, `Diary`, or `Task`).
- Stable name/title.
- Short matched snippet.

Do not add module filters, date filters, scope controls, tags, status, mood, or metadata controls to this panel.

### 2.6 Quick result navigation

Selecting a Quick Search result navigates directly to the existing Memory/Diary/Task detail route.

To avoid broadening every module's safe return-target rules in this UI batch, the explicit detail `Return` target should be the full Global Search URL carrying the current query (`/search?q=...`) rather than an arbitrary originating page route.

Browser history still naturally retains the page from which Quick Search was opened.

### 2.7 View all results

When a non-empty query exists, render one low-emphasis footer action:

`查看全部结果`

It navigates to the full Global Search page with the normalized query, using default visible filters:
- All modules.
- Current scope.
- All time.
- Normal mode.

The full page then owns filtering, pagination, archived search, and date-range refinement.

## 3. Authentication surfaces

### 3.1 Login page

Replace the existing auth card with a full-viewport pure-white page.

Remove from the unauthenticated login surface:
- Card container.
- Border/shadow treatment.
- `L` brand mark.
- English eyebrow.
- `欢迎回到 Leilei OS` heading.
- Existing explanatory paragraph.
- Traditional filled/button-shaped login control.

New composition:
- Entire viewport: white.
- Content horizontally centered.
- Content vertically centered but optically shifted slightly upward; exact offset is tuned during visual acceptance rather than hard-coded as a design-system constant.
- Main line: `Leilei OS`.
- Below it, after clear breathing space: `使用 Auth0 登录`.

`使用 Auth0 登录` is the login action itself:
- Text-like control, not a bordered button.
- Light gray by default.
- Darker on hover/focus/active.
- Must retain a clear keyboard focus treatment even though it is visually minimal.
- Invokes the existing `loginWithRedirect()` behavior unchanged.

### 3.2 Auth loading page

Keep the existing loading animation, but place it on a pure-white full-viewport background.

Do not add a card or alternate tinted background behind it. The animation's own shadow should naturally render against white.

Preserve the existing accessible loading label.

### 3.3 Authentication error page

Bring the error surface into the same white/minimal language instead of restoring the legacy auth card.

Show only:
- A concise error heading.
- The existing safe Auth0 error message.
- A restrained text-like `重新登录` action using the same interaction language as the login link.

Do not expose new authentication internals or change Auth0 behavior.

## 4. Architecture and component boundaries

Keep concerns separated rather than making `GlobalSearchPage.tsx` or `AppShell.tsx` absorb all new behavior.

Preferred boundaries:
- Full-page search presentation stays in the Global Search page family.
- Quick Search gets its own focused component/state boundary under the layout/search UI area.
- `MobileTopBar` owns only the trigger interface, not request/ranking logic.
- `AppShell` coordinates whether the Quick Search panel is open and supplies the API/search capability needed by the panel, or delegates to a small container if that keeps the shell cleaner.
- Reuse shared search result types/query helpers where doing so reduces duplication without entangling full-page history state with the lightweight panel.
- Auth presentation changes remain isolated in `ProtectedApp` plus narrowly scoped CSS/classes.
- Add the new Scope icon to the shared icon module.

Do not perform unrelated file splitting or broad refactors during this batch.

## 5. Accessibility and mobile interaction requirements

- Top-bar search trigger remains at least a 44×44px touch target.
- Quick Search panel and menus use correct expanded/menu/dialog semantics appropriate to their behavior without treating the non-modal Quick Search as a blocking modal.
- Escape closes transient UI.
- Outside click closes Quick Search without trapping the pointer afterward.
- Search results remain keyboard reachable.
- Minimal text-like auth actions retain visible keyboard focus indication.
- Inputs preserve iOS focus safety.
- Safe-area handling from the existing mobile top bar remains intact.

## 6. URL and compatibility rules

Full Global Search continues to use URL-addressable filters so browser back/forward and detail return remain meaningful.

Visible UI state includes:
- `q`
- modules
- scope
- date range

Matching mode is no longer presented as a control, but backend support is not removed in this batch.

Quick Search itself does not write search state into the URL while open. It creates a Global Search URL only when opening all results or constructing a safe detail return target.

## 7. Testing strategy

Implementation follows RED → GREEN for behavioral changes.

Add/adjust focused tests for at least:

### Global Search page
- Header subtitle before search and after results.
- Exactly three visible tools and no matching-mode control.
- Module multi-select behavior and non-empty invariant.
- Date all/custom behavior and validation.
- Scope active/archived/all mapping.
- Persistent search field.
- Initial/loading/empty/error copy.
- Module grouping order and omission of empty groups.
- Result row uses stable name + snippet + date and no legacy match-reason metadata.
- Archived marker presentation contract.
- Pagination still merges/deduplicates and updates loaded count.
- Existing history/snapshot/detail-return tests remain green.

### Quick Search
- Top-bar button opens panel without route navigation.
- Input receives focus.
- No backdrop is rendered.
- Blank query performs no request.
- Request uses all modules + active scope + normal mode + `limit=5`.
- Stale/aborted requests cannot overwrite newer results.
- At most five mixed results are rendered.
- Outside click, repeated trigger, Escape, result navigation, and View All close the panel.
- View All generates the correct `/search?q=...` URL.
- Quick result detail return target is the full search query URL.
- Drawer/sidebar Global Search still enters `/search` directly.

### Authentication
- Logged-out page has no legacy auth card/brand-mark/eyebrow copy.
- Login action still invokes Auth0 redirect.
- Loading page remains accessible and uses the pure-white auth surface.
- Error page stays minimal and retry invokes Auth0 redirect.

### Final verification
- Relevant focused tests.
- Deterministic serial full test suite.
- Root typecheck and build.
- Web typecheck and build.
- `git diff --check`.
- Visual mobile preview at the accepted phone size.

No implementation commit/merge/push occurs before visual acceptance of the completed UI batch. Preview helper files remain untracked and must not be committed.

## 8. Visual acceptance batch

The first implementation should intentionally reach one complete preview containing:
- Full Global Search initial state.
- Full Global Search populated state.
- Module/date/scope menus.
- Quick Search closed/open/with-results states.
- Login state.
- Auth loading state.
- Auth error state if practical to fixture safely.

Then perform one consolidated visual correction pass for spacing, typography, icon optical offsets, menu geometry, result density, panel width/radius/shadow, and auth vertical placement.

This matches the agreed workflow: finish the coherent feature first, then adjust concrete visual details together rather than iterating one pixel at a time during construction.

## 9. Explicit non-goals

This batch does not:
- Redesign Settings.
- Add semantic/vector search.
- Add recent searches or search history.
- Add Quick Search filters.
- Add date presets beyond All Time and Custom Range.
- Delete phrase-mode backend support.
- Change Auth0 configuration or identity semantics.
- Change Memory/Diary/Task business data or lifecycle rules.
- Expand detail safe-return rules to arbitrary app routes.
- Add new backend ranking logic.
- Commit preview helper files.
