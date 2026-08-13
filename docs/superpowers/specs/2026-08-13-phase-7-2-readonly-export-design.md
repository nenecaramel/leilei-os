# Phase 7.2 Read-only Export Design

## Goal

Add a minimal, read-only export capability to LeileiOS so the authenticated user can download a versioned JSON snapshot of selected durable business data from `System → Data`. The export format is intentionally designed to become the input contract for the later import/recovery phase without coupling it to current UI or database implementation details.

## Scope

Supported business modules:

- Memory
- Diary
- Task
- Todo

Memory, Diary, and Task exports include both active and archived records. Todo exports all persisted papers and ordered entries, including durable empty papers.

Optional audit export is available through an explicit UI switch that defaults off. When enabled, the export additionally contains lifecycle events and sanitized tool-call audit metadata.

Out of scope for Phase 7.2:

- Health
- Toy
- account/profile/settings export
- Auth0 or other authentication identities
- server/database backups
- import, dry-run, merge, conflict resolution, or restore
- ZIP archives or multiple-file bundles
- background export jobs or server-side export-file persistence
- MCP export tools

## Architecture

Create an independent export domain under `src/domains/export/`.

The export domain owns:

- the stable export contract
- export scope validation
- user-scoped data reads for Memory, Diary, Task, Todo, and optional audit data
- normalization from database representation into the export contract
- deterministic ordering

The existing `SystemService` remains focused on System summary/activity behavior and does not implement export generation.

Expose the domain through a dedicated Web API handler mounted at `/api/v1/system/export`. The authenticated user ID is supplied only by the existing Web API authentication layer; the client cannot provide or override a `user_id`.

The web UI in `System → Data` requests the export, receives the JSON response in memory, and triggers the browser download. The server does not create a temporary or durable export file.

## Export API

### Request

`GET /api/v1/system/export`

Query parameters:

- `scope`: required; one of `all`, `memory`, `diary`, `task`, `todo`
- `include_audit`: optional; `true` enables audit output; omitted or `false` disables it

No request parameter may select a user.

### Response

Success:

- HTTP `200`
- `Content-Type: application/json; charset=utf-8`
- `Content-Disposition: attachment; filename="leileios-export-<UTC timestamp>.json"`
- body is the export document itself, not wrapped in the normal `{ success, data }` API envelope

Failure:

- `400` invalid or missing scope / invalid `include_audit`
- `401` unauthenticated
- `503` export data could not be read or generated

On failure, no partial export body is returned as a downloadable attachment.

## Export Contract

Version 1 top-level shape:

```json
{
  "schema_version": 1,
  "exported_at": "2026-08-13T05:38:00.000Z",
  "scope": "all",
  "data": {
    "memory": [],
    "diary": [],
    "task": [],
    "todo": []
  }
}
```

When audit is explicitly enabled, add:

```json
{
  "audit": {
    "lifecycle": [],
    "tool_activity": []
  }
}
```

The `audit` property is absent when audit export is disabled.

For a single-module export, `data` contains only that selected module. For `scope=all`, `data` contains all four supported modules.

The top level intentionally does not contain redundant `counts`, `include_audit`, or application-version fields. Consumers can derive counts from `data`, audit presence from the `audit` property, and compatibility from `schema_version`.

## Business Data Shapes

The export preserves business identity and restoration-relevant fields while omitting authentication and infrastructure bookkeeping.

### Memory

Each record includes:

- `id`
- `category`
- `key`
- `content`
- `tags`
- `visibility`
- `source`
- `author`
- `status`
- `sort_order`
- `created_at`
- `updated_at`

Omit `user_id`.

### Diary

Each record includes:

- `id`
- `title`
- `content`
- `date`
- `tags`
- `mood`
- `source`
- `author`
- `status`
- `created_at`
- `updated_at`

Omit `user_id`, `idempotency_key`, and `request_hash`.

### Task

Each record includes:

- `id`
- `title`
- `description`
- `status`
- `resume_status`
- `lifecycle_status`
- `author`
- `priority`
- `due_time`
- `timezone`
- `tags`
- `created_at`
- `updated_at`
- `completed_at`

Omit `user_id`.

### Todo

Each paper is exported by its logical identity rather than internal database UUID:

- `date`
- `author`
- `revision`
- `created_at`
- `updated_at`
- `entries`

Each entry includes:

- `id` — the persisted logical entry ID
- `kind`
- `text`

Entry array order is the persisted paper order. Internal `todo_papers.id`, `todo_entries.id`, `paper_id`, and numeric `position` are omitted because they are database implementation details; entry order is represented by array order.

An empty persisted Todo paper is exported as a paper with an empty `entries` array. A missing paper produces no paper record.

## Audit Shape

Audit export is optional and informational. It is not part of the core business-data restore contract.

### Lifecycle events

Export all user-scoped lifecycle rows, ordered deterministically, with:

- `id`
- `resource_type`
- `resource_id`
- `action`
- `actor_type`
- `channel`
- `metadata`
- `created_at`

Omit `user_id`.

### Tool activity

Export user-scoped tool-call metadata with:

- `id`
- `tool_name`
- `operation`
- `resource_type`
- `resource_id`
- `duration_ms`
- `status`
- `error_code`
- `created_at`

Omit:

- `user_id`
- `idempotency_key`
- `request_summary`
- `result_summary`

This keeps the optional audit useful while avoiding export of idempotency infrastructure or private request/response summaries.

## Deterministic Ordering

The contract must define stable ordering so repeated exports of unchanged data differ only in `exported_at`.

Use these logical orders:

- Memory: `created_at`, then `id`
- Diary: `date`, then `created_at`, then `id`
- Task: `created_at`, then `id`
- Todo papers: `date`, then `author`
- Todo entries: persisted `position`
- Lifecycle audit: `created_at`, then `id`
- Tool activity: `created_at`, then `id`

All timestamps are serialized as ISO 8601 UTC strings. Nullable database values remain JSON `null`; absent optional top-level sections remain absent rather than becoming `null`.

## UI

Keep all export controls inside the existing `System → Data` page.

Add:

- `Export all`
- `Export Memory`
- `Export Diary`
- `Export Task`
- `Export Todo`
- `Include audit/lifecycle events` switch, default off

Do not add export controls to the individual Memory, Diary, Task, or Todo pages.

Export actions should disable only while their request is in progress. A successful response triggers a browser JSON download. A failed request shows a local error state and does not download a file.

No progress UI, job history, server-side export history, or confirmation modal is needed for this read-only operation.

## Security and Privacy

- Authentication is mandatory.
- All queries are scoped by the authenticated server-side user ID.
- The API does not accept a user identifier.
- The export never contains internal `user_id`, Auth0 subject, access tokens, refresh tokens, secrets, MCP idempotency rows, or request hashes.
- Diary idempotency fields are omitted.
- Todo MCP idempotency records are omitted.
- Tool audit request/result summaries and idempotency keys are omitted.
- Export is read-only and must not create lifecycle or MCP write audit side effects.

## Testing

Focused tests must cover:

1. export contract `schema_version=1` and minimal top-level shape
2. each single-module scope contains only the selected module
3. `all` contains Memory, Diary, Task, and Todo
4. Memory/Diary/Task include active and archived records
5. Todo includes non-empty and durable empty papers, preserves revision and entry order, and excludes missing papers
6. infrastructure/user identity fields are absent
7. audit property is absent by default
8. audit property appears only when requested and excludes request/result summaries and idempotency data
9. deterministic ordering and UTC timestamp serialization
10. one user cannot export another user's data
11. unauthenticated request returns `401`
12. invalid query parameters return `400`
13. repository/service failure returns `503` without an attachment response
14. success response uses JSON attachment headers
15. System Data UI exposes the five export actions and default-off audit switch
16. successful UI action downloads the returned JSON; failed action does not

Existing full backend and web regression suites remain the final acceptance gate.

## Acceptance Criteria

Phase 7.2 is complete when:

- production `System → Data` can download all five supported scopes
- downloaded JSON matches schema version 1
- full export contains Memory, Diary, Task, and Todo business data for only the authenticated user
- archived Memory/Diary/Task records are included
- Todo paper revisions and exact entry order are preserved
- optional audit behavior matches the switch
- prohibited identity/infrastructure fields are absent
- no database mutation occurs during export
- focused tests, full backend tests, backend typecheck/build, web typecheck/build, and production smoke verification pass
