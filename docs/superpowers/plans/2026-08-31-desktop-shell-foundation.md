# Desktop Shell Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy green-heavy desktop shell with the neutral Leilei OS desktop foundation that later Memory, Diary, Task, Global Search, and Universe alignment work can inherit.

**Architecture:** Keep the existing `AppShell` / router structure and mobile navigation behavior. Add one desktop-only stylesheet imported immediately after `styles.css`, use it as the single desktop shell/foundation override layer, and make only the minimum `AppShell` markup cleanup needed for the brand area. Keep the global text-selection change in `styles.css` because that requirement is intentionally site-wide; all other new visual rules stay inside the desktop breakpoint.

**Tech Stack:** React 19, React Router 7, TypeScript 5.8, Vite 7, plain CSS, Node test runner + JSDOM.

**Spec:** `docs/superpowers/specs/2026-08-31-desktop-ui-unification-design.md`

## Global Constraints

- Home, Sentinel, and System are the primary visual references; do not redesign them from scratch.
- Universe keeps its intentional dark page identity; known internal Universe visual defects are deferred unless this shell work directly causes a regression.
- Mobile is protected behavior. Desktop styling must be scoped above the existing 760px mobile breakpoint wherever possible.
- No new UI framework, runtime dependency, font dependency, database change, migration, API contract change, Auth0 change, MCP change, route change, ownership/visibility change, or durable mutation semantic change.
- Do not continue the desktop cleanup by appending another mixed-purpose block to `web/src/styles.css`; create a dedicated desktop foundation/shell stylesheet.
- Shared shell and controls use neutral black / white / gray language rather than the old global green theme.
- `::selection` changes from the existing green treatment to neutral gray as an intentional site-wide exception to the desktop-only rule.
- Shadows are reserved for floating layers; normal shell/application surfaces use flat or fine-border separation.
- Desktop interaction states do not use playful horizontal translation.
- First visual gate must be accepted before writing or executing the Memory redesign plan.

## File Structure

- Create `web/src/desktop-foundation.css` — desktop-only semantic tokens, app shell, sidebar, desktop content frame, and shared desktop control overrides.
- Modify `web/src/main.tsx` — import `desktop-foundation.css` directly after `styles.css`, before feature/page correction layers.
- Modify `web/src/layout/AppShell.tsx` — simplify desktop brand markup only; routing, mobile drawer/top-bar/search state, account identity, and logout behavior stay unchanged.
- Modify `web/src/styles.css` — change only the existing global `::selection` colors during this phase; legacy desktop declarations remain in place underneath the new override layer.
- Create `tests/desktop-shell-foundation.test.ts` — source-level regression contract for import order, breakpoint isolation, neutral tokens, sidebar behavior, selection, and mobile/Universe non-interference.
- Reuse `tests/app-shell-mobile.test.ts` — behavioral regression for grouped navigation, mobile drawer, focus return, body scroll lock, and mobile top bar.
- Reuse `tests/universe-home-dark-surface.test.ts` — regression that Universe correction layers keep their dark behavior and do not target desktop sidebar.

---

### Task 1: Establish the desktop-only foundation layer

**Files:**
- Create: `tests/desktop-shell-foundation.test.ts`
- Create: `web/src/desktop-foundation.css`
- Modify: `web/src/main.tsx:7-18`

**Interfaces:**
- Consumes: existing `.app-shell`, `.sidebar`, `.main-content`, and `.page` classes from `AppShell` / pages.
- Produces: desktop semantic custom properties `--desktop-bg`, `--desktop-sidebar`, `--desktop-surface`, `--desktop-ink`, `--desktop-muted`, `--desktop-line`, `--desktop-line-strong`, `--desktop-hover`, `--desktop-active`, `--desktop-focus-ring`, `--desktop-content-max`, and a desktop-only shell override layer loaded after `styles.css`.

- [ ] **Step 1: Write the failing foundation contract**

Create `tests/desktop-shell-foundation.test.ts` with this initial content:

```ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const desktopCssUrl = new URL(
  "../web/src/desktop-foundation.css",
  import.meta.url,
);
const mainTsx = readFileSync(
  new URL("../web/src/main.tsx", import.meta.url),
  "utf8",
);

function readDesktopCss() {
  assert.equal(
    existsSync(desktopCssUrl),
    true,
    "desktop-foundation.css must exist",
  );
  return readFileSync(desktopCssUrl, "utf8");
}

test("desktop foundation is imported directly after legacy global styles", () => {
  assert.match(
    mainTsx,
    /import "\.\/styles\.css";\s*import "\.\/desktop-foundation\.css";/s,
  );
});

test("desktop foundation defines neutral semantic tokens inside the desktop breakpoint", () => {
  const css = readDesktopCss();
  assert.match(css, /@media\s*\(min-width:\s*761px\)/);
  for (const token of [
    "--desktop-bg",
    "--desktop-sidebar",
    "--desktop-surface",
    "--desktop-ink",
    "--desktop-muted",
    "--desktop-line",
    "--desktop-line-strong",
    "--desktop-hover",
    "--desktop-active",
    "--desktop-focus-ring",
    "--desktop-content-max",
  ]) {
    assert.match(css, new RegExp(`${token}:`));
  }
  assert.match(css, /\.app-shell\s*\{[^}]*grid-template-columns:\s*232px minmax\(0, 1fr\)/s);
  assert.match(css, /\.main-content\s*\{[^}]*background:\s*var\(--desktop-bg\)/s);
});
```

- [ ] **Step 2: Run the new contract and verify RED**

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test tests/desktop-shell-foundation.test.ts
```

Expected: FAIL because `desktop-foundation.css` does not exist and `main.tsx` does not import it.

- [ ] **Step 3: Import the new foundation layer**

In `web/src/main.tsx`, keep the existing order and insert exactly one import after the global stylesheet:

```ts
import "./styles.css";
import "./desktop-foundation.css";
import "./pwa/pwa-status.css";
```

Do not move the existing feature/page CSS imports. Their current later position is intentional so accepted page-specific fixes can still win over generic foundation rules.

- [ ] **Step 4: Create the minimal desktop foundation CSS**

Create `web/src/desktop-foundation.css` with this starting structure:

```css
@media (min-width: 761px) {
  :root {
    --desktop-bg: #f7f7f5;
    --desktop-sidebar: #f4f4f1;
    --desktop-surface: #ffffff;
    --desktop-ink: #191919;
    --desktop-muted: #747474;
    --desktop-line: #e6e6e2;
    --desktop-line-strong: #d8d8d3;
    --desktop-hover: #efefec;
    --desktop-active: #e8e8e5;
    --desktop-focus-ring: 0 0 0 3px rgba(25, 25, 25, 0.08);
    --desktop-content-max: 1240px;
  }

  html,
  body,
  #root,
  .app-shell {
    background: var(--desktop-bg);
  }

  .app-shell {
    grid-template-columns: 232px minmax(0, 1fr);
  }

  .main-content {
    min-width: 0;
    background: var(--desktop-bg);
  }

  .main-content > .page {
    width: min(var(--desktop-content-max), calc(100% - 64px));
    margin-inline: auto;
    padding-top: 40px;
    padding-bottom: 72px;
  }
}
```

Do not add sidebar cosmetics or shared control overrides yet; this task only establishes the layer, tokens, desktop grid, and overall desktop frame.

- [ ] **Step 5: Run the foundation contract and verify GREEN**

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test tests/desktop-shell-foundation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run web typecheck/build before committing**

Run:

```bash
pnpm --dir web typecheck
pnpm --dir web build
```

Expected: both PASS.

- [ ] **Step 7: Commit the foundation layer**

```bash
git add tests/desktop-shell-foundation.test.ts web/src/desktop-foundation.css web/src/main.tsx
git commit -m "style: add desktop foundation layer"
```

---

### Task 2: Replace the legacy desktop sidebar language

**Files:**
- Modify: `tests/desktop-shell-foundation.test.ts`
- Modify: `web/src/layout/AppShell.tsx:76-134`
- Modify: `web/src/desktop-foundation.css`

**Interfaces:**
- Consumes: existing `NavigationGroups`, `NAV_GROUPS`, `.nav-item`, `.navigation-group`, `.sidebar-footer`, `.user-avatar`, `.user-copy`, and `.text-button` behavior.
- Produces: a quiet 232px neutral desktop navigation rail while keeping every route, active-state calculation, user identity value, and logout callback unchanged.

- [ ] **Step 1: Add failing sidebar and brand assertions**

Append these tests to `tests/desktop-shell-foundation.test.ts`:

```ts
const appShellTsx = readFileSync(
  new URL("../web/src/layout/AppShell.tsx", import.meta.url),
  "utf8",
);

test("desktop brand is text-first and drops the obsolete Personal space subtitle", () => {
  assert.match(appShellTsx, /<strong>Leilei OS<\/strong>/);
  assert.doesNotMatch(appShellTsx, />Personal space</);
  assert.match(appShellTsx, /className="brand-mark"\s+aria-hidden="true"/s);
});

test("desktop sidebar uses flat neutral navigation without translation motion", () => {
  const css = readDesktopCss();
  assert.match(css, /\.sidebar\s*\{[^}]*background:\s*var\(--desktop-sidebar\)/s);
  assert.match(css, /\.brand-mark\s*\{[^}]*box-shadow:\s*none/s);
  assert.match(css, /\.nav-item:hover\s*\{[^}]*background:\s*var\(--desktop-hover\)/s);
  assert.match(css, /\.nav-item\.active\s*\{[^}]*background:\s*var\(--desktop-active\)/s);
  assert.doesNotMatch(css, /translateX\(/);
  assert.match(css, /\.sidebar-footer\s*\{[^}]*border-top:\s*1px solid var\(--desktop-line\)/s);
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test tests/desktop-shell-foundation.test.ts
```

Expected: FAIL because the legacy brand still renders `Personal space`, `brand-mark` lacks `aria-hidden`, and the new stylesheet does not yet define sidebar/nav rules.

- [ ] **Step 3: Simplify only the brand markup in AppShell**

Change the desktop brand block in `web/src/layout/AppShell.tsx` to:

```tsx
<div className="sidebar-brand">
  <div className="brand-mark" aria-hidden="true">
    L
  </div>

  <div className="sidebar-brand-copy">
    <strong>Leilei OS</strong>
  </div>
</div>
```

Do not change `NavigationGroups`, mobile top bar/drawer/search state, `displayName`, initials generation, account email, or logout behavior.

- [ ] **Step 4: Add the neutral sidebar rules inside the existing desktop media block**

Extend `web/src/desktop-foundation.css` with:

```css
  .sidebar {
    height: calc(100dvh - env(safe-area-inset-top, 0px));
    padding: 24px 16px 18px;
    border-right: 1px solid var(--desktop-line);
    background: var(--desktop-sidebar);
    backdrop-filter: none;
  }

  .sidebar-brand {
    gap: 10px;
    padding: 0 8px 22px;
  }

  .brand-mark {
    width: 30px;
    height: 30px;
    border: 1px solid var(--desktop-line-strong);
    border-radius: 9px;
    color: var(--desktop-ink);
    background: var(--desktop-surface);
    box-shadow: none;
    font-family: inherit;
    font-size: 13px;
    font-weight: 700;
  }

  .sidebar-brand strong {
    color: var(--desktop-ink);
    font-family: inherit;
    font-size: 14px;
    font-weight: 650;
    letter-spacing: -0.01em;
  }

  .navigation-groups {
    display: grid;
    gap: 18px;
  }

  .navigation-group {
    display: grid;
    gap: 5px;
  }

  .navigation-group h2 {
    margin: 0;
    padding: 0 10px 4px;
    color: #969696;
    font-size: 10px;
    font-weight: 650;
    letter-spacing: 0.08em;
    line-height: 1;
    text-transform: uppercase;
  }

  .navigation-group-items {
    display: grid;
    gap: 2px;
  }

  .nav-item {
    min-height: 36px;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    gap: 9px;
    padding: 0 10px;
    border-radius: 8px;
    color: #686868;
    transition: color 120ms ease, background 120ms ease;
  }

  .nav-item:hover {
    color: var(--desktop-ink);
    background: var(--desktop-hover);
    transform: none;
  }

  .nav-item.active {
    color: var(--desktop-ink);
    background: var(--desktop-active);
    font-weight: 600;
  }

  .nav-item svg {
    width: 17px;
    height: 17px;
  }

  .nav-item small {
    border-color: var(--desktop-line-strong);
    color: #929292;
    background: transparent;
  }

  .sidebar-footer {
    gap: 9px;
    padding: 14px 6px 0;
    border-top: 1px solid var(--desktop-line);
  }

  .user-avatar {
    width: 30px;
    height: 30px;
    border: 1px solid var(--desktop-line-strong);
    color: #5f5f5f;
    background: #ebebe8;
    font-size: 10px;
  }

  .user-copy strong {
    color: var(--desktop-ink);
    font-size: 11px;
    font-weight: 600;
  }

  .user-copy span {
    color: var(--desktop-muted);
    font-size: 10px;
  }

  .sidebar-footer .text-button {
    color: #8a8a8a;
    font-size: 10px;
  }

  .sidebar-footer .text-button:hover {
    color: var(--desktop-ink);
  }
```

Keep all of these declarations inside `@media (min-width: 761px)`.

- [ ] **Step 5: Run sidebar + mobile regressions**

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test \
  tests/desktop-shell-foundation.test.ts \
  tests/app-shell-mobile.test.ts
```

Expected: both test files PASS. In particular, mobile grouped navigation, drawer close/focus/body-scroll behavior, and mobile search controls must remain unchanged.

- [ ] **Step 6: Commit the sidebar redesign**

```bash
git add tests/desktop-shell-foundation.test.ts web/src/layout/AppShell.tsx web/src/desktop-foundation.css
git commit -m "style: unify desktop sidebar"
```

---

### Task 3: Neutralize the shared desktop page/control vocabulary and global selection

**Files:**
- Modify: `tests/desktop-shell-foundation.test.ts`
- Modify: `web/src/desktop-foundation.css`
- Modify: `web/src/styles.css` at the existing `::selection` rule

**Interfaces:**
- Consumes: existing generic `.page`, `.page-header`, `.eyebrow`, `.primary-button`, `.secondary-button`, `input`, `select`, and `textarea` classes/elements.
- Produces: neutral desktop page rhythm and generic controls that downstream page-specific plans may reuse or override; site-wide neutral text selection.

- [ ] **Step 1: Add failing shared-foundation and isolation assertions**

Append these tests to `tests/desktop-shell-foundation.test.ts`:

```ts
const legacyStyles = readFileSync(
  new URL("../web/src/styles.css", import.meta.url),
  "utf8",
);

test("global text selection is neutral instead of theme green", () => {
  assert.match(
    legacyStyles,
    /::selection\s*\{[^}]*color:\s*#191919;[^}]*background:\s*#d9d9d6;/s,
  );
});

test("desktop page and shared controls use the neutral vocabulary", () => {
  const css = readDesktopCss();
  assert.match(css, /\.main-content > \.page\s*\{[^}]*width:\s*min\(var\(--desktop-content-max\), calc\(100% - 64px\)\)/s);
  assert.match(css, /\.page-header h1\s*\{[^}]*font-family:\s*inherit;[^}]*font-size:\s*32px/s);
  assert.match(css, /\.primary-button\s*\{[^}]*background:\s*var\(--desktop-ink\)/s);
  assert.match(css, /\.secondary-button\s*\{[^}]*border:\s*1px solid var\(--desktop-line-strong\)/s);
  assert.match(css, /input,[\s\S]*?textarea\s*\{[^}]*background:\s*var\(--desktop-surface\)/s);
  assert.match(css, /:focus\s*\{[^}]*box-shadow:\s*var\(--desktop-focus-ring\)/s);
});

test("desktop foundation cannot reach mobile navigation or Universe internals", () => {
  const css = readDesktopCss();
  assert.doesNotMatch(css, /\.mobile-(?:top-bar|drawer|menu|search)/);
  assert.doesNotMatch(css, /\.universe-/);
  assert.doesNotMatch(css, /@media\s*\(max-width/);
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test tests/desktop-shell-foundation.test.ts
```

Expected: FAIL because the legacy selection is still green and shared desktop page/control overrides are not present.

- [ ] **Step 3: Replace only the existing global selection colors**

In `web/src/styles.css`, change the current selection rule from the green theme to:

```css
::selection {
  color: #191919;
  background: #d9d9d6;
}
```

Do not use this task to remove or rewrite other legacy declarations in `styles.css`; the new desktop layer intentionally overrides them without a risky bulk cleanup.

- [ ] **Step 4: Add neutral generic desktop page/header/control rules**

Inside the existing `@media (min-width: 761px)` block in `web/src/desktop-foundation.css`, add:

```css
  .page-header {
    gap: 24px;
    margin-bottom: 30px;
  }

  .page-header h1 {
    color: var(--desktop-ink);
    font-family: inherit;
    font-size: 32px;
    font-weight: 650;
    letter-spacing: -0.025em;
    line-height: 1.08;
  }

  .eyebrow {
    color: var(--desktop-muted);
    font-size: 10px;
    letter-spacing: 0.1em;
  }

  .page-header > div > p:last-child {
    color: var(--desktop-muted);
  }

  .primary-button,
  .secondary-button {
    min-height: 38px;
    border-radius: 9px;
    box-shadow: none;
    font-size: 13px;
    font-weight: 600;
    transition:
      color 120ms ease,
      border-color 120ms ease,
      background 120ms ease,
      box-shadow 120ms ease;
  }

  .primary-button {
    color: #ffffff;
    background: var(--desktop-ink);
  }

  .primary-button:not(:disabled):hover {
    background: #2d2d2d;
    box-shadow: none;
    transform: none;
  }

  .secondary-button {
    border: 1px solid var(--desktop-line-strong);
    color: var(--desktop-ink);
    background: var(--desktop-surface);
  }

  .secondary-button:not(:disabled):hover {
    border-color: #c7c7c2;
    background: var(--desktop-hover);
    box-shadow: none;
    transform: none;
  }

  input,
  select,
  textarea {
    border-color: var(--desktop-line-strong);
    border-radius: 9px;
    color: var(--desktop-ink);
    background: var(--desktop-surface);
  }

  input:focus,
  select:focus,
  textarea:focus {
    border-color: #aaaaa5;
    background: var(--desktop-surface);
    box-shadow: var(--desktop-focus-ring);
  }
```

Do not add `.mobile-*`, `.universe-*`, route-specific `:has(...)`, or page-domain selectors to `desktop-foundation.css`.

- [ ] **Step 5: Run shell, mobile, and Universe focused regressions**

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test \
  tests/desktop-shell-foundation.test.ts \
  tests/app-shell-mobile.test.ts \
  tests/universe-home-dark-surface.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Run web typecheck/build and diff validation**

Run:

```bash
pnpm --dir web typecheck
pnpm --dir web build
git diff --check
```

Expected: all PASS.

- [ ] **Step 7: Commit shared desktop vocabulary**

```bash
git add tests/desktop-shell-foundation.test.ts web/src/desktop-foundation.css web/src/styles.css
git commit -m "style: neutralize desktop shared controls"
```

---

### Task 4: Verify the shell visual gate and prepare the first UI PR

**Files:**
- Verify: `web/src/desktop-foundation.css`
- Verify: `web/src/layout/AppShell.tsx`
- Verify: `web/src/styles.css`
- Verify: `web/src/main.tsx`
- Verify: `tests/desktop-shell-foundation.test.ts`
- No page-specific redesign files should be added in this task.

**Interfaces:**
- Consumes: the complete shell/foundation from Tasks 1–3.
- Produces: a reviewable Vercel Preview that is either accepted as the desktop visual baseline or corrected only within shell/foundation scope before merge.

- [ ] **Step 1: Run the complete repository verification set**

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test \
  tests/desktop-shell-foundation.test.ts \
  tests/app-shell-mobile.test.ts \
  tests/universe-home-dark-surface.test.ts
pnpm test
pnpm typecheck
pnpm build
pnpm --dir web typecheck
pnpm --dir web build
git diff --check
```

Expected: all executable checks PASS. If the known GitHub Actions infrastructure failure occurs before any workflow step starts and again exposes no step/log payload, handle it under the existing project CI rule rather than treating it as code failure.

- [ ] **Step 2: Confirm the change set is presentation-only**

Run:

```bash
git diff --name-only origin/main...HEAD
```

Expected file set for the implementation commits:

```text
tests/desktop-shell-foundation.test.ts
web/src/desktop-foundation.css
web/src/layout/AppShell.tsx
web/src/main.tsx
web/src/styles.css
```

The branch may also contain the approved design/plan docs. No backend, database, migration, API, auth, MCP, PWA runtime, or domain repository file belongs in this PR.

- [ ] **Step 3: Open the shell/foundation PR and wait for Vercel Preview**

PR title:

```text
Unify desktop shell and foundation
```

PR body must state:

```text
- replaces the legacy green-heavy desktop shell with a neutral desktop-only foundation
- simplifies desktop sidebar/brand/account presentation without changing routes or behavior
- neutralizes generic desktop controls and the requested site-wide text selection
- protects mobile navigation and Universe internals with focused regressions
- intentionally does not redesign Memory, Diary, Task, Global Search, Home, Sentinel, System, or Universe internals
```

- [ ] **Step 4: Perform the desktop visual gate on Vercel Preview**

Inspect these routes while authenticated:

```text
/
/sentinel
/system/account
/system/data
/memory
/universe
```

Inspect at approximately these viewport widths:

```text
1024px
1280px
1440px
```

Acceptance checks:

```text
- sidebar remains fixed/stable while navigating and no longer reads as a green legacy panel
- brand is quiet and text-first; the L mark does not dominate
- Core / Utilities / System grouping remains readable but subordinate
- active item is neutral gray, hover does not translate horizontally, and account footer is low-emphasis
- main background / page gutter / top rhythm look compatible with Home, Sentinel, and System
- Memory may still look legacy inside the new frame; that is expected and is the next project phase
- Universe remains intentionally dark in its own page surface and the shell does not rewrite its internal dark rules
- no route gains horizontal overflow at the checked desktop widths
```

- [ ] **Step 5: Perform protected mobile regression checks**

Inspect at:

```text
320px
390px
```

Check `/`, `/memory`, `/system/data`, and `/universe`.

Expected:

```text
- mobile top bar, drawer, search trigger, safe-area behavior, touch geometry, and page-specific mobile layouts are unchanged
- the only intentional cross-device visual change is neutral gray text selection
```

- [ ] **Step 6: Apply only shell-scope visual corrections if preview is rejected**

Any correction before acceptance must stay within these files:

```text
web/src/desktop-foundation.css
web/src/layout/AppShell.tsx
web/src/styles.css (selection rule only)
tests/desktop-shell-foundation.test.ts
```

For each correction: add or tighten a failing regression assertion when the issue can be represented as a durable source/layout contract, run the focused test set, then commit with a narrow `style:` or `test:` message. Do not start Memory page redesign inside this PR.

- [ ] **Step 7: Merge only after explicit visual acceptance**

After acceptance, merge the shell/foundation PR, verify the active Vercel production deployment corresponds to the exact merge SHA, and smoke `/`, `/system/data`, `/memory`, and `/universe` in production.

Only then write `docs/superpowers/plans/YYYY-MM-DD-desktop-memory-alignment.md` from the approved shell baseline. Diary, Task, Global Search, Universe alignment, and final cross-page detail pass each receive their own later implementation plan after the prior visual gate is accepted.
