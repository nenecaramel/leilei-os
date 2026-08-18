# Leilei OS System Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Every production change follows RED → GREEN → focused regression verification. Because this is a visual product change, implementation commits are withheld until the user visually accepts the preview.

**Goal:** Replace the retired Settings product with a five-module System area — Account, Connections, Data, Activity, and About — backed by truthful authenticated system data, a real user-scoped JSON export, meaningful persisted activity, and build metadata.

**Architecture:** Remove the runtime Settings personalization layer while preserving the accepted Auth Safari white-surface fix. Add one bounded backend System domain (`SystemRepository` → `SystemService` → authenticated `/api/v1/system/*` router) for connection status, data summary/export, and activity. Add five focused React pages using the existing Web API client and Auth0 identity. Keep the historical `user_settings` database table dormant; do not create a migration.

**Tech Stack:** TypeScript, Node.js, Express, Drizzle ORM/PostgreSQL, React 19, React Router, Auth0 React SDK, Vite, JSDOM, Node test runner with `tsx`.

## Global Constraints

- Start from feature branch `leilei/system-redesign-2026-08-09`, whose design-spec parent is base commit `1cd4e6fe5d5a8b17c2315b8ad6c660e60c417d92`.
- System contains exactly `Account`, `Connections`, `Data`, `Activity`, and `About`.
- Routes are exactly `/system/account`, `/system/connections`, `/system/data`, `/system/activity`, `/system/about`.
- `/system` and legacy `/settings` redirect with replace semantics to `/system/account`.
- Desktop and mobile navigation render the same five System entries. Remove the mobile-only secondary-System expansion.
- Do not migrate any old Settings UI or personalization field into System.
- Do not add Restore, profile editing, connect/disconnect controls, Security, Developer, Activity filters, or destructive data actions.
- Do not create a database migration. The historical `user_settings` table remains physically present but unused.
- System backend routes remain behind the existing Web Auth0 middleware. Client input never supplies a user ID.
- Export and counts are scoped to the authenticated server-owned user ID.
- Never expose secrets, tokens, OAuth scopes, database credentials, raw private endpoints, or deployment configuration.
- Do not fabricate status, counts, events, version data, or historical create/edit activity.
- Preserve the accepted Auth Safari white viewport/browser-chrome behavior.
- `web/preview.html` and `web/src/preview-main.tsx` are temporary preview helpers only; never stage, commit, push, or merge them.
- During implementation and visual acceptance, do not commit or push production changes. After visual approval, perform one durable implementation commit, merge locally to the base branch, re-run verification, push non-force, verify the remote ref, and clean the feature branch.
- Use deterministic serial full-suite verification:
  ```bash
  mapfile -t TESTS < <(find tests -type f -name '*.test.ts' | sort)
  pnpm exec tsx --test --test-concurrency=1 "${TESTS[@]}"
  ```
  On macOS Bash 3, use a newline-safe loop/array construction instead of relying on `mapfile`.

---

## File Structure

### New backend files

- `src/domains/system/system-repository.ts` — user-scoped PostgreSQL counts, export rows, lifecycle events, tool-call events.
- `src/domains/system/system-service.ts` — safe connection semantics, backup v1 shape, Activity normalization/merge.
- `src/web-api/system-router.ts` — authenticated HTTP endpoints and export download headers.

### New frontend files

- `web/src/auth/theme-color.ts` — neutral `syncThemeColorMeta` helper moved out of retired theme personalization.
- `web/src/system/types.ts` — exact client contracts for connections, data summary, backup, activity.
- `web/src/system/build-info.ts` — version, short commit, environment normalization.
- `web/src/pages/SystemAccountPage.tsx`
- `web/src/pages/SystemConnectionsPage.tsx`
- `web/src/pages/SystemDataPage.tsx`
- `web/src/pages/SystemActivityPage.tsx`
- `web/src/pages/SystemAboutPage.tsx`

### Primary modified files

- `src/app/create-app.ts`
- `src/web-api/router.ts`
- `web/src/App.tsx`
- `web/src/auth/ProtectedApp.tsx`
- `web/src/layout/AppShell.tsx`
- `web/src/layout/MobileNavigationDrawer.tsx`
- `web/src/layout/NavigationGroups.tsx`
- `web/src/components/icons.tsx`
- `web/src/pages/DashboardPage.tsx`
- `web/src/pages/DashboardPageContainer.tsx`
- `web/src/styles.css`
- `web/index.html`
- `web/vite.config.ts` if it exists; otherwise create the repository-standard Vite config needed only for build metadata injection.

### Retired live-product files after usage verification

- `web/src/pages/SettingsPage.tsx`
- `web/src/settings/SettingsProvider.tsx`
- `web/src/settings/cache.ts`
- `web/src/settings/theme.ts`
- `web/src/settings/types.ts`
- `src/web-api/settings-router.ts`
- `src/domains/settings/settings-service.ts`
- `src/domains/settings/settings-repository.ts`

Delete only after `rg` proves there is no remaining runtime import. Keep `userSettings` in `src/database/schema.ts` and keep historical migrations unchanged.

### Test files

Create focused System tests rather than converting unrelated suites into System suites:

- `tests/system-navigation.test.ts`
- `tests/system-api.test.ts`
- `tests/system-service.test.ts`
- `tests/system-repository.integration.test.ts`
- `tests/system-pages.test.ts`
- `tests/system-build-info.test.ts`

Modify existing regressions only where the retired Settings contract itself changes:

- `tests/app-shell-mobile.test.ts`
- `tests/dashboard-page.test.ts`
- `tests/dashboard-visual-theme.test.ts`
- `tests/auth-safari-white-hotfix.test.ts`
- `tests/auth-surface-redesign.test.ts`
- Settings/theme/cache tests that are proven obsolete by the runtime removal.

---

### Task 1: Lock the new navigation/routes and retire frontend Settings runtime

**Files:**
- Create: `tests/system-navigation.test.ts`
- Create: `web/src/auth/theme-color.ts`
- Create: the five `web/src/pages/System*Page.tsx` files with minimal truthful page shells
- Modify: `web/src/App.tsx`
- Modify: `web/src/layout/NavigationGroups.tsx`
- Modify: `web/src/layout/MobileNavigationDrawer.tsx`
- Modify: `web/src/layout/AppShell.tsx`
- Modify: `web/src/components/icons.tsx`
- Modify: `web/src/auth/ProtectedApp.tsx`
- Modify: `web/src/pages/DashboardPage.tsx`
- Modify: `web/src/pages/DashboardPageContainer.tsx`
- Modify: `web/index.html`
- Modify/Delete: legacy Web Settings files after usage scan
- Test: `tests/app-shell-mobile.test.ts`
- Test: `tests/dashboard-page.test.ts`
- Test: `tests/auth-safari-white-hotfix.test.ts`
- Test: `tests/auth-surface-redesign.test.ts`

- [ ] **Step 1: Inventory every remaining frontend Settings dependency before deletion**

  Run:

  ```bash
  rg -n 'SettingsPage|SettingsProvider|useSettings|../settings|/settings|preferred_name|accent_color|home_hero|page_copy|leilei-os\.settings|leilei-os\.theme' web tests
  ```

  Classify every hit as one of:
  - runtime dependency to remove;
  - auth theme-color helper to relocate;
  - historical test that must be rewritten/deleted because the product contract is retired;
  - unrelated literal that should remain.

- [ ] **Step 2: Write RED navigation and route tests**

  `tests/system-navigation.test.ts` must assert:
  - System group labels are exactly `Account`, `Connections`, `Data`, `Activity`, `About`;
  - hrefs exactly match the five approved `/system/*` routes;
  - no `General`, `Appearance`, `Data & Backup`, or standalone System link remains;
  - desktop and mobile both consume the same `NAV_GROUPS`;
  - `includeSecondarySystemItems` no longer exists;
  - `/system` and `/settings` render a replace redirect to `/system/account`;
  - all five page routes are registered.

  Run:

  ```bash
  pnpm exec tsx --test tests/system-navigation.test.ts tests/app-shell-mobile.test.ts
  ```

  Confirm failures are caused by the old routing/navigation contract.

- [ ] **Step 3: Move the Safari theme-color helper before deleting legacy theme code**

  Create `web/src/auth/theme-color.ts` containing only the neutral helper:

  ```ts
  export function syncThemeColorMeta(
    documentRef: Pick<Document, "querySelector"> | undefined,
    background: string,
  ): void {
    if (!documentRef || !/^#[0-9A-Fa-f]{6}$/.test(background)) return;
    documentRef
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", background);
  }
  ```

  Update `ProtectedApp.tsx` to import this helper from `./theme-color`.

  Keep the existing authenticated-state effect semantics:
  - add `auth-surface-active` while loading/error/login is visible;
  - set theme-color to `#ffffff`;
  - restore the previous meta content on cleanup.

  Run the two Auth Safari/auth-surface suites and require them to remain GREEN before any larger Settings deletion.

- [ ] **Step 4: Replace the navigation contract and routes**

  In `NavigationGroups.tsx`, define the System entries directly in `NAV_GROUPS`:

  ```ts
  {
    label: "System",
    entries: [
      { label: "Account", to: "/system/account", icon: AccountIcon },
      { label: "Connections", to: "/system/connections", icon: ConnectionsIcon },
      { label: "Data", to: "/system/data", icon: DataIcon },
      { label: "Activity", to: "/system/activity", icon: ActivityIcon },
      { label: "About", to: "/system/about", icon: AboutIcon },
    ],
  }
  ```

  Remove `includeSecondarySystemItems`. `MobileNavigationDrawer` calls `NavigationGroups` exactly like desktop.

  Add simple stroke-based neutral icons in the existing icon module; do not add an icon dependency.

  In `App.tsx`, use React Router `Navigate` with `replace` for `/system` and `/settings`, and register all five page routes.

- [ ] **Step 5: Remove SettingsProvider from the authenticated runtime**

  `ProtectedApp` should return authenticated children directly rather than wrapping them in `SettingsProvider`.

  In `AppShell`:
  - remove `useSettings`;
  - compute display name as `user?.name || user?.email || "Leilei"`;
  - preserve sidebar footer logout behavior;
  - do not remove the sidebar avatar merely because Account has no avatar — the no-avatar requirement is scoped to the Account page.

  In Dashboard:
  - remove the obsolete `SettingsData` prop/type;
  - remove the container's `useSettings` call;
  - keep the accepted Home fixture behavior unchanged.

- [ ] **Step 6: Remove pre-hydration personalization and retire Web Settings files**

  Remove the settings/theme-cache bootstrap script from `web/index.html`. Do not introduce a replacement personalization cache.

  Keep a static valid `theme-color` meta value; Auth still overrides it to white while the auth surface is visible.

  Re-run the inventory command. Once there are no runtime imports, delete:
  - `SettingsPage.tsx`;
  - `SettingsProvider.tsx`;
  - settings cache/theme/types modules.

  Update or remove only tests whose sole purpose was the retired personalization contract. Preserve unrelated CSS/theme regressions that still protect current pages.

- [ ] **Step 7: Make the minimal five page shells compile**

  Each System page initially renders only its approved title and a page-specific root class. Do not add fake status/count/build content at this stage. Later tasks fill the real content.

- [ ] **Step 8: Run focused GREEN regression**

  ```bash
  pnpm exec tsx --test \
    tests/system-navigation.test.ts \
    tests/app-shell-mobile.test.ts \
    tests/dashboard-page.test.ts \
    tests/auth-safari-white-hotfix.test.ts \
    tests/auth-surface-redesign.test.ts
  (cd web && pnpm typecheck)
  git diff --check
  ```

  Checkpoint only. Do not commit.

---

### Task 2: Add the bounded System backend and real Connections status

**Files:**
- Create: `src/domains/system/system-repository.ts`
- Create: `src/domains/system/system-service.ts`
- Create: `src/web-api/system-router.ts`
- Create: `tests/system-service.test.ts`
- Create: `tests/system-api.test.ts`
- Modify: `src/app/create-app.ts`
- Modify: `src/web-api/router.ts`

- [ ] **Step 1: Write RED service/API tests for Connections**

  Lock this public response contract:

  ```ts
  type SystemConnections = {
    web_api: "online";
    public_mcp: "available";
    internal_mcp: "available" | "not_enabled";
  };
  ```

  `GET /api/v1/system/connections` returns:

  ```json
  {
    "success": true,
    "data": {
      "web_api": "online",
      "public_mcp": "available",
      "internal_mcp": "available"
    }
  }
  ```

  Tests must prove:
  - missing `request.webUserId` returns 401 without calling the service;
  - authenticated requests call the service;
  - internal MCP maps from a safe boolean only;
  - no response field contains token, scope, secret, endpoint URL, database URL, or raw configuration.

  Run:

  ```bash
  pnpm exec tsx --test tests/system-service.test.ts tests/system-api.test.ts
  ```

  Confirm RED because System domain/router do not exist.

- [ ] **Step 2: Define the System service/repository interfaces**

  `system-repository.ts` starts with the complete interface needed by later tasks so ownership is clear:

  ```ts
  export interface SystemRepository {
    readDataSummary(userId: string): Promise<SystemDataSummary>;
    readBackupData(userId: string): Promise<SystemBackupData>;
    listLifecycleActivity(
      userId: string,
      limit: number,
    ): Promise<SystemLifecycleActivityRecord[]>;
    listToolActivity(
      userId: string,
      limit: number,
    ): Promise<SystemToolActivityRecord[]>;
  }
  ```

  `SystemService` constructor accepts:
  - `repository`;
  - safe runtime flags `{ publicMcpEnabled: true; internalMcpEnabled: boolean }`;
  - injectable `now` for deterministic export tests.

  `getConnections()` does not query PostgreSQL.

- [ ] **Step 3: Implement the authenticated System router**

  Mount `createSystemApiRouter` at `/system` inside the existing authenticated `/api/v1` router.

  The router gets identity only from `request.webUserId`.

  Add only `/connections` in this step; later steps add `/data`, `/export`, `/activity`.

- [ ] **Step 4: Wire safe runtime configuration**

  In `create-app.ts`, construct `SystemService` when Web API is enabled.

  Connection semantics:
  - Web API is `"online"` because the authenticated request reached this handler;
  - public MCP is `"available"` because the app always mounts the OAuth-protected `/mcp` after required OAuth config succeeds;
  - internal MCP is `"available"` only when the existing internal-MCP configuration is enabled, otherwise `"not_enabled"`.

  Pass only booleans into the service; never expose the configuration values themselves.

- [ ] **Step 5: Run GREEN**

  ```bash
  pnpm exec tsx --test tests/system-service.test.ts tests/system-api.test.ts
  pnpm typecheck
  git diff --check
  ```

  Checkpoint only. Do not commit.

---

### Task 3: Implement truthful Data summary and versioned JSON export

**Files:**
- Modify: `src/domains/system/system-repository.ts`
- Modify: `src/domains/system/system-service.ts`
- Modify: `src/web-api/system-router.ts`
- Modify: `tests/system-service.test.ts`
- Modify: `tests/system-api.test.ts`
- Create: `tests/system-repository.integration.test.ts`

- [ ] **Step 1: Write RED data-summary and export contract tests**

  Lock the summary shape:

  ```ts
  type SystemDataSummary = {
    memory: { active: number; archived: number };
    diary: { active: number; archived: number };
    task: { active: number; archived: number };
    health: { total: number };
  };
  ```

  Lock backup v1:

  ```ts
  type SystemBackupV1 = {
    format: "leilei-os-backup";
    version: 1;
    exported_at: string;
    data: {
      memory: SystemMemoryBackupRecord[];
      diary: SystemDiaryBackupRecord[];
      task: SystemTaskBackupRecord[];
      health: SystemHealthBackupRecord[];
    };
  };
  ```

  Service tests use a fake repository and deterministic clock. API tests prove:
  - `/data` uses authenticated identity;
  - `/export` uses authenticated identity;
  - export response content type is JSON;
  - `Content-Disposition` filename is `leilei-os-backup-YYYY-MM-DD.json`;
  - failed service calls do not return a successful/empty backup.

- [ ] **Step 2: Define canonical export fields**

  Do not export `userId` or internal request hashes.

  Memory:
  - `id`, `category`, `key`, `content`, `tags`, `visibility`, `source`, `status`, `sort_order`, `created_at`, `updated_at`.

  Diary:
  - `id`, `title`, `content`, `date`, `tags`, `mood`, `source`, `status`, `created_at`, `updated_at`.
  - exclude `idempotency_key` and `request_hash` from the user backup.

  Task:
  - `id`, `title`, `description`, `status`, `resume_status`, `lifecycle_status`, `priority`, `due_time`, `timezone`, `tags`, `created_at`, `updated_at`, `completed_at`.

  Health:
  - `id`, `date`, `steps`, `period_start_date`, `cycle_day`, `created_at`.

- [ ] **Step 3: Implement user-scoped Drizzle queries**

  `DrizzleSystemRepository.readDataSummary(userId)` performs bounded aggregate counts with `WHERE user_id = ...`.

  Counts:
  - Memory status active/archived across the authenticated user's owned rows;
  - Diary status active/archived;
  - Task lifecycle status active/archived;
  - Health total.

  `readBackupData(userId)` selects only the canonical fields above, always with user ownership predicates, using deterministic ordering (`created_at`, then `id`) so exports are stable.

  No settings, tool calls, idempotency rows, lifecycle audit rows, toy commands, credentials, or configuration are included in backup v1.

- [ ] **Step 4: Add a gated real PostgreSQL ownership test**

  Follow the repository's existing gated integration-test pattern:
  - create owner A and owner B;
  - seed active/archived Memory, Diary, Task and Health for both;
  - verify A's summary counts only A;
  - verify A's backup contains active and archived A records;
  - verify no B identifiers/content appear;
  - rollback the transaction;
  - skip safely unless the explicit test gate and local `DATABASE_URL` are present.

  No production database access.

- [ ] **Step 5: Implement service export and router endpoints**

  `createExport` uses the injected clock:

  ```ts
  return {
    format: "leilei-os-backup",
    version: 1,
    exported_at: this.now().toISOString(),
    data: await this.repository.readBackupData(userId),
  };
  ```

  Add:
  - `GET /system/data`
  - `GET /system/export`

  Export returns the backup object as the JSON body plus attachment headers; no success envelope is required for the attachment endpoint.

- [ ] **Step 6: Run GREEN**

  ```bash
  pnpm exec tsx --test \
    tests/system-service.test.ts \
    tests/system-api.test.ts \
    tests/system-repository.integration.test.ts
  pnpm typecheck
  git diff --check
  ```

  Checkpoint only. Do not commit.

---

### Task 4: Implement meaningful Activity from persisted audit sources

**Files:**
- Modify: `src/domains/system/system-repository.ts`
- Modify: `src/domains/system/system-service.ts`
- Modify: `src/web-api/system-router.ts`
- Modify: `tests/system-service.test.ts`
- Modify: `tests/system-api.test.ts`
- Modify: `tests/system-repository.integration.test.ts`

- [ ] **Step 1: Write RED Activity normalization tests**

  Lock the client-facing event shape:

  ```ts
  type SystemActivityItem = {
    id: string;
    occurred_at: string;
    label: string;
    source: "Web" | "MCP" | "Internal" | "System";
    outcome: "success" | "failed";
  };
  ```

  Required lifecycle mappings:
  - memory/archive → `Memory archived`;
  - diary/restore → `Diary restored`;
  - task/permanent_delete → `Task permanently deleted`.

  Source mappings:
  - lifecycle `channel=web` → `Web`;
  - `channel=mcp` → `MCP`;
  - `channel=internal` → `Internal`;
  - server/system actor may be displayed as `System` where the persisted record truthfully identifies the system actor.

  Meaningful tool-call behavior:
  - normalize only persisted write operations/tool names known to represent writes;
  - include `success`, `rejected`, and `error` outcomes when they represent a meaningful write attempt;
  - `rejected`/`error` become `failed`;
  - do not create an event for reads, auth checks, heartbeats, or generic request errors.

  Use actual known persisted `write_diary`/write-operation conventions in fixtures; do not invent historical Task/Memory tool-call rows if the current system never wrote them.

- [ ] **Step 2: Implement two bounded repository reads**

  Query latest lifecycle events for the user with a fixed service-requested bound.

  Query latest tool-call records for the user with a fixed bound and enough columns to decide whether the event is a meaningful write:
  - `id`;
  - `toolName`;
  - `operation`;
  - `resourceType`;
  - `status`;
  - `errorCode`;
  - `createdAt`.

  Never select request/result summaries for Activity UI.

- [ ] **Step 3: Merge and normalize in the service**

  `listActivity({ userId, limit = 50 })`:
  - cap the requested limit to 50;
  - fetch bounded rows from both sources;
  - map supported records;
  - drop noise;
  - sort by `occurred_at DESC`, with stable ID fallback;
  - slice to the final limit.

  Do not reconstruct unaudited create/edit events.

- [ ] **Step 4: Add `GET /system/activity`**

  Return:

  ```json
  {
    "success": true,
    "data": {
      "events": []
    }
  }
  ```

  Empty is a legitimate state. Retrieval failure is an API failure, not an empty success fabricated by the client.

- [ ] **Step 5: Extend PostgreSQL ownership/noise coverage**

  Seed:
  - one lifecycle event for owner A;
  - one meaningful tool write record for A;
  - one non-write tool/read record for A;
  - one event for owner B.

  Prove only A's meaningful rows are returned to A.

- [ ] **Step 6: Run GREEN**

  ```bash
  pnpm exec tsx --test \
    tests/system-service.test.ts \
    tests/system-api.test.ts \
    tests/system-repository.integration.test.ts
  pnpm typecheck
  git diff --check
  ```

  Checkpoint only. Do not commit.

---

### Task 5: Build Account and Connections pages from real sources

**Files:**
- Create/Modify: `web/src/system/types.ts`
- Modify: `web/src/pages/SystemAccountPage.tsx`
- Modify: `web/src/pages/SystemConnectionsPage.tsx`
- Create: `tests/system-pages.test.ts`

- [ ] **Step 1: Write RED page tests**

  Account must prove:
  - title is `Account`;
  - Auth0 name and email render when provided;
  - `Signed in with Auth0` renders subtly;
  - one `Sign out` button invokes Auth0 logout with return-to current origin;
  - there is no Account-page avatar/image;
  - there are no editable text/email/password inputs.

  Connections must prove:
  - it requests `/system/connections`;
  - loading state contains no false Online/Available claims;
  - ready state renders exactly Web API, ChatGPT / MCP, Internal MCP with server-returned statuses;
  - failure state is explicit and does not fabricate Offline/Online;
  - there are no connect/disconnect buttons, tokens, scopes, or endpoints.

- [ ] **Step 2: Implement exact client types**

  In `web/src/system/types.ts`, mirror backend snake_case contracts exactly. Do not create a second semantic translation layer unless presentation requires a label.

- [ ] **Step 3: Implement Account**

  Read directly from `useAuth0()`.

  Missing name/email shows a neutral em dash or `Unavailable`; do not synthesize profile data.

  No API request.

- [ ] **Step 4: Implement Connections with existing `useWebApiClient`**

  Fetch once on mount with the same active/unmount guard pattern used elsewhere in the Web app.

  Keep state as a discriminated union:
  - loading;
  - ready;
  - error.

  Render small text status rows; styling comes later.

- [ ] **Step 5: Run GREEN**

  ```bash
  pnpm exec tsx --test tests/system-pages.test.ts tests/system-navigation.test.ts
  (cd web && pnpm typecheck)
  git diff --check
  ```

  Checkpoint only. Do not commit.

---

### Task 6: Build Data page and real browser JSON download

**Files:**
- Modify: `web/src/pages/SystemDataPage.tsx`
- Modify: `web/src/system/types.ts`
- Modify: `tests/system-pages.test.ts`
- Inspect: `web/src/api/useWebApiClient.ts` before choosing the smallest compatible download path

- [ ] **Step 1: Inspect the existing API client contract**

  Run:

  ```bash
  sed -n '1,260p' web/src/api/useWebApiClient.ts
  ```

  Preserve its Auth0 token/error behavior. Do not bypass the authenticated client with a raw unauthenticated `fetch`.

- [ ] **Step 2: Write RED Data page tests**

  Prove:
  - `/system/data` is requested;
  - ready state shows truthful Memory/Diary/Task active/archived counts and Health total;
  - loading state does not display zero as if it were real data;
  - error state is explicit;
  - clicking `Export all data` makes exactly one authenticated `/system/export` request;
  - successful export creates a JSON Blob/object URL and clicks a download anchor with `leilei-os-backup-YYYY-MM-DD.json`;
  - object URL is revoked;
  - failed export displays an inline failure and triggers no download;
  - repeated click while export is in flight is gated.

- [ ] **Step 3: Implement export using the existing authenticated request primitive**

  Prefer the smallest solution compatible with the inspected client:
  - request the backup JSON through the existing authenticated request path;
  - `JSON.stringify` the exact server-returned backup;
  - create `Blob([json], { type: "application/json" })`;
  - create/revoke object URL;
  - create and click a temporary `<a download=...>`.

  Only extend `WebApiClient` if its current implementation cannot return this JSON safely. If extension is necessary, add one focused authenticated raw/Blob method and test it separately; do not duplicate token acquisition logic in the page.

- [ ] **Step 4: Run GREEN**

  ```bash
  pnpm exec tsx --test tests/system-pages.test.ts
  (cd web && pnpm typecheck)
  git diff --check
  ```

  Checkpoint only. Do not commit.

---

### Task 7: Build Activity and About, including deterministic build metadata

**Files:**
- Modify: `web/src/pages/SystemActivityPage.tsx`
- Modify: `web/src/pages/SystemAboutPage.tsx`
- Create/Modify: `web/src/system/build-info.ts`
- Modify/Create: `web/vite.config.ts`
- Create: `tests/system-build-info.test.ts`
- Modify: `tests/system-pages.test.ts`
- Test: `web/package.json`

- [ ] **Step 1: Write RED Activity page tests**

  Prove:
  - request path is `/system/activity`;
  - loading state is neutral;
  - ready events are grouped under simple local day headings;
  - each row shows server-provided human label and source;
  - failed outcome is visibly distinguishable by text, not color alone;
  - empty result shows a quiet empty state;
  - request failure shows an error state.

  No filters/search controls.

- [ ] **Step 2: Implement Activity page**

  The client does not reinterpret raw audit data; backend already returns normalized human events.

  Group by local calendar date for display only; preserve server ordering inside each date.

- [ ] **Step 3: Write RED build-info tests**

  Lock:
  - product name `Leilei OS`;
  - version starts from `web/package.json` version (`0.1.0` on the approved base);
  - full commit input becomes 7-character short SHA;
  - missing commit becomes a neutral `Local build`/`Unavailable` value rather than throwing;
  - `import.meta.env.PROD` maps to `Production`, otherwise `Development`.

- [ ] **Step 4: Inject commit metadata at Vite build time**

  Use Vite config to define one client-safe build constant from deployment/build environment:

  ```ts
  const commit =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GIT_COMMIT_SHA ??
    "";
  ```

  Define only the commit string needed by the client. Do not expose `process.env` wholesale.

  Keep the version imported/read from the Web package/build module rather than hardcoding it in JSX.

- [ ] **Step 5: Implement About**

  Render only:
  - `Leilei OS`;
  - Version / Build;
  - short Commit;
  - Environment.

  Do not duplicate connection status.

- [ ] **Step 6: Run GREEN**

  ```bash
  pnpm exec tsx --test tests/system-pages.test.ts tests/system-build-info.test.ts
  (cd web && pnpm typecheck)
  (cd web && pnpm build)
  git diff --check
  ```

  Checkpoint only. Do not commit.

---

### Task 8: Retire backend Settings exposure and prove no live Settings product remains

**Files:**
- Modify: `src/app/create-app.ts`
- Modify: `src/web-api/router.ts`
- Delete after usage proof:
  - `src/web-api/settings-router.ts`
  - `src/domains/settings/settings-service.ts`
  - `src/domains/settings/settings-repository.ts`
- Keep: `src/database/schema.ts` historical `userSettings`
- Modify/Delete: obsolete Settings API/service tests
- Create/Modify: `tests/system-api.test.ts`
- Modify: relevant architecture/source-regression tests

- [ ] **Step 1: Inventory backend Settings references**

  ```bash
  rg -n 'SettingsService|SettingsRepository|settings-router|webSettingsService|/settings|userSettings' src tests
  ```

  Preserve only:
  - `userSettings` schema/migration history;
  - historical database checks that intentionally validate existing schema.

  Remove live service/router/app wiring and tests whose only contract was the retired `/api/v1/settings` product API.

- [ ] **Step 2: Add RED retirement assertions**

  Tests must prove:
  - Web API router mounts `/system`;
  - Web API router no longer mounts `/settings`;
  - `createApp` no longer requires/constructs a settings service;
  - `userSettings` schema still exists;
  - no migration file is added/changed.

- [ ] **Step 3: Remove the dead backend code**

  Delete service/repository/router only after the usage scan proves no remaining caller.

  Do not touch the physical database table or migration chain.

- [ ] **Step 4: Run GREEN**

  ```bash
  pnpm exec tsx --test tests/system-api.test.ts
  pnpm typecheck
  pnpm build
  git diff --check
  ```

  Checkpoint only. Do not commit.

---

### Task 9: Apply the quiet System visual system and perform user preview acceptance

**Files:**
- Modify: `web/src/styles.css`
- Modify: `tests/system-pages.test.ts`
- Modify: `tests/system-navigation.test.ts`
- Temporary untracked only: `web/preview.html`, `web/src/preview-main.tsx` if needed for local visual access

- [ ] **Step 1: Add RED structural CSS assertions only for stable visual contracts**

  Lock:
  - System pages use white/neutral surfaces;
  - Apple/SF-compatible typography consistent with accepted mobile pages;
  - black/gray text;
  - thin neutral separators;
  - no legacy accent-color controls;
  - no colored hero or decorative dashboard cards;
  - mobile content respects top bar and safe areas;
  - rows remain readable at 320px;
  - buttons keep accessible touch areas while visual presentation stays restrained;
  - `:focus-visible` remains present.

  Do not encode every pixel in tests before visual review.

- [ ] **Step 2: Implement one shared System page visual vocabulary**

  Prefer shared classes such as:
  - `.system-page`;
  - `.system-page-header`;
  - `.system-section`;
  - `.system-row`;
  - `.system-row-label`;
  - `.system-row-value`;
  - `.system-status`;
  - `.system-action`;
  - `.system-activity-day`;
  - `.system-activity-row`.

  Avoid five unrelated one-off page designs.

- [ ] **Step 3: Run focused functional regression before preview**

  ```bash
  pnpm exec tsx --test \
    tests/system-navigation.test.ts \
    tests/system-pages.test.ts \
    tests/system-build-info.test.ts \
    tests/system-api.test.ts \
    tests/system-service.test.ts
  (cd web && pnpm typecheck)
  git diff --check
  ```

- [ ] **Step 4: Start one local preview flow**

  If an authenticated production-like preview helper is required, create only the established temporary helper files. Confirm with `git status --short` that they remain untracked.

  Inspect at minimum:
  - 393×852 mobile Account;
  - mobile navigation drawer showing all five System entries;
  - Connections loading/ready/error;
  - Data counts and export button;
  - Activity populated/empty state;
  - About;
  - desktop sidebar + each System page;
  - Auth login/loading/error surfaces after Settings/theme removal.

- [ ] **Step 5: Collect all user visual feedback before patching**

  Do not commit. Accumulate the complete acceptance list and make one visual patch. Repeat focused tests and preview until the user explicitly approves the System UI.

---

### Task 10: Fresh full verification, durable commit, local merge, non-force push, and cleanup

**Files:**
- All durable files accepted in Tasks 1–9
- Exclude all preview helpers

- [ ] **Step 1: Remove temporary preview helpers before staging**

  ```bash
  rm -f web/preview.html web/src/preview-main.tsx
  git status --short
  ```

  Confirm neither helper appears in tracked/staged files.

- [ ] **Step 2: Run the complete deterministic root test suite serially**

  On macOS Bash 3:

  ```bash
  TESTS=()
  while IFS= read -r test_file; do
    TESTS+=("$test_file")
  done < <(find tests -type f -name '*.test.ts' | sort)

  pnpm exec tsx --test --test-concurrency=1 "${TESTS[@]}"
  ```

  Any unexpected failure blocks completion.

- [ ] **Step 3: Run all build/type/diff gates**

  ```bash
  pnpm typecheck
  pnpm build
  (cd web && pnpm typecheck)
  (cd web && pnpm build)
  git diff --check
  ```

  Run `pnpm db:check` when the established local environment supports it; if it is gated solely by missing `DATABASE_URL`, record that exact environmental limitation without touching production configuration.

- [ ] **Step 4: Review scope before staging**

  ```bash
  git status --short
  git diff --name-status HEAD
  git diff --stat HEAD
  ```

  Confirm:
  - no migration added/modified;
  - `user_settings` table remains;
  - no preview helper staged;
  - no unrelated Memory/Diary/Task behavior changed;
  - no secret/config value appears in diff;
  - old live Settings frontend/backend runtime is gone;
  - all five System modules are present.

- [ ] **Step 5: Stage durable files only and create the implementation commit**

  The feature branch already contains:
  - design spec commit;
  - implementation-plan commit.

  After visual approval, stage only durable implementation/test files and commit:

  ```bash
  git commit -m "feat: replace Settings with System"
  ```

  Never amend the accepted spec/plan commits merely to fold implementation into them.

- [ ] **Step 6: Verify the committed feature tree again**

  Re-run:
  - focused System tests;
  - serial complete tests;
  - root typecheck/build;
  - Web typecheck/build;
  - `git diff --check`;
  - clean `git status`.

- [ ] **Step 7: Merge locally into the production/UI base**

  Switch to `codex/phase-6-web-ui-foundation`, verify it still matches `origin/codex/phase-6-web-ui-foundation`, and merge the feature branch without force rewriting history.

  If the base moved, stop and inspect/reconcile before merging.

- [ ] **Step 8: Verify the merged base**

  Repeat the deterministic serial test suite, root/Web typecheck/build, and `git diff --check` on the merged base.

- [ ] **Step 9: Push base non-force and verify remote ref**

  Push only:

  ```bash
  git push origin codex/phase-6-web-ui-foundation
  ```

  Fetch/resolve the remote ref and require exact equality with local base HEAD.

  Independently verify the same remote commit through the GitHub connector.

- [ ] **Step 10: Clean the feature branch safely**

  Delete the local feature branch only after:
  - merged-base tests pass;
  - push succeeds;
  - remote base equals local base;
  - worktree is clean.

  Do not force-push or delete unrelated remote branches.

---

## End-to-End Acceptance Checklist

Before claiming completion, prove all of the following:

1. Navigation has exactly five System entries: Account, Connections, Data, Activity, About.
2. Desktop and mobile navigation share those same entries and routes.
3. `/system` and `/settings` both replace-redirect to `/system/account`.
4. Account shows Auth0 identity and Sign out, with no Account-page avatar or edit controls.
5. Connections reports safe real channel availability and has no management controls/secrets.
6. Data displays real authenticated-user counts.
7. `Export all data` downloads a valid `leilei-os-backup` version-1 JSON containing the authenticated user's Memory, Diary, Task, and Health data, including archived records where applicable.
8. Export contains no other user's data, secrets, tokens, settings personalization, or infrastructure configuration.
9. Activity displays only meaningful persisted lifecycle/tool-write events and real write failures, with source labels.
10. Activity does not fabricate unaudited create/edit history or show read/auth/heartbeat noise.
11. About shows Leilei OS, Web version/build, short commit SHA, and Production/Development.
12. Old Settings UI, runtime provider/cache/theme personalization, and `/api/v1/settings` exposure are gone.
13. Historical `user_settings` schema remains; there is no destructive migration.
14. Auth Safari white viewport/browser-chrome regression remains GREEN.
15. System UI is visually approved on mobile before any implementation commit/push.
16. Preview helpers are absent from the committed tree.
17. Complete deterministic tests, typechecks, builds, and diff checks pass on both feature tree and merged base.
18. Base is pushed non-force and the remote ref is independently verified.
