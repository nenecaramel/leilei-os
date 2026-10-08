# Mind Memory API and MCP (PR A)

All operations share `MindProductService` and canonical `runtime_subject_states`. No new Memory store, history, index, vectors or global_search module is introduced. Reading/searching does not update lifecycle, recall accounting, salience or exclusions. Hook #959 and permanent retention #961 are unchanged.

## HTTP

Authenticated clients use the existing `/api/v1/mind` mount:

- `GET /search?query=...&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&limit=50&cursor=...`: compact `items` containing ID, `occurredAt`, Beijing `date`, snippet, and `get_memory` detail pointer. All filters are optional; without date filters, undated memories remain discoverable.
- `GET /days/YYYY-MM-DD?limit=50&cursor=...`: full current items for that Beijing event day.
- `GET /:stateId`: existing detail read, now also returns `contentVersion`.
- `PATCH /:stateId`: `{ "expected_version": "<contentVersion from detail>", "text": "...", "occurred_at": "2026-10-08T10:00:00+08:00" }`. Supply either editable field or both; omitted fields remain unchanged; `occurred_at: null` explicitly clears the event date. No other editable fields are accepted.

The HTTP service accepts 1–200 items per page; default 50. All responses retain private/no-store caching. Identity comes from authentication, never client selectors.

## MCP

Four independent core tools are exposed to both public and internal authenticated active-user sessions:

- `search_memory`: optional `query`, inclusive `date_from` / `date_to`, `limit` (1–50, default 50), `cursor`. Returns compact `memories` with `detail_tool: get_memory` / `detail_arguments: {id}` and pagination metadata.
- `get_memory({id})`: latest detail, including `content_version`.
- `read_memory_day({date, limit?, cursor?})`: paginated detail for a Beijing event day.
- `update_memory({id, expected_version, text?, occurred_at?})`: one in-place edit with a mutation receipt and `get_memory` readback pointer. It does not create or delete memories.

Memory text is untrusted data. The tools label it as such and quote compact snippets; text is never interpreted as tool arguments or instructions by the server.

## Dates and pagination

Dates refer exclusively to canonical `temporal_v1` event time, with the existing legacy `manual_v1.occurredAt` fallback. A Beijing day is midnight inclusive to the next midnight exclusive in `Asia/Shanghai`. Unknown dates remain null and are never replaced by `createdAt`. Calendar-invalid date arguments are rejected. Invalid stored temporal metadata cannot abort the whole date query.

Keyword matching uses literal, case-insensitive text with NFC and whitespace normalization, following Todo search. `%`, `_` and backslash are literal query characters. Summaries are bounded to the existing compact text limit.

Pagination uses immutable `created_at DESC, id DESC` keysets, retaining PostgreSQL microsecond precision. Stop's `updatedAt` writes cannot reorder a traversal. Cursors are bound to authenticated user, subject, normalized query and date filters. This is live pagination, not a historical snapshot: concurrent explicit edits can change filter membership, and new inserts may require a new traversal. No edit history or snapshot system is added.

## Editing and concurrency

`contentVersion` / `content_version` is an opaque SHA-256 precondition derived only from current text and canonical event time; clients must return it unchanged. It is not an audit revision, author field or signature. Lifecycle-only updates do not change it.

The repository checks active-user status, locks the current state row, checks the content precondition, and merges only supplied editable fields from that locked row. Stop uses the same row lock: either operation may win first, and neither can overwrite the other's fields. Two edits based on different current content cannot silently overwrite each other; a stale edit returns HTTP 409 / MCP `MIND_CONFLICT`. Read latest detail and reconcile before retrying. After an uncertain network outcome, read back before retrying.

An explicit non-null edited date is `user_supplied` with no temporal sourceMessageId. A text-only edit preserves existing temporal basis/sourceMessageId. Clearing the date removes temporal metadata and clears the legacy manual date when present. Original envelope provenance, authority, scope, state ID, creation time, notes, lifecycle and recall context are retained.

No UI changes are included. Dayspace and Mind detail can reuse this same PATCH interface in PR B; day views need not offer create/delete. Web and iOS share this backend contract.
