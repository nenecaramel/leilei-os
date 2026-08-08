# Memory Redesign Design

Date: 2026-08-07
Branch: `leilei/memory-redesign-2026-08-07`
Base: `codex/phase-6-web-ui-foundation`

## 1. Goal

Redesign the mobile Memory experience so it visually and behaviorally matches the current Leilei OS Home language while preserving the existing Memory data model, navigation semantics, lifecycle protections, and archive behavior, with only the explicitly accepted active-Web update expansion for key and category.

This batch remains primarily a mobile UI redesign, but the accepted visual-editing model requires one bounded capability expansion: existing active Memory records must support updating key and category in addition to content and tags. This must extend the existing authenticated Web update path without changing the database schema, archive semantics, MCP contracts, or identity rules.

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
- Editing archived Memory records.
- Adding author/signature persistence in this batch.
- Adding new Memory endpoints; the existing authenticated `PATCH /memory` may be extended only to accept the already-existing `key` and `category` fields.
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

Extend the existing authenticated update path so an active Memory can update:

- `id`
- `key`
- `category`
- `content`
- `tags`

No schema migration is required because all four editable values already belong to the Memory record.

Validation and ownership remain server-controlled. Category remains restricted to the existing legal category enum. Archived Memory records remain read-only. MCP Memory contracts are unchanged.

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

Accepted icon refinements:

- category is a literal 2 × 2 set of four small independent squares, not an ambiguous grid glyph;
- search glyph must have the same perceived visual weight as the neighboring tools;
- archive must read clearly as archive storage, using an archive box/tray semantic rather than an indistinct generic symbol;
- create pen is horizontally mirrored so its stroke direction visually reads like a right hand raising a pen to write;
- all controls retain 44 × 44px hit targets even when the glyph itself is smaller.

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
- the expanded search shell is the only visible field surface; the inner input remains transparent and borderless on focus, with no second rectangle, browser-style inset field, or duplicate focus box;
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

Opening a Memory continues to use the existing detail URL/history state and `/memory/:id` fetch, but the visible active Memory page must remain mounted and visually stationary underneath. Opening detail must not replace the list background with a detail-page header or otherwise make the page appear to navigate away. The paper overlays the unchanged Memory list exactly like the Home Todo paper experience.

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

Editing happens directly on the same open paper. It must feel like writing on the Todo paper, not like placing a conventional form inside a dialog.

Editable active-Memory fields:

- `key`;
- `category`;
- `content`;
- `tags`.

### Paper-native editing

- The key occupies the title position at the top of the paper. Clicking Edit turns that same title area into a borderless editor in place.
- Key text uses the title typography even when it wraps to multiple lines. A long key must not shrink into body typography or switch visual component style.
- Content remains in the body position and becomes a borderless paper-native textarea/editor in place.
- Tags are edited from the bottom-left metadata area without a boxed input appearance.
- Category is chosen from a lightweight anchored selection menu limited to the existing legal categories: Profile, Preference, Goal, Project.
- No visible rectangular `input`, `select`, or `textarea` chrome may appear on the paper.
- Paper rules, spacing, and corner metadata remain visible while editing.

The top-right controls transition from `归档 · 编辑` to concise `取消 · 保存` controls in the same metadata language.

Cancel restores fetched values. Save updates key, category, content, and tags through the existing authenticated update path. Existing unsaved-change, single-flight, ownership, and inline mutation-error protections remain.

## 10. Create state

The pen tool opens the same `PaperDetailDialog` directly in paper-native edit mode.

The create paper must not render a conventional stacked form.

- The first paper line/title area is the key editor. Any entered key uses the same slightly larger title typography.
- The body area below is the content editor.
- Bottom-left displays editable `category · tags` metadata.
- Category uses the same lightweight legal-category selector as active edit.
- Tags are edited inline from the bottom-left metadata area.
- Inputs remain visually borderless and transparent so the user appears to write directly on the paper.
- The paper geometry and ruled background remain the same as detail and Todo.

Trimmed key and content remain required before Save is enabled.

Quick-create continues to open this paper and focus the key position once. Unsaved create content remains protected by the existing dirty-state mechanism.

The bottom-right signature remains fixed `N` in this batch. The signature slot should remain structurally reusable for a future directly editable signature, but no author/signature persistence is added now.

## 11. Archive views

### Archive list

The archive tool switches into the existing archive route/state.

Archive list uses the same month-group/card/row visual language as active Memory.

Archive mode does not expose active-list category, tag, or search controls in this batch.

The archive header must use the same geometry and typography as the active Memory header:

- title: `Archive`;
- subtitle: `n条记忆`;
- identical title/subtitle positions, font sizes, and vertical rhythm to `Memory`;
- return control is small borderless text with a 44px tap target and visual height aligned with the active Memory tools.

The first archive month label and first month card must begin at exactly the same vertical position as the corresponding active Memory list. Archive month labels, cards, and rows reuse the same active-list classes rather than maintaining archive-specific spacing.

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

### Paper geometry lock

Memory detail, edit, create, and archived detail must use the same `PaperDetailDialog` geometry as Todo. In particular, Memory must not override the Todo paper width, height, viewport placement, top-left date coordinates/typography, or bottom-right signature coordinates/typography.

The accepted interaction model is: unchanged Memory page behind, paper overlay above, body scroll locked behind the paper, and only the paper content region scrolling for long content.

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
- active edit exposes paper-native key/category/content/tags editing;
- active edit PATCH submits key/category/content/tags while preserving authentication and active-record restrictions;
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
- edit state directly on the same paper with no visible form boxes;
- create directly on the paper with no visible form boxes;
- background Memory list remains visually stationary while detail/edit/create paper is open;
- archive title is `Archive` and its title/count geometry matches active Memory;
- archive return is borderless compact text;
- archive first month label/card geometry matches active Memory;
- archive list;
- archived detail/restore paper;
- long content scrolling while paper corners remain fixed;
- top-left date/time matches Todo corner typography;
- top-right and bottom-left metadata use the same small paper metadata language;
- bottom-right fixed `N` signature matches Todo paper typography and placement;
- close/back returns to the same filters and scroll position.

## 17. Implementation constraint summary

The redesign succeeds only if Memory adopts the Home/Todo visual and interaction language without weakening its lifecycle, ownership, navigation, or mutation-safety semantics.

Preserve the existing controller behavior wherever possible. The only accepted API-contract expansion in this batch is extending the existing active Web Memory update path to allow the already-existing `key` and `category` fields alongside `content` and `tags`. No schema migration, new endpoint, archived editing, MCP contract change, or signature persistence belongs in this batch.
