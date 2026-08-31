# Desktop UI Unification Design

## Goal

Bring the Leilei OS desktop experience into one coherent visual system without reopening product behavior, durable data semantics, API contracts, or the mobile UI that is already in good shape.

The finished desktop experience should feel like the same product as the current mobile experience, but not like a stretched mobile layout. Desktop may use denser information presentation, a persistent sidebar, wider content regions, and multi-column composition where that genuinely improves scanability.

## Existing visual baseline

The visual reference is the group of desktop pages that are already considered substantially complete: Home, Sentinel, and the System surfaces. Universe is close enough to act as a secondary reference, but its known internal visual defects are explicitly deferred during the early phases of this project.

Those reference pages establish the direction:

- neutral white / gray surfaces rather than the older green-heavy product shell;
- restrained borders and shadows;
- content-first composition;
- smaller, calmer controls;
- clearer hierarchy through spacing, type weight, and surface contrast instead of large gradients, decorative hero treatments, or oversized rounded cards;
- dark surfaces only where they are intentionally part of the page identity, as in Universe.

The current `AppShell` structure remains usable: a persistent desktop sidebar plus a routed content area. The project should replace the old desktop visual language around that structure rather than rebuild routing or navigation behavior.

## Scope

This project has three layers.

### 1. Desktop shell and foundation

First unify the visual foundation used by every desktop route:

- app background and content surface behavior;
- desktop sidebar width, spacing, brand area, navigation groups, active / hover states, and account footer;
- page gutters, maximum content widths, vertical rhythm, and top spacing;
- typography hierarchy for page titles, section titles, supporting copy, labels, and metadata;
- neutral borders, separators, radii, shadows, and focus states;
- shared buttons, inputs, selects, textareas, popovers, dialogs, pills, and empty / loading / error treatments where those are globally shared;
- neutral text selection color, replacing the remaining green selection treatment;
- desktop-only responsive behavior at widths above the existing mobile breakpoint.

This foundation must be visually compatible with Home, Sentinel, System, and Universe before any legacy page is redesigned around it.

### 2. Legacy desktop page alignment

After the foundation is accepted, align the older pages in this order:

1. Memory
2. Diary
3. Task
4. Global Search
5. Universe

For Memory, Diary, Task, and Global Search, the work is allowed to substantially change desktop presentation and information density while preserving all existing functionality and data behavior.

Universe receives only shell alignment and obvious consistency fixes during this sequence. Its known internal visual bugs are not bundled into the first pass; they remain a later, separately reviewable polish task unless a shell change exposes a regression that must be fixed immediately.

### 3. Cross-page detail pass

After all target pages share the same visual language, perform one final detail pass across the complete desktop product, including the already-good reference pages. This phase is for alignment, spacing, density, hover / focus states, minor typography inconsistencies, empty / loading / error consistency, and viewport-specific issues. It is not a second redesign of Home, Sentinel, or System.

## Desktop shell design

### Sidebar

The sidebar becomes a quiet, monochrome navigation rail rather than a branded green panel.

The brand area should be text-first. `Leilei OS` remains the primary label; decorative secondary copy such as `Personal space` should be removed unless it serves a real navigation or status purpose. The existing green square `L` treatment should become a small neutral mark or be simplified enough that it no longer dominates the shell.

Navigation keeps the existing information architecture and route behavior. Group labels may remain, but they should be visually subordinate. Items use a flat icon + label row with restrained spacing. The active route is communicated through a soft neutral surface, darker text, and weight rather than a strong accent fill. Hover is subtle and should not shift layout or create playful motion such as horizontal translation.

The account footer remains available but visually quiet: neutral avatar, truncated identity text, and a low-emphasis sign-out action. It must not compete with navigation.

The first implementation should target a compact desktop sidebar in roughly the 220–240px range, with exact dimensions chosen in preview based on balance with the existing content pages.

### Main content region

Desktop routes share a consistent horizontal gutter system and top rhythm. Content should not inherit one fixed narrow `page` width if the page benefits from a denser desktop layout; instead the foundation provides a small set of supported content widths:

- reading / form width for text-heavy or edit surfaces;
- standard application width for most list and detail pages;
- wide application width for dense search, system, or multi-column surfaces.

Pages select from those shared widths instead of inventing arbitrary margins.

At approximately 1024px the layout must still be comfortable with the sidebar present. At 1280px and 1440px the design should use available space without creating very long text lines or giant empty margins.

## Visual foundation

### Color

The desktop foundation is neutral. Shared shell and control states use black, off-black, white, warm / neutral gray, and subtle border gray. Green is no longer the default visual identity for global shell elements, selection, shared buttons, inputs, or active navigation.

Existing theme variables may remain for features that genuinely use theme state, but the desktop shell should not be driven by the old green `--theme` family. The implementation should introduce or normalize semantic neutral variables rather than scatter new hard-coded grays across pages.

Universe is an intentional exception: its dark visual identity is preserved inside its page surface.

### Typography

Desktop typography should align with the current restrained pages rather than the older editorial `Newsreader` hero language. Large page headings should no longer default to oversized serif display treatment. Hierarchy should come from a consistent sans-serif stack, weight, size, and spacing.

Exact font-family changes must be kept minimal: no new runtime UI framework and no unnecessary font dependency. If the current finished pages already establish a suitable stack, reuse it.

### Surfaces

Large rounded cards, gradients, orbit decorations, strong glows, and prominent drop shadows are not part of the global desktop system.

Normal application surfaces use either no container at all or a simple white / near-white surface with a fine border. Shadows are reserved for floating layers such as dialogs, menus, and popovers, or for rare cases where elevation communicates interaction.

Corner radius is reduced and standardized. Pills remain only where the object is semantically pill-shaped, such as compact status metadata; they are not the default button or navigation shape.

### Interaction states

Hover, active, focus-visible, selected, disabled, loading, and error states must share one vocabulary across pages. Interactive movement should be minimal. Focus-visible remains clearly visible and accessible in both light and dark page contexts.

## Page alignment strategy

### Memory

Treat Memory as the first proof that the new foundation works on a real legacy page. Preserve filters, search, item selection, create / edit / archive / restore behavior, and current visibility semantics. Redesign desktop layout for better scanning and denser use of horizontal space.

The Memory pass establishes reusable patterns for list rows / cards, filter bars, metadata, and detail / editor surfaces that Diary and Task can reuse.

### Diary

Diary should inherit the Memory-era shell and control language but preserve its distinct reading / paper character. Desktop may use a wider split or staged composition when helpful, but reading line length stays controlled. Existing editor, date navigation, provenance, and persistence behavior remain unchanged.

### Task

Task adopts the same filters, controls, metadata, dialogs, and surface rules. The goal is to stop looking like a separate legacy mini-app while preserving task-specific due-date and status interactions.

### Global Search

Global Search should be the densest of the aligned pages. Results should use the same typography and metadata primitives as the source domains while remaining easy to distinguish by domain. Search behavior, result ordering, staged retrieval, and navigation remain untouched.

### Universe

Universe keeps its dark identity and existing domain behavior. This phase aligns the page with the new shell boundary, typography / spacing expectations, and shared interaction states where appropriate. Known internal visual defects are deferred unless they are directly caused or exposed by the shell work.

## CSS and component architecture

The project must not continue solving desktop consistency by appending a large chain of overrides to the existing `web/src/styles.css`, which is already oversized and mixes shell, controls, pages, mobile behavior, and historical styles.

The target structure is deliberately small:

- keep global reset / truly universal rules in `styles.css`;
- create a dedicated desktop foundation / shell stylesheet for neutral tokens, desktop layout, sidebar, shared spacing, and shared desktop controls;
- keep page-specific desktop rules close to their page or in clearly named page-level styles rather than a new all-pages mega-file;
- keep desktop rules scoped to the existing desktop breakpoint so accepted mobile behavior does not silently change.

React restructuring is allowed only when a shared visual primitive is already duplicated enough that extraction reduces risk. This project is not permission for broad component architecture cleanup.

## Behavior and data boundaries

This is a presentation project.

No phase may intentionally change:

- API request or response contracts;
- database schema or migrations;
- Memory / Diary / Task / Todo / Universe domain semantics;
- ownership or visibility rules;
- Auth0 behavior;
- MCP behavior;
- service-worker durable-data behavior;
- routing paths or deep-link semantics;
- mutation idempotency, revision, CAS, or conflict behavior.

If a visual change reveals a real functional defect, stop and split that defect into its own bounded task unless it is required to prevent the UI change from breaking an existing flow.

## Mobile protection

The current mobile experience is treated as protected behavior throughout this project.

Desktop styling should be scoped above the existing mobile breakpoint wherever possible. Shared component edits must be checked at 320px and 390px before merge. Mobile top bar, drawer, safe-area behavior, touch targets, dialogs, and current page-specific mobile layouts must remain intact.

A desktop improvement that requires an avoidable mobile visual change should be redesigned rather than accepted by default.

## Delivery strategy

Do not ship the entire redesign in one pull request.

The implementation plan should create a sequence of independently reviewable PRs with visual acceptance between major phases:

- shell / foundation first;
- then one page family at a time in the agreed order;
- then the final detail pass.

The shell / foundation PR is the visual gate. Downstream page work starts only after its Vercel Preview is accepted, because every later page will inherit its spacing, colors, sidebar, and controls.

Each page PR should stay presentation-scoped and avoid bundling unrelated cleanup.

## Verification and acceptance

Every implementation PR should run the existing relevant component / regression tests plus repository typecheck and build checks. New tests should focus on durable layout contracts and interaction semantics rather than brittle pixel snapshots.

Visual acceptance uses Vercel Preview and production after merge. At minimum, inspect desktop widths around 1024px, 1280px, and 1440px plus mobile 320px and 390px for regression protection.

A phase is accepted when:

- the target pages clearly belong to the same desktop product as Home / Sentinel / System;
- the sidebar and content frame remain stable while navigating between routes;
- no route has accidental horizontal overflow or obviously wasted desktop space;
- shared controls and states look and behave consistently;
- Universe remains intentionally dark rather than being forced into the neutral light surface system;
- mobile remains visually and behaviorally intact;
- no domain or data semantics changed as part of the visual work.

## Explicit non-goals

- Redesigning Home, Sentinel, or System from scratch.
- Fixing every known Universe internal visual defect during the shell phase.
- Creating a new design-system package or UI framework.
- Replacing routing, authentication, API clients, or persistence architecture.
- Converting the desktop app into a stretched mobile layout.
- Refactoring unrelated legacy code merely because the project touches the same file.
