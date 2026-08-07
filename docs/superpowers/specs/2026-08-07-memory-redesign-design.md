# Memory Redesign Design

Date: 2026-08-07
Branch: `leilei/memory-redesign-2026-08-07`
Base: `codex/phase-6-web-ui-foundation`

## 1. Goal

Redesign the mobile Memory experience so it visually and behaviorally matches the current Leilei OS Home language while preserving the existing Memory data model, API contracts, navigation semantics, lifecycle protections, and archive behavior.

This batch is a UI redesign, not a backend capability expansion.

Primary acceptance viewport: `393 × 852`.

## 2. Scope

### In scope

- Replace the current Dashboard-style Memory page shell with the approved Home-derived mobile visual language.
- Add the approved Memory page header with compact page-level tools.
- Group active Memory rows by `updated_at` month.
- Replace individual Memory cards and “查看详情” buttons with whole-row interactions inside one Home-style card per month.
- Render active Memory detail, edit, and create flows inside the existing paper-detail visual system used by Todo.
- Restyle archive list/detail to the same Memory visual language.
- Preserve existing loading, empty, filtered-empty, request-error, and mutation-error semantics while changing their presentation.
- Preserve existing URL filter/history behavior, detail/archive return paths, scroll restoration, quick-create, single-flight mutation protection, latest-request handling, and unsaved-change protection.
- Add/adjust focused tests for the new visible structure and month grouping while retaining existing lifecycle tests.

### Out of scope

- Changing the Memory database schema.
- Adding author editing or author display as a new Memory field.
- Editing `key` after creation.
- Editing `category` after creation.
- Editing archived Memory records.
- Adding new backend endpoints or extending `PATCH /memory`.
- Changing desktop layout or desktop-specific visual design beyond keeping it functional.
- Refactoring unrelated pages.

## 3. Existing behavior to preserve

The current `MemoryPage` already implements mature behavior that must survive the redesign:

- list fetches with query/category/tag filters;
- 300ms search debounce;
- URL-backed filter state and browser history restoration;
- detail and archive return paths;
- scroll-position save/restore;
- active and archived detail loading;
- quick-create intent consumption;
- create/update/archive/restore mutation ownership and submission gating;
- unsaved-change confirmation;
- stale request invalidation and abort handling.

The implementation should therefore preserve the current state/data-flow layer and replace the presentation layer around it. Avoid a broad page rewrite unless a small extraction materially improves clarity or testing.

## 4. Data and API rules

### Active list

Continue using the existing Memory list request with `ordering: "updated_desc"`.

The client may group the already ordered records into month sections for presentation. It must not redefine server ordering.

### Create

Continue using the existing create endpoint and fields:

- `category`
- `key`
- `content`
- `tags`

The current requirement that trimmed `key` and `content` are non-empty remains unchanged.

### Edit

Continue using the existing update endpoint with only:

- `id`
- `content`
- `tags`

`key` remains read-only after creation.

`category` remains read-only after creation because the current API does not support category updates. The redesign must not imply that category is editable.

### Archive / restore

Continue using the existing archive and restore paths and their current confirmation/error semantics.

## 5. Page architecture

Use the existing shared global `MobileTopBar` unchanged.

Inside Memory, keep one page controller (`MemoryPageContent`) responsible for data and lifecycle state. Small presentational helpers/components may be introduced for bounded responsibilities such as:

- page header/tools;
- month grouping;
- month section/card;
- Memory row;
- Memory paper content;
- category/tag popovers;
- compact status/empty/error states.

Do not split business state across many new controller components. The goal is to isolate rendering without moving or duplicating navigation/mutation logic unnecessarily.

## 6. Active Memory page

### Header

Under the global top bar, show a compact Memory page header.

Left side:

- title: `Memory`;
- subtitle: `n条记忆` in small light-gray text.

Right side, fixed order:

1. category tool — four-square/grid icon;
2. tag tool — `#`;
3. search tool — magnifying glass;
4. archive tool — archive-box icon;
5. create tool — pen icon.

These are page-level tools and must look one visual level smaller than the global top-bar controls.

### Category and tag filters

Category and tag tools open small white popovers anchored near their trigger.

- Category menu exposes the available categories plus the all/clear state.
- Tag menu exposes available tags plus the all/clear state.
- The selected item uses a subtle gray selection background and/or check indication.
- Closing and changing filters must preserve current URL/history semantics.

### Search

Search does not use a popover.

When activated, a full-width light-gray search field expands below the page header.

- left: search icon;
- middle: input;
- right: clear/close `×`;
- current 300ms debounce remains;
- current URL filter state remains;
- typing updates results with existing request-cancellation/latest-request protections.

Closing search must not silently discard a non-empty active query unless the explicit clear action is used.

## 7. Active list presentation

Remove the current separate “记忆列表” information block, standalone Memory cards, and per-card “查看详情” buttons.

### Month grouping

Group records by local display month derived from `updated_at`, labeled:

`yyyy年m月`

Rules:

- month sections newest to oldest;
- rows within a month remain newest to oldest;
- no collapsing;
- no pagination introduced in this UI batch;
- each month has one Home-style outer card whose height grows naturally with its row count.

Invalid/unparseable timestamps must not crash grouping. They should fall into a deterministic fallback section such as `时间未知`, after dated groups.

### Memory row

Each Memory occupies one whole clickable row.

First line:

- use `key` when non-empty;
- otherwise use the first non-empty line of `content`;
- single line;
- ellipsis on overflow.

Second line:

- left: compact date;
- right: `category · tags`;
- single line;
- ellipsis on extreme overflow.

If there are no tags, show category only and do not leave a dangling separator.

Rows use subtle dividers between siblings and a very light press/active feedback. No chevron or separate “view” button is required.

The entire row is the trigger for detail.

## 8. Active detail paper

Opening a Memory continues to use the existing detail URL/history state and `/memory/:id` fetch. The visual presentation becomes a paper overlay rather than a standalone page-like message block.

Reuse `PaperDetailDialog` rather than recreating the Todo paper shell. This preserves the existing dialog semantics, body scroll lock, focus containment, Escape behavior, veil close behavior, trigger focus restoration, fixed date/signature corners, paper rules, and paper geometry.

### Paper corners

The corner typography should reuse the Todo paper metadata language.

- top-left: Memory date/time, using the same `.paper-detail-date` typography and placement as Todo;
- top-right: `归档 · 编辑`, styled in the same small metadata type family rather than as large button blocks;
- bottom-left: `category · tags`, same metadata type family;
- bottom-right: fixed signature `N`, using the same Todo paper signature typography, placement, and visual treatment through `PaperDetailDialog`'s existing signature slot.

The `N` is a fixed Memory paper signature only; it does not represent or introduce an author field.

The existing Todo contract includes a top-left date around `13px` and the existing bottom-right signature treatment; Memory should reuse those primitives rather than invent substitutes.

### Detail body

- If `key` is non-empty, show it near the top of the body, slightly larger than body copy.
- If `key` is empty, omit the title slot entirely; do not substitute the first content line as a fake detail title.
- Show full Memory `content` in the body.
- Long content scrolls inside the paper's existing scroll region while corner metadata remains fixed.

### Close behavior

Closing by veil/Escape/back action must continue to honor unsaved-change protection.

Returning from detail must restore the prior list URL, active filters, and saved scroll position using existing helpers.

## 9. Edit state

Editing happens inside the same open paper instead of switching to a different visual shell.

Read-only fields:

- `key`;
- `category`.

Editable fields:

- `content`;
- `tags`.

Save uses the current update request shape only.

Cancel restores the fetched Memory values and continues to use current unsaved-change confirmation rules when appropriate.

The top-right controls may transition from `归档 · 编辑` to concise edit-state actions such as `取消 · 保存`, but remain in the same small paper-control language.

Mutation errors should appear inside/adjacent to the paper content using the existing `PaperDetailDialog` error capability where practical, not as a large page-level alert block.

## 10. Create state

The pen tool opens a new paper editor using the same paper shell and visual hierarchy as detail/edit.

Fields:

- category selector;
- key input;
- content textarea;
- tags input.

Create validation remains unchanged: trimmed key and content are required.

The create paper must preserve quick-create behavior: an external Memory quick-create intent should open the create paper and focus the key field once, while detail/archive states continue to suppress hidden create UI.

Unsaved create content remains protected by the existing dirty-state mechanism.

## 11. Archive views

### Archive list

The archive tool switches into the existing archive route/state.

Archive list uses the same month-group/card/row visual language as active Memory.

Archive mode does not expose active-list category, tag, or search controls in this batch.

The header clearly indicates archive context and offers a concise return control.

### Archived detail

Archived detail uses the same paper shell.

- read-only body;
- no edit action;
- restore is the primary action;
- return behavior follows the existing archive return path and scroll restoration.

After a successful restore, continue using the current logic that returns to the active Memory list.

## 12. Status states

### Loading

Use lightweight skeleton rows/cards shaped like the final month-list presentation rather than the old generic Memory cards.

### Empty active list

When there are no active memories and no filters, show a restrained empty state such as `还没有记忆` with no oversized decorative treatment.

### Filtered empty list

When q/category/tag is active but no result matches, explicitly communicate `没有匹配的记忆` and provide a clear-filter path.

### Request error

Show a compact error state with the existing retry behavior.

### Mutation error

Keep errors near the operation that failed, preferably inside the active paper for create/edit/archive/restore flows.

Do not expose private server details.

## 13. Accessibility and interaction

- Page-level icon controls require accessible labels.
- Popovers must be keyboard reachable and have explicit close behavior.
- Whole-row triggers must remain keyboard operable.
- Paper detail/create/edit/archive-detail reuse `PaperDetailDialog`'s dialog semantics and focus behavior.
- Minimum mobile hit target remains `44 × 44px` where a control is directly tappable; visual glyphs may remain smaller.
- Disabled/busy states must prevent duplicate mutation requests as they do today.

## 14. Styling direction

Continue the approved Home / global mobile language:

- white page background;
- near-black text;
- light gray secondary text;
- light borders;
- restrained shadows;
- restrained radius;
- Apple system font stack;
- no gradient, texture, illustration, or theme-color fill.

Month cards should visually relate to Home cards rather than the old Dashboard `.memory-card` appearance.

Paper views should use the existing Todo paper primitives instead of duplicating paper geometry or corner typography.

## 15. Testing strategy

Implementation follows small-step TDD.

### Existing behavior tests to keep green

Retain the current Memory tests covering:

- quick-create;
- detail/archive navigation;
- URL filters/history;
- scroll restoration;
- latest request handling;
- unsaved changes;
- create/update/archive/restore API calls;
- duplicate-submission prevention;
- active/archived lifecycle behavior.

### New focused tests

Add or update tests for:

- active list no longer renders the old “记忆列表” block or “查看详情” buttons;
- month grouping from `updated_at`;
- month and row ordering;
- fallback behavior for invalid timestamps;
- key-or-content-first-line row title rule;
- category/tags metadata formatting without dangling separators;
- whole-row detail trigger;
- compact header tool order and accessible labels;
- category/tag popover selection behavior;
- expandable search shell while retaining existing debounce/URL behavior;
- `PaperDetailDialog` reuse for detail/create/edit/archived detail;
- detail title omission when key is empty;
- active edit exposes content/tags but not editable key/category;
- archive detail is read-only and exposes restore;
- fixed bottom-right Memory signature is `N` and reuses the Todo paper signature primitive;
- Todo paper date/signature primitives are reused rather than duplicated by separate paper geometry.

### Final verification

Before integration:

1. focused Memory tests;
2. relevant Todo paper tests when shared paper primitives are touched;
3. `npm --prefix web run typecheck`;
4. full `npm test`;
5. `git diff --check`;
6. `git status --short` confirming preview helpers remain untracked and unstaged;
7. mobile visual acceptance at `393 × 852` through the local preview path.

## 16. Visual acceptance checklist

On mobile, verify:

- global top bar remains unchanged;
- Memory title/count hierarchy;
- five page tools and their order;
- category and tag popovers;
- search expand/collapse and filtered states;
- multiple month sections and variable row counts;
- long titles/tags truncation;
- row press/click behavior;
- active detail paper;
- edit state in the same paper;
- create paper;
- archive list;
- archived detail/restore paper;
- long content scrolling while paper corners remain fixed;
- top-left date/time matches Todo corner typography;
- top-right and bottom-left metadata use the same small paper metadata language;
- bottom-right fixed `N` signature matches Todo paper typography and placement;
- close/back returns to the same filters and scroll position.

## 17. Implementation constraint summary

The redesign succeeds only if it changes what Memory looks and feels like without silently changing what Memory means.

Preserve the existing controller semantics and API contracts; introduce only the presentation helpers necessary to express the approved design. Any newly discovered requirement that needs schema/API expansion must be split into a later batch rather than folded into this redesign.
