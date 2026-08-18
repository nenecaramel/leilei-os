# Mobile Home Shell Visual Prototype

## Goal

Create a first, mobile-first visual prototype for Leilei OS Home and App Shell that is safe to evaluate in a Vercel Preview without connecting any new product behavior.

## Scope and boundaries

- Home uses only typed local fixture data for L, G, Sticky, and Calendar previews.
- Memory, Diary, Task, Day Space, Calendar, Sticky, and Todo APIs are not called by Home.
- Day Space is a disabled navigation placeholder; no new route is added.
- Existing authenticated routes, API clients, database, migrations, MCP tools, and write behavior remain unchanged.
- No new UI framework or runtime dependency is introduced.

## App Shell design

`AppShell` remains the authenticated route layout and keeps the desktop sidebar, but navigation is represented as three explicit groups: Core, Utilities, and System. The labels become Home, Global Search, and System while route paths stay `/`, `/search`, and `/settings`. Day Space is rendered as a disabled item with an unavailable treatment instead of a link. Chat Archive and Universe retain their existing placeholder routes.

On screens up to 760px, a compact `MobileTopBar` appears with a menu button, centered Leilei OS label, and a `/search` icon link. `MobileNavigationDrawer` renders the same grouped navigation in a dialog-like side sheet. It owns open/close state, Escape and backdrop handling, `aria-expanded`, `aria-controls`, `aria-modal`, focus return, and body-scroll locking. Desktop retains a compact sticky sidebar and does not render the mobile drawer as an extra visible navigation system.

## Home design

`DashboardPage` becomes a static Home composition with this order:

1. Today row with a non-functional plus affordance.
2. Clickable `TodayPanel` for L.
3. Clickable `TodayPanel` for G.
4. Two-column `StickyPreview`.
5. Seven-column `CalendarPreview`.

`TodayPanelDialog` is a reusable dialog for both authors. It uses the same `HomeNote` structure as the compact panels, contains its own scroll region, closes through backdrop/X/Escape, and restores focus to the invoking panel. The dialog is a read-only visual prototype. Sticky and Calendar are also read-only fixture previews.

## Fixture contracts

`web/src/pages/home-prototype-data.ts` exports `HomeAuthor`, `HomeNoteKind`, `HomeNote`, and `HomeSticky` plus named L/G/sticky/calendar fixture collections. JSX consumes these values rather than embedding content. All labels and example copy are non-sensitive, static, and easy to replace.

## Visual system

Existing theme variables and `SettingsProvider` remain the single source of accent/theme state. New Home/App Shell styles are grouped in `web/src/styles.css`, use the existing CSS variables, and avoid hero/orbit/glow/large-gradient treatments. Light and dark surfaces are restrained, with clear `:focus-visible`, safe-area padding, 44px touch targets, and no page-level horizontal overflow at 320px or 390px.

## State and accessibility

- Drawer and dialogs use real buttons, links, and dialog semantics.
- Opening a drawer/dialog locks body scrolling and restores it on close.
- Focus returns to the menu or panel trigger after close.
- Home rendering is independent of authenticated API loading state; auth and existing route guards remain unchanged.

## Test contract

Tests cover grouped navigation labels and disabled Day Space, drawer ARIA/close/scroll behavior, Home fixture rendering, L/G dialog interaction, API non-use, safe-area and 320px overflow contracts, and preserved existing route builds. Component behavior uses the repository's JSDOM/React test style where practical; source/CSS assertions are limited to layout contracts that cannot be measured in JSDOM.
