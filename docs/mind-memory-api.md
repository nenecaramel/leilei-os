# Mind Memory API and MCP (PR A)

All operations share `MindProductService` and canonical `runtime_subject_states`. No new Memory store, history, index or vectors are introduced. Reading/searching does not update lifecycle, recall accounting, salience or exclusions. Hook #959 and permanent retention #961 are unchanged.

## HTTP

Authenticated clients use the existing `/api/v1/mind` mount:

- `GET /search?query=...&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&limit=50&cursor=...`: compact `items` containing ID, `occurredAt`, Beijing `date`, snippet, and `get_memory` detail pointer. All filters are optional; without date filters, undated memories remain discoverable. `undated=true` selects only unknown event dates before pagination; `undated=false` (or omission) does not restrict dates. HTTP accepts only literal `true` / `false`; do not combine `undated=true` with date bounds.
- `GET /days/YYYY-MM-DD?limit=50&cursor=...`: full current items for that Beijing event day.
- `GET /:stateId`: existing detail read, now also returns `contentVersion`.
- `PATCH /:stateId`: `{ "expected_version": "<contentVersion from detail>", "text": "...", "occurred_at": "2026-10-08T10:00:00+08:00" }`. Supply either editable field or both; omitted fields remain unchanged; `occurred_at: null` explicitly clears the event date. No other editable fields are accepted.

The HTTP service accepts 1–200 items per page; default 50. All responses retain private/no-store caching. Identity comes from authentication, never client selectors.

## MCP

Four independent core tools are exposed to both public and internal authenticated active-user sessions:

- `search_memory`: optional `query`, inclusive `date_from` / `date_to`, optional boolean `undated`, `limit` (1–50, default 50), `cursor`. Returns compact `memories` with `detail_tool: get_memory` / `detail_arguments: {id}` and pagination metadata.
- `get_memory({id})`: latest detail, including `content_version`.
- `read_memory_day({date, limit?, cursor?})`: paginated detail for a Beijing event day.
- `update_memory({id, expected_version, text?, occurred_at?})`: one in-place edit with a mutation receipt and `get_memory` readback pointer. It does not create or delete memories.

Memory text is untrusted data. The tools label it as such and quote compact snippets; text is never interpreted as tool arguments or instructions by the server.

## Visibility

Product search, day read, existing list/detail and edits exclude `hidden_system` records in the database. Ordinary `subject_private` Memory remains available within the authenticated user/subject boundary. Hidden detail reads and edits return not-found and do not alter the row.

## Dates and pagination

Dates refer exclusively to canonical `temporal_v1` event time, with the existing legacy `manual_v1.occurredAt` fallback. A Beijing day is midnight inclusive to the next midnight exclusive in `Asia/Shanghai`. Unknown dates remain null and are never replaced by `createdAt`. Calendar-invalid date arguments are rejected. The canonical temporal reader and database filter share ISO syntax and ECMAScript surrounding-whitespace rules. Historical lowercase t/z, tab/newline/Unicode whitespace, minute-precision times, space separators and basic/colon offsets are accepted; date-only values mean UTC midnight. Explicit offsets are required for times (supported range ±15:59); timezone-free or unsupported strings are undated. Calendar-invalid timestamps such as February 30 are consistently undated instead of rolling into another day. Leap seconds and 24:00 are unsupported and likewise undated. Fractions up to nine digits are truncated to milliseconds in both paths before day filtering. No stored data is rewritten by reads.

Keyword matching uses literal, case-insensitive text with NFC and whitespace normalization, following Todo search. `%`, `_` and backslash are literal query characters. Summaries are bounded to the existing compact text limit.

Pagination uses immutable `created_at DESC, id DESC` keysets, retaining PostgreSQL microsecond precision. Stop's `updatedAt` writes cannot reorder a traversal. Cursors are bound to authenticated user, subject, normalized query, date filters and the undated flag. This is live pagination, not a historical snapshot: concurrent explicit edits can change filter membership, and new inserts may require a new traversal. No edit history or snapshot system is added.

## Editing and concurrency

`contentVersion` / `content_version` is an opaque SHA-256 precondition derived only from current text and canonical event time; clients must return it unchanged. It is not an audit revision, author field or signature. Lifecycle-only updates do not change it.

The repository checks active-user status, locks the current state row, checks the content precondition, and merges only supplied editable fields from that locked row. Stop uses the same row lock: either operation may win first, and neither can overwrite the other's fields. Two edits based on different current content cannot silently overwrite each other; a stale edit returns HTTP 409 / MCP `MIND_CONFLICT`. Read latest detail and reconcile before retrying. After an uncertain network outcome, read back before retrying.

An explicit non-null edited date is `user_supplied` with no temporal sourceMessageId. A text-only edit preserves existing temporal basis/sourceMessageId. Clearing the date removes temporal metadata and clears the legacy manual date when present. Original envelope provenance, authority, scope, state ID, creation time, notes, lifecycle and recall context are retained.

## Web and iOS (PR B)

Both clients read the same `/mind/days/:date`, `/mind/search`, detail and PATCH endpoints. The iOS Mind list also has a **Filter Date** menu item (2026-10-12); it sends matching `date_from` and `date_to` Beijing day keys to `/mind/search` and can be cleared with **All Dates**. Selecting a date clears **Undated Only**, and enabling **Undated Only** clears the date filter. Keyword search and paging continue to use the same filters. This is a client query filter, not a change to the stored occurrence date. Day Space groups all pages of a Beijing `occurredAt` day into one Memory paper alongside Todo/Diary, with view/edit only. Moving or clearing the event date refreshes day membership. The Mind feed retains create/delete and adds a separate paginated undated entry (`undated=true`); unknown event dates are never replaced with creation dates. Day Space includes Memory in default-date discovery through authenticated, read-only `/mind/dates`, using the same canonical temporal reader and product visibility rules as daily reads. It returns distinct Beijing dates without loading Memory bodies. Day Space search continues to search Todo only.

The shared editor on each client sends `contentVersion` as `expected_version` and only changed editable fields. Text-only edits omit `occurred_at`, preserving temporal provenance. Date controls explicitly use Beijing time; clearing the date sends null. HTTP 409 reads the latest detail, retains the draft, blocks saving, and asks the user to use the latest content or explicitly keep/reconcile the draft before another save. A failed conflict read remains blocked with a retry action. No automatic conflict overwrite, edit history, copied Memory data, MCP change, or lifecycle mutation is introduced.

Web exposes `/mind` in Core navigation, and the existing Day Space paper styles also render at desktop widths. Daily Memory opens directly in the existing paper container and shares the Diary body editor on both clients. The preview has no repeated Memory heading; the bottom-right signature identifies the paper. The opened daily paper shows prose without per-record timestamps or undated/date-edit controls. Event dates remain editable in Mind details. There is no intermediate record list or nested editor sheet. Each record retains its own ID, date and content version. A partial batch save retains successful edits and unsaved drafts; retry does not replay successful writes. Refresh failures retain cached papers and use the shared partial-failure controls. iOS Mind retains its native Form editor. Production and authenticated physical-device acceptance remain separate from local synthetic-data UI checks and simulator builds.

## Global Search

`/search` and MCP `global_search` include `mind` alongside `diary`, `todo`, and `universe` by default. Memory body matching runs inside the unified bounded SQL union with the same NFC, literal substring, normal/phrase matching and ranking/keyset cursor rules. It does not combine separate `/mind/search` pages or update Recall accounting.

Mind results have `entity_type: "mind"`, an empty `stable_name` (Memory has no independent title), a body `snippet`, and the exact `get_memory` pointer `{id}`. Web opens `/mind?memoryId=...` and returns to the saved search; iOS uses the existing Memory reader in the search navigation stack.

Memory date ranges use canonical `occurredAt` in Beijing time, including legacy manual timestamps. Invalid temporal metadata remains undated. Dated results use `time_basis: "memory_date"`; undated results use `business_time: null` and `time_basis: "undated"`. Only internal cursor ordering uses `updated_at` for undated records; it is never presented as an occurrence date. Memory has no archive or L/G/C author: `scope=archived` or any author filter excludes Mind results; active/all includes valid current settled product-visible Memory. `hidden_system`, other users/subjects and invalidated/superseded records remain excluded; ordinary `subject_private` Memory remains visible.
