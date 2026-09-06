# Health v2 + Current Time MCP Design

Date: 2026-09-06
Base: `main@936a41d8c06537d5116e525e2a825e43955f6d5a`
Status: approved in chat; design-only, no implementation in this commit

## Goal

Add a deliberately small Apple Health path to LeileiOS for only:

- daily step count;
- menstrual/cycle context;
- read-only access for ChatGPT and Claude through the existing authenticated MCP endpoint.

Also add one independent read-only MCP tool, `get_current_time`, that returns the live current time in `Asia/Shanghai`.

Health date boundaries and cycle calculations use `Asia/Shanghai` consistently so Railway/Node UTC does not shift the user's business date.

## Historical boundary

This is a new Health v2 surface, not a revival of the retired Health implementation.

The prior `/api/v1/health` runtime was intentionally removed in PR #167, and the obsolete `health_records` table was later dropped in PR #174 after backup/restore rehearsal. The root infrastructure `GET /health` service healthcheck remains unrelated and must not change.

Do not restore the old `health_records` table or old Health runtime files. Create new names and contracts.

## Selected architecture

```text
Apple Health
  -> iOS Shortcut (hourly automation + manual run)
  -> POST /api/v1/health-sync
  -> dedicated Health sync-key auth
  -> Health v2 domain service
  -> health_daily_summaries
  -> get_health MCP read tool
  -> ChatGPT / Claude

Server clock
  -> get_current_time MCP read tool
  -> ChatGPT / Claude
```

### Alternatives considered

1. Restore the old Health runtime/table. Rejected because those surfaces were deliberately retired and the table was deliberately dropped.
2. Persist raw Apple Health samples or the full 60-day menstruation array. Rejected because the requested product only needs daily steps/cycle context, and raw history creates unnecessary privacy and storage surface.
3. Store one normalized daily summary and expose read-only MCP access. Selected because it is the smallest durable model that supports the requested questions and repeated Shortcut sync safely.

## Data model

Create a new table `health_daily_summaries` through one forward-only additive migration.

Fields:

- `id uuid primary key default random`
- `user_id uuid not null` -> `users.id`, restrict delete / cascade update
- `date date not null`
- `steps integer not null`
- `menstruating boolean not null`
- `period_start_date date null`
- `cycle_day integer null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints/indexes:

- unique `(user_id, date)`;
- `steps >= 0`;
- `cycle_day IS NULL OR cycle_day >= 1`;
- `period_start_date` and `cycle_day` are both null or both non-null;
- when non-null, `period_start_date <= date`;
- when non-null, `cycle_day = (date - period_start_date) + 1`.

No raw Apple Health sample, menstruation array, sleep, heart-rate, device identifier, source-app metadata, or location data is persisted.

## iPhone sync contract

### Shortcut behavior

The Shortcut keeps only Apple Health Steps and Menstruation logic.

Each run:

1. Sum today's Steps.
2. Read Menstruation records for the trailing 60 calendar days.
3. Convert Menstruation sample dates to unique `YYYY-MM-DD` dates.
4. Send today's Beijing business date, steps, and those dates to LeileiOS.

The Shortcut is intended to run once per hour through iOS Automation and remain manually runnable. Missing an hourly run is harmless; the next run replaces the same day's summary.

### Endpoint

`POST /api/v1/health-sync`

This route is outside the Auth0 Web API middleware, like the existing dedicated bridge-style machine endpoint, but is protected by its own secret-key middleware and database-readiness gate.

Headers:

- `Content-Type: application/json`
- `x-leilei-health-sync-key: <secret>`

Body:

```json
{
  "date": "2026-09-06",
  "steps": 6842,
  "menstruation_dates": [
    "2026-08-31",
    "2026-09-01",
    "2026-09-02"
  ]
}
```

The body is strict: unknown fields are rejected.

Successful sync always returns HTTP `200` with the normalized persisted summary:

```json
{
  "success": true,
  "data": {
    "date": "2026-09-06",
    "steps": 6842,
    "menstruating": false,
    "period_start_date": "2026-08-31",
    "cycle_day": 7,
    "updated_at": "2026-09-06T04:30:00.000Z"
  }
}
```

The client does not need to distinguish create from update.

### Dedicated configuration

Add:

- `LEILEI_HEALTH_SYNC_KEY`: minimum 32 characters;
- `LEILEI_HEALTH_SYNC_USER_ID`: UUID of the LeileiOS owner account.

The client never supplies `user_id`. The server binds every accepted Shortcut write to `LEILEI_HEALTH_SYNC_USER_ID`.

Do not reuse OAuth credentials, MCP bearer material, the Toy bridge key, or any other existing secret.

### Sync-key authentication

Use the same security shape as the existing Toy bridge key middleware:

- fail closed if the server key/user binding is not configured;
- read one dedicated header;
- compare digests in constant time;
- return generic errors;
- never log the key or request body.

### Input validation

Reject with `400` when:

- `date` is not exact `YYYY-MM-DD`;
- `date` is in the future relative to `Asia/Shanghai`;
- `steps` is not an integer in PostgreSQL `integer` range `0..2147483647`;
- `menstruation_dates` is not an array;
- the array contains more than 60 values;
- any item is not exact `YYYY-MM-DD`;
- any menstruation date is after `date`;
- any menstruation date is earlier than `date - 59 days`.

Duplicates are accepted and normalized away before calculation.

Invalid/missing sync key returns `401`. Missing server configuration returns `503`.

### Menstrual/cycle derivation

For an accepted request:

1. Deduplicate and sort `menstruation_dates` ascending.
2. `menstruating = menstruation_dates.includes(date)`.
3. Split the dates into consecutive-day runs.
4. Choose the most recent run.
5. `period_start_date` is the first date of that most recent run.
6. `cycle_day = date - period_start_date + 1`.
7. If the 60-day window contains no menstruation date, both `period_start_date` and `cycle_day` are null and `menstruating=false`.

This intentionally treats `cycle_day` as cycle position since the latest recorded period start, not as "menstrual bleeding day".

The raw 60-day input array is discarded after derivation.

### Persistence semantics

Use a transaction-scoped active-user authorization guard before the durable mutation.

Upsert on `(user_id, date)`:

- first sync creates the daily row;
- later same-day syncs replace `steps`, `menstruating`, `period_start_date`, and `cycle_day` and advance `updated_at`;
- repeated calls never create duplicate daily rows;
- a failed validation/auth/database operation leaves the existing summary unchanged.

## Health domain boundaries

Add a focused Health v2 domain with clear separation:

- repository: owner-scoped daily upsert and bounded reads;
- service: active-user authorization, payload normalization, cycle derivation, Beijing-date validation, and read-range rules;
- sync router/auth: HTTP-only concerns;
- MCP mapping: tool schema/result mapping only.

Do not couple Health to Task internals. The project already uses `@js-temporal/polyfill`; create/reuse a small generic time helper for fixed `Asia/Shanghai` date/time operations rather than importing Task-domain business logic.

## `get_health` MCP tool

Add one read-only MCP tool named exactly `get_health` for the authenticated public MCP surface used by ChatGPT and Claude.

No Health MCP write tool is added.

### Input

Strict object with optional:

- `date`: exact `YYYY-MM-DD`;
- `days`: integer `1..60`.

Rules:

- no arguments -> today's `Asia/Shanghai` date;
- `date` -> that exact day;
- `days` -> the trailing N Beijing calendar days ending today;
- `date` and `days` together are rejected;
- future `date` values are rejected relative to `Asia/Shanghai`;
- no `user_id`, identity, host, model, author, connector, or OAuth fields are accepted.

### Read semantics

The authenticated MCP user ID is server-owned and passed to the Health service. Reads are owner-scoped and active-user guarded.

A requested day with no stored summary is represented as no record for that day; do not fabricate zero steps or cycle values. Multi-day results are ordered by `date` ascending.

The stable result contract is:

```json
{
  "timezone": "Asia/Shanghai",
  "records": [
    {
      "date": "2026-09-06",
      "steps": 6842,
      "menstruating": true,
      "period_start_date": "2026-09-04",
      "cycle_day": 3,
      "updated_at": "2026-09-06T04:30:00.000Z"
    }
  ]
}
```

Tool annotations remain read-only, non-destructive, and idempotent.

## `get_current_time` MCP tool

Add one independent read-only MCP tool named exactly `get_current_time`.

Input: strict empty object.

It does not read or write the database. It obtains the current instant from an injectable clock and formats it in fixed `Asia/Shanghai` using the project's Temporal dependency.

Return:

```json
{
  "date": "2026-09-06",
  "time": "12:33:10",
  "datetime": "2026-09-06T12:33:10+08:00",
  "timezone": "Asia/Shanghai",
  "weekday": "Sunday"
}
```

`weekday` uses the full English weekday name for a stable machine-readable contract.

The tool still runs inside the authenticated MCP session and should use the same active-user authorization boundary as other protected MCP tools.

Do not call it `get_beijing_time`; the tool name is intentionally generic while the current product contract is fixed to `Asia/Shanghai`.

## Privacy and observability

Health is sensitive personal data. Apply a stricter logging contract than ordinary product data:

- never log the sync key;
- never log `menstruation_dates`;
- never log persisted period/cycle values or step counts in routine request logs;
- never log the HTTP body or MCP Health result body;
- Health-specific log events may contain only safe operational fields such as route/surface, success/failure, status/error code, and bounded timing;
- existing generic HTTP observability must remain body-free.

`health_daily_summaries` is not added to Global Search, Memory, Diary, Task, Todo, Universe, Calendar, Web UI, System Data UI, export/import bundles, or MCP write-idempotency tables in this change.

Database-level encrypted backups naturally include the new table; no new plaintext backup/export path is introduced.

## Error contract

HTTP sync:

- `200` valid sync, whether it created or updated the daily row;
- `400` invalid payload/date/window;
- `401` bad/missing sync key;
- `503` missing Health sync configuration, disabled/unavailable owner, or database readiness failure;
- generic `500` for unexpected server failure with no sensitive detail.

MCP reads:

- follow existing safe MCP error mapping;
- invalid tool input fails closed;
- disabled user/unavailable repository does not reveal data existence;
- `get_current_time` must not expose internal stack/config details on failure.

## Test strategy

Implementation is test-driven.

### Unit/contract tests

- Health schema migration/source contract;
- sync-key middleware: configured, missing, wrong, constant-time comparison shape;
- strict payload schema and unknown-field rejection;
- Beijing future-date/window boundaries;
- cycle derivation: no data, one day, multi-day run, duplicate/unsorted input, multiple runs, current non-menstruating day;
- same-day upsert semantics;
- `get_health` schema: default/date/days, mutual exclusion, future-date rejection, max 60, no identity fields;
- `get_health` stable wrapper and ascending multi-day order;
- `get_current_time` strict empty schema and deterministic injected-clock output;
- MCP annotations remain read-only/non-destructive/idempotent;
- MCP inventory increases only by the intended tools.

### PostgreSQL integration

Against disposable PostgreSQL with the full migration chain:

- migration creates `health_daily_summaries` with exact constraints;
- owner/date uniqueness;
- create then update remains one row;
- cross-user reads are isolated;
- disabled-user writes fail without mutation;
- range reads are deterministic and bounded;
- unrelated durable row counts are unchanged by the migration.

### Application/API integration

- valid sync through the real Express mount;
- bad key / missing config / invalid payload / database unavailable paths;
- route does not require Auth0 Web credentials but does require the dedicated Health key;
- successful create and update both return `200` with the normalized stored summary;
- `/health` infrastructure endpoint remains unchanged;
- retired `/api/v1/health` runtime is not restored.

### Full verification

Before review/merge:

- focused Health/current-time tests;
- canonical full test suite;
- root typecheck/build;
- Web typecheck/build (even though no Web UI is changed, to preserve repository gate consistency);
- `pnpm db:check` against disposable PostgreSQL;
- full migration rehearsal on disposable PostgreSQL;
- `git diff --check`;
- Security Review focused on secret handling, user binding, Health logging/privacy, ownership isolation, and migration safety.

## Production rollout and acceptance

Merge, production migration/deployment, secret configuration, and first real Health write remain separate authorization steps.

Rollout order:

1. confirm current encrypted backup/restore readiness;
2. configure `LEILEI_HEALTH_SYNC_KEY` and `LEILEI_HEALTH_SYNC_USER_ID` without exposing the key in chat/logs;
3. deploy the exact reviewed app SHA; pre-deploy migration creates only the additive Health v2 table;
4. verify service startup, `/health`, `/ready`, and safe logs;
5. verify ChatGPT and Claude see `get_health` and `get_current_time` with the expected read-only schemas;
6. manually run the real iPhone Shortcut once;
7. read the resulting day through `get_health` from ChatGPT and Claude and confirm both see the same steps/cycle summary;
8. confirm `get_current_time` returns live `Asia/Shanghai` time;
9. enable the hourly iOS Automation after the manual smoke succeeds.

Do not create synthetic menstrual history in production merely for smoke testing. The production acceptance uses the user's real Shortcut payload or a separately authorized, non-sensitive test payload.

## Rollback

The migration is additive and does not rewrite existing business tables.

If the new app must be rolled back after Health rows exist, rolling back the application is allowed: the old app ignores the new table and existing Health rows remain preserved. Do not drop `health_daily_summaries` as an emergency rollback. Fix forward or perform a separately designed, explicitly authorized data-retirement operation later.

## Explicit non-scope

- Sleep data.
- Heart-rate data.
- Calories, workouts, weight, location, device metadata, or arbitrary HealthKit samples.
- Health Web UI.
- Health editing from ChatGPT or Claude.
- Health MCP write tools.
- Global Search indexing.
- Export/import integration.
- Recreating the retired `health_records` table or `/api/v1/health` runtime.
- Predicting future periods or providing medical diagnosis.
- Multiple user-configurable timezones for these two tools; current contract is fixed `Asia/Shanghai`.
