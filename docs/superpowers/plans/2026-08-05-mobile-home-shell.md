# Mobile Home Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fixture-only, mobile-first Home page and grouped App Shell drawer while preserving all existing API, route, database, migration, MCP, and write behavior.

**Architecture:** Keep `AppShell` as the authenticated layout and extract small `MobileTopBar`, `MobileNavigationDrawer`, `NavigationGroups`, and Home prototype components. Home data lives in a typed fixture module; the page renders no authenticated data requests. New CSS stays in clearly named App Shell/Home sections of `web/src/styles.css` and uses existing theme variables.

**Tech Stack:** React 19, React Router, TypeScript, existing JSDOM/React node tests, CSS custom properties, Vite.

## Global Constraints

- Use the verified base `7dfd696ffd65673915284cab8bf27e8be433d9f1`.
- Work only in the isolated worktree `/Users/Admin1/Documents/Codex/leilei-worktrees/mobile-home-shell-prototype`.
- Do not add dependencies or modify backend, API, database, migrations, MCP, or write paths.
- Home uses fixture data only and must not call `/memory`, `/diary`, or `/task`.
- Keep all existing routes and authentication behavior intact.
- Commit documentation first, then implementation commits, and finish with a Draft PR only.

### Task 1: Commit the approved design documents

**Files:**
- Create: `docs/superpowers/specs/2026-08-05-mobile-home-shell-design.md`
- Create: `docs/superpowers/plans/2026-08-05-mobile-home-shell.md`

- [x] **Step 1: Write the design and implementation documents**

  The spec defines the grouped shell, fixture-only Home composition, dialog state, visual constraints, and test contract. This plan maps each contract to a file and executable test.

- [x] **Step 2: Review for scope and placeholders**

  Confirm no unfinished markers, speculative Phase 7 content, API additions, schema work, or ambiguous ownership remains in either document.

- [ ] **Step 3: Commit documentation**

  ```bash
  git add docs/superpowers/specs/2026-08-05-mobile-home-shell-design.md docs/superpowers/plans/2026-08-05-mobile-home-shell.md
  git commit -m "docs: define mobile home visual prototype"
  ```

### Task 2: Add typed Home fixture data

**Files:**
- Create: `web/src/pages/home-prototype-data.ts`
- Test: `tests/mobile-home-shell.test.ts`

**Interfaces:**
- `HomeAuthor = "L" | "G"`
- `HomeNoteKind = "pending" | "completed" | "record"`
- `HomeNote = { id: string; author: HomeAuthor; kind: HomeNoteKind; text: string }`
- `HomeSticky = { id: string; text: string; author: HomeAuthor }`
- `HomeCalendarDay = { day: number; hasContent: boolean }`
- Export `L_HOME_NOTES`, `G_HOME_NOTES`, `HOME_STICKIES`, and `HOME_CALENDAR_DAYS`.

- [ ] **Step 1: Write failing fixture contract tests**

  Assert both authors expose the same `HomeNote` shape, fixture text is non-empty, sticky authors are L/G, and the calendar has a seven-column-compatible day collection.

- [ ] **Step 2: Run the focused test and confirm failure**

  Run `node --import tsx --test tests/mobile-home-shell.test.ts`. It must fail because the fixture module does not exist.

- [ ] **Step 3: Implement the fixture module**

  Export the exact types and named arrays with three compact L notes, four G notes, two stickies, and a fixed month-day preview. Keep all content synthetic and outside JSX.

- [ ] **Step 4: Re-run the focused test**

  Run the same command and require all fixture assertions to pass.

### Task 3: Extract grouped navigation and mobile drawer

**Files:**
- Create: `web/src/layout/NavigationGroups.tsx`
- Create: `web/src/layout/MobileTopBar.tsx`
- Create: `web/src/layout/MobileNavigationDrawer.tsx`
- Modify: `web/src/layout/AppShell.tsx`
- Test: `tests/app-shell-mobile.test.ts`

**Interfaces:**
- `NavigationGroups({ onNavigate?: () => void; mobile?: boolean })` renders Core, Utilities, and System group headings and existing route links.
- `MobileTopBar({ onMenuClick, menuOpen })` renders the menu button, Leilei OS label, and `/search` link.
- `MobileNavigationDrawer({ open, onClose })` renders a dialog navigation sheet and owns Escape/backdrop/scroll-lock/focus-return behavior.

- [ ] **Step 1: Write failing source and component tests**

  Assert Home/Memory/Diary/Task/Universe/Chat Archive labels, Global Search, System, disabled Day Space, eight navigable/placeholder entries, `aria-expanded`, `aria-controls`, `aria-modal`, Escape/backdrop close, search link, body overflow lock, and focus return.

- [ ] **Step 2: Run tests to confirm the missing shell behavior**

  Run `node --import tsx --test tests/app-shell-mobile.test.ts`; failures must identify missing grouped labels/drawer behavior rather than environment errors.

- [ ] **Step 3: Implement navigation groups and drawer**

  Move the existing navigation mapping into grouped data. Render Day Space as a disabled button with `aria-disabled="true"`; keep existing placeholder routes. Add a responsive top bar and dialog drawer. Use `useEffect` for Escape and body overflow, and a ref to return focus to the menu trigger on close. Call `onClose` before links navigate.

- [ ] **Step 4: Update AppShell layout**

  Keep `RouteScrollManager`, desktop footer/logout, and `<Outlet />`. Mount `MobileTopBar` and `MobileNavigationDrawer` once, pass the same navigation data, and do not add API calls or route changes.

- [ ] **Step 5: Re-run shell tests and existing sidebar tests**

  Run `node --import tsx --test tests/app-shell-mobile.test.ts tests/sidebar-footer-avatar.test.ts tests/route-scroll.test.ts` and require all to pass.

### Task 4: Replace Dashboard with fixture-only Home components

**Files:**
- Create: `web/src/pages/TodayPanel.tsx`
- Create: `web/src/pages/TodayPanelDialog.tsx`
- Create: `web/src/pages/StickyPreview.tsx`
- Create: `web/src/pages/CalendarPreview.tsx`
- Modify: `web/src/pages/DashboardPage.tsx`
- Test: `tests/mobile-home-shell.test.ts`

**Interfaces:**
- `TodayPanel({ author, notes, onOpen })` renders a compact clickable L/G panel.
- `TodayPanelDialog({ author, notes, open, onClose, triggerRef })` renders a scrollable dialog and closes through backdrop/X/Escape.
- `StickyPreview({ stickies })` renders two small columns/cards.
- `CalendarPreview({ days, date })` renders a seven-column month preview.
- `DashboardPageContent({ settings })` remains export-compatible but no longer consumes `api` or requests module APIs; `DashboardPageContainer` can continue passing the existing client without using it.

- [ ] **Step 1: Add failing Home component tests**

  Render Home in JSDOM and assert Today/date/+ affordance, L/G panels, one shared panel structure, Sticky, Calendar, no hero/orbit/PageHeader/space-card/quick-create text, no `/memory`/`/diary`/`/task` requests, and no duplicate module shortcuts.

- [ ] **Step 2: Confirm failures**

  Run `node --import tsx --test tests/mobile-home-shell.test.ts`; the current Dashboard must fail the Home-only assertions.

- [ ] **Step 3: Implement TodayPanel and dialog**

  Use buttons with `aria-haspopup="dialog"`; dialog gets a stable id, `role="dialog"`, `aria-modal="true"`, an accessible title, internal overflow, Escape/backdrop/X close, body-scroll lock, and focus return to the trigger.

- [ ] **Step 4: Implement StickyPreview and CalendarPreview**

  Render two restrained sticky cards with author marks and a seven-column calendar with subtle content dots. No click handlers or API clients.

- [ ] **Step 5: Replace Dashboard JSX**

  Remove PageHeader, Hero/orbit, module cards, task fetch state, quick-create buttons, and bottom shortcut structures. Keep a compatibility function signature only if TypeScript callers require it, but do not call `api`.

- [ ] **Step 6: Re-run Home component tests**

  Require rendering, click-to-dialog, close behavior, focus restoration, and zero API calls to pass.

### Task 5: Add constrained responsive App Shell/Home styling

**Files:**
- Modify: `web/src/styles.css`
- Test: `tests/mobile-home-shell.test.ts`

- [ ] **Step 1: Write failing CSS contract tests**

  Assert mobile top bar, drawer width `min(82vw, 320px)`, safe-area variables, no Home hero/orbit/glow/large gradient selectors, 320px minimum width, 44px controls, dialog height in `dvh`, seven-column calendar, dark-mode rules, and `:focus-visible` styles.

- [ ] **Step 2: Confirm the CSS tests fail**

  Run `node --import tsx --test tests/mobile-home-shell.test.ts` before adding the new rules.

- [ ] **Step 3: Add grouped App Shell and Home CSS**

  Keep existing theme variables and unrelated module styles intact. Add clearly labeled `.mobile-top-bar`, `.mobile-drawer`, `.home-prototype`, `.today-panel`, `.today-panel-dialog`, `.sticky-preview`, and `.calendar-preview` rules. Use `env(safe-area-inset-*)`, `min-width: 0`, `overflow-x: clip` only on the component that needs it (not body), restrained colors, and an explicit dark `@media (prefers-color-scheme: dark)` fallback that does not create glow or gradients.

- [ ] **Step 4: Re-run CSS and layout tests**

  Run the focused Home/App Shell tests and `tests/native-date-layout.test.ts` to prove existing safe-area/date layout behavior remains intact.

### Task 6: Full validation and visual preview

**Files:**
- No additional production files; inspect all changed files.

- [ ] **Step 1: Run focused tests**

  ```bash
  node --import tsx --test tests/mobile-home-shell.test.ts tests/app-shell-mobile.test.ts tests/dashboard-page.test.ts tests/sidebar-footer-avatar.test.ts tests/native-date-layout.test.ts
  ```

- [ ] **Step 2: Run complete validation**

  ```bash
  pnpm test
  pnpm typecheck
  pnpm build
  npm --prefix web run typecheck
  npm --prefix web run build
  pnpm db:check
  git diff --check
  ```

  Record gated integration skips and stop on any unexpected failure. If `db:check` still needs an environment variable, report that exact environmental blocker without changing production configuration.

- [ ] **Step 3: Inspect scope**

  Confirm `git diff --name-only origin/codex/phase-6-web-ui-foundation...HEAD` contains only docs, Web files, and tests; no `src/`, `drizzle/`, API, MCP, or migration files.

- [ ] **Step 4: Run the Web preview and capture screenshots**

  Start the existing Web preview command in the worktree, inspect 390×844 light/dark, 320×568, open drawer, open L/G dialogs, and 1440px desktop. Save screenshots outside the repository under `/tmp/leilei-mobile-home-screens/`; verify no horizontal overflow, safe-area clipping, or low-contrast dark text.

- [ ] **Step 5: Commit implementation and push**

  Use the requested logical commits, with the final implementation commit messages:

  ```bash
  git commit -m "test: specify mobile home and shell behavior"
  git commit -m "feat: build mobile app shell and navigation drawer"
  git commit -m "feat: build static L and G home prototype"
  git commit -m "style: add restrained light and dark visual system"
  git commit -m "test: verify mobile layout and accessibility contracts"
  git push -u origin codex/mobile-home-shell-prototype
  ```

- [ ] **Step 6: Create Draft PR**

  Create a Draft PR targeting `codex/phase-6-web-ui-foundation`, then wait for Vercel Preview. Report worktree path, base SHA, all commit SHAs, changed files, actual validation counts, screenshot paths, preview URL, and explicit confirmation that backend/database/migration/MCP remained untouched.
