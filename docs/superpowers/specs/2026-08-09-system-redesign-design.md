# Leilei OS System Redesign — Design

Date: 2026-08-09  
Base branch: `codex/phase-6-web-ui-foundation`  
Approved base commit: `1cd4e6fe5d5a8b17c2315b8ad6c660e60c417d92`

## 1. Purpose

Replace the old Settings product with a new System area that represents Leilei OS itself: identity, connection availability, owned data, meaningful system activity, and build information.

The old Settings UI and its personalization model are retired. The new System area must expose only capabilities that are real, observable, and useful.

## 2. Information architecture

System contains exactly five first-level modules:

1. `Account`
2. `Connections`
3. `Data`
4. `Activity`
5. `About`

Routes:

- `/system/account`
- `/system/connections`
- `/system/data`
- `/system/activity`
- `/system/about`

Compatibility behavior:

- `/system` redirects with replace semantics to `/system/account`.
- legacy `/settings` redirects with replace semantics to `/system/account`.
- there is no standalone page named `System`.

Desktop sidebar and mobile navigation drawer use the same five System entries. The current mobile-only `General / Appearance / Data & Backup / About` expansion and `includeSecondarySystemItems` behavior are removed.

Each entry receives a distinct neutral icon:
- Account: person
- Connections: link/nodes
- Data: database
- Activity: pulse/history
- About: information

## 3. Visual direction

System follows the accepted Leilei OS mobile language already used by the redesigned product pages:

- white/neutral surfaces;
- black and gray typography;
- restrained borders and separators;
- no decorative dashboard cards merely to fill space;
- no large colored hero;
- no legacy personalization theme controls;
- compact mobile-first spacing;
- desktop remains aligned with the shared AppShell.

Pages should feel like quiet system readouts rather than an admin dashboard.

Exact spacing and visual polish remain subject to the normal local preview acceptance pass before implementation is committed or pushed.

## 4. Account

### Purpose

Show the authenticated identity currently using Leilei OS.

### Content

- page title: `Account`
- Auth0 name when present
- email when present
- subtle identity-source text: `Signed in with Auth0`
- `Sign out`

### Explicit exclusions

- no avatar on the Account page;
- no editable nickname;
- no editable email;
- no password controls;
- no timezone;
- no theme or appearance controls;
- no account deletion or other invented account management.

Account reads directly from Auth0's authenticated user object and uses the existing Auth0 logout capability. It does not need a new backend endpoint.

Missing optional profile fields render as a neutral unavailable value rather than inventing data.

## 5. Connections

### Purpose

Show whether Leilei OS communication channels are available. This is a read-only status page, not an integrations manager.

### Initial rows

- `Web API` — `Online`
- `ChatGPT / MCP` — `Available`
- `Internal MCP` — `Available` or `Not enabled`

### Semantics

`ChatGPT / MCP — Available` means the public OAuth-protected MCP channel is configured and exposed by Leilei OS. It does **not** claim that a ChatGPT client is actively connected at that moment.

`Internal MCP` reflects whether the optional internal MCP channel is enabled by server configuration.

The page never exposes:
- tokens;
- secrets;
- OAuth scopes;
- database credentials;
- raw endpoint URLs.

### Data flow

Add an authenticated read-only Web API endpoint under the System namespace, e.g. `GET /api/v1/system/connections`.

A successful request itself proves the Web API is online. The server returns only safe availability booleans/status values for the MCP channels based on runtime configuration. No client-side probing of protected MCP endpoints is required.

If the status endpoint itself fails, the UI shows a connection-status error state rather than fabricated offline/online values.

Database health is intentionally excluded from Connections and belongs conceptually to Data/internal infrastructure.

## 6. Data

### Purpose

Show the user's persistent Leilei OS records and provide one real export capability.

### Overview

Initial data categories:

- Memory
- Diary
- Task
- Health

Memory, Diary, and Task display active/archived counts where applicable. Health displays a total count.

The page must never use fake counts. A failed summary request renders an error state rather than zeroes.

### Export all data

`Export all data` is a real action in the first release.

Add an authenticated endpoint such as `GET /api/v1/system/export`.

The export:
- is scoped exclusively to the authenticated server-owned user ID;
- contains canonical personal records from Memory, Diary, Task, and Health;
- includes archived Memory/Diary/Task records;
- preserves the fields needed to understand and later migrate/restore those records;
- excludes credentials, Auth0 tokens, database configuration, secrets, transient server state, and internal infrastructure configuration;
- does not treat retired Settings personalization as backup content.

The response is a downloadable JSON attachment, for example:

```json
{
  "format": "leilei-os-backup",
  "version": 1,
  "exported_at": "2026-08-09T00:00:00.000Z",
  "data": {
    "memory": [],
    "diary": [],
    "task": [],
    "health": []
  }
}
```

Suggested filename:

`leilei-os-backup-YYYY-MM-DD.json`

The browser starts a download only after a successful authenticated response. Export failures are shown inline and do not create an empty/corrupt file.

### Restore

Restore is explicitly out of scope for this System release.

A later Restore project must perform whole-file schema validation, conflict handling, ID strategy, and transactional writes. The v1 export format is intentionally versioned so it can serve as a future restore/migration source without promising restore now.

## 7. Activity

### Purpose

Provide a human-readable timeline of meaningful system actions.

Activity is not a request log, observability console, or developer trace.

### First-release sources

Normalize events already persisted today from:

- resource lifecycle events for Memory / Diary / Task;
- meaningful MCP/tool-call write results, including real write failures.

Existing lifecycle data can represent actions such as:
- archive;
- restore;
- permanent delete;

and includes actor/channel information such as:
- Web;
- MCP;
- Internal;
- System where applicable.

Tool-call data can represent meaningful successful, rejected, or errored writes that are already persisted.

### Presentation

Example rows:

- `Task archived` · `Web`
- `Diary restored` · `MCP`
- `Task creation failed` · `MCP`

Events are grouped chronologically with simple day headings. First release shows the latest meaningful events with a conservative fixed limit; no search/filter controls are required.

### Noise exclusions

Do not show:
- ordinary GET requests;
- authentication checks;
- token verification;
- heartbeats;
- generic API request failures unrelated to a meaningful write;
- invented historical create/edit events that were never persisted.

Create/edit coverage that is not currently audited is a later instrumentation task. The first release only shows events the database can truthfully support.

If there are no events, show a quiet empty state. If retrieval fails, show an error state rather than pretending there is no activity.

## 8. About

### Purpose

Answer only: what build of Leilei OS is this?

### Content

- `Leilei OS`
- Version / Build
- short Git commit SHA
- Environment: `Production` or `Development`

The Web package version is the initial product version source. The Git commit is injected/read at build time and displayed as a short SHA. Production should use deployment/git metadata when available, with a deterministic build-time fallback; development may identify itself as a local/development build.

About intentionally does not duplicate Web API / MCP status from Connections.

It also does not contain:
- technology-stack lists;
- long product copy;
- GitHub promotional links;
- license boilerplate;
- decorative marketing content.

## 9. Retirement of old Settings

The old Settings product is not migrated into System.

Remove from the live Web product:
- old Settings page and form;
- accent-color editing and preview;
- Home title/subtitle personalization;
- Home hero copy modes/content;
- preferred-name setting;
- page-subtitle personalization;
- Settings cache and pre-hydration personalization behavior;
- runtime dependency on `SettingsProvider`;
- `/api/v1/settings` Web API exposure and its app wiring when no remaining runtime consumer exists.

The AppShell display name falls back to authenticated Auth0 name/email rather than `preferred_name`.

The current Dashboard already does not consume Settings values; its obsolete Settings prop/container dependency should be removed.

The auth Safari white-surface behavior must be preserved. The tiny theme-color meta helper currently located inside the legacy settings theme module should be moved to a neutral/auth utility before the obsolete personalization theme module is removed.

No destructive database migration is part of this release. The historical `user_settings` table/schema may remain dormant so retiring the UI/API does not delete persisted data during a UI/System redesign. Physical table removal can be a separately reviewed migration later.

## 10. Backend architecture

Add one bounded System backend unit rather than placing System-specific queries inside unrelated module routers.

Suggested boundary:

```text
Web System pages
    ↓
/api/v1/system/*
    ↓
System service
    ↓
System repository / runtime config
    ↓
PostgreSQL + safe server configuration
```

Responsibilities:

- router: authentication boundary, HTTP parsing/serialization, download headers;
- service: safe status semantics, export shape/versioning, activity normalization;
- repository: user-scoped counts/records/activity queries;
- frontend: display, loading/error/empty states, download initiation.

The System service must not return secrets or accept user IDs from the client.

## 11. Error and security behavior

- Every System backend endpoint remains behind existing Web Auth0 middleware.
- User identity comes only from the authenticated server request context.
- Data summary/export/activity queries are always user-scoped.
- Connections returns only safe status labels/booleans.
- Export never contains secrets or deployment configuration.
- Failed status/data/activity requests render explicit error states.
- Failed export does not create a file.
- Missing build metadata produces a neutral unavailable/local value; it must not crash About.
- No System page fabricates successful status from stale cached data.

## 12. Testing strategy

Implementation follows TDD: regression/contract tests are written to fail before production changes, then made green.

Backend coverage:
- authenticated System route access;
- unauthenticated rejection;
- Connections safe status mapping;
- Data counts scoped to the authenticated user;
- export schema name/version;
- export includes active and archived canonical records;
- export excludes another user's records and secrets;
- Activity normalizes lifecycle events and meaningful tool-call failures;
- Activity excludes noise.

Frontend coverage:
- five System routes;
- `/system` and legacy `/settings` redirect to Account;
- desktop and mobile navigation expose the same five System entries;
- Account has no avatar/edit controls and uses Auth0 identity/logout;
- Connections loading/error/status states;
- Data truthful counts and successful JSON download behavior;
- export failure behavior;
- Activity populated/empty/error states;
- About version/short SHA/environment behavior;
- old Settings controls are absent.

Regression gates:
- existing auth Safari white-surface behavior remains intact;
- preview helpers remain untracked and are never committed;
- deterministic serial root test suite;
- root typecheck/build;
- Web typecheck/build;
- `git diff --check`.

## 13. Explicit non-goals

This release does not include:

- Restore from backup;
- editable account profile;
- connection/disconnection management;
- database administration;
- Security or Developer subpages;
- Activity search/filtering;
- retroactive reconstruction of unaudited events;
- appearance/theme personalization;
- migration of old Settings content into the new System IA;
- destructive removal of the historical settings database table.

## 14. Acceptance criteria

The design is complete when:

1. System has exactly Account, Connections, Data, Activity, and About.
2. desktop and mobile navigation share the same five real routes.
3. legacy Settings content is absent and `/settings` redirects to Account.
4. Account is read-only identity plus Sign out, with no Account-page avatar.
5. Connections truthfully reports safe channel availability without controls or secrets.
6. Data shows real user-scoped counts and downloads a valid versioned JSON backup.
7. Activity shows only meaningful persisted actions/failures and identifies their source.
8. About shows build/version, short commit SHA, and environment without duplicating Connections.
9. no Restore capability is implied or implemented.
10. existing auth behavior and accepted application UI regressions remain protected by tests.
