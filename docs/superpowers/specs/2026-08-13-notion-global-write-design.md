# Notion Global Write Design

Date: 2026-08-13
Status: Approved scope, implementation pending
Branch: `feat/notion-global-write`

## Goal

Extend the existing production Notion integration from global read-only access to the full write surface exposed by the Notion API for the configured Personal Access Token (PAT), while preserving the existing `search_notion` and `read_notion_page` tools.

The user explicitly wants no LeileiOS-side confirmation gate for destructive mutations. If the PAT/user has permission and the Notion API accepts the operation, the MCP tool may execute it directly.

## Security boundary

`NOTION_PAT` remains server-side only in Railway/environment configuration. It must never be returned by MCP tools, logged, committed, embedded in browser code, or accepted as a tool argument.

The PAT is user-scoped. LeileiOS may act only on Notion resources the PAT owner can access. LeileiOS adds no page allowlist and no additional read/write restriction layer.

No second `confirm=true` field is required for destructive operations. Native Notion authorization, validation, trash semantics, and API errors are the only mutation gates.

## API baseline

Use Notion API version `2026-03-11`.

The supported target is the official REST API surface available to a PAT with the `Notion API` capability. “Global/full write” means all relevant write operations that the official API exposes and that the authenticated Notion user is permitted to perform. It does not promise UI-only actions that have no API endpoint.

The write surface includes:

- Pages: create, update properties/content metadata, move, archive/trash, restore.
- Blocks: append/insert children, update, delete/trash, restore where the API supports it.
- Databases: create and update database-level metadata/location supported by the current API.
- Data sources: create and update schema, properties, title/icon, parent, trash/restore.
- Views: create and update supported view filters, sorts, quick filters, layout/configuration and placement.
- Comments: create/reply and update where the API permits the authenticated actor to do so.
- File uploads: create upload, send file bytes, complete multipart uploads where required, and attach returned file-upload IDs through page/block/database mutations.

Existing read/search behavior stays intact.

## Architecture

Keep Notion isolated as its own domain and avoid a raw arbitrary-URL HTTP passthrough.

### Shared transport

Add a shared Notion transport responsible for:

- `Authorization: Bearer <NOTION_PAT>`
- `Notion-Version: 2026-03-11`
- JSON request/response handling
- multipart upload handling
- rate-limit/upstream/error normalization
- ensuring only relative Notion API paths are used

The existing read client should reuse this transport so read and write calls share one auth/error implementation.

### Domain clients

Split resource behavior into focused modules rather than one large client:

- read/search client (existing behavior, migrated onto shared transport)
- page/block mutation client
- database/data-source/view mutation client
- comment client
- file-upload client

Each module exposes typed operations to MCP registration code and contains no authentication/user-session logic beyond the shared PAT transport.

### MCP tools

Expose explicit resource-oriented tools instead of one generic raw request tool. Tool schemas should use action enums/unions so ChatGPT has a discoverable contract and cannot accidentally send arbitrary external URLs.

Planned tools:

1. `write_notion_page`
   - actions: `create`, `update`, `move`, `trash`, `restore`
   - supports page properties, title, icon/cover, parent, and supported initial/updated content payloads

2. `write_notion_block`
   - actions: `append_children`, `insert_children`, `update`, `delete`, `restore`
   - supports official block payloads and child positioning fields exposed by the API

3. `write_notion_database`
   - actions: `create`, `update`
   - database-level metadata/location only; schema mutations belong to data sources under the current API model

4. `write_notion_data_source`
   - actions: `create`, `update`, `trash`, `restore`
   - supports schema/property creation, modification and removal according to Notion validation rules

5. `write_notion_view`
   - actions: `create`, `update`
   - supports the current view types and official filter/sort/configuration fields

6. `write_notion_comment`
   - actions: `create`, `reply`, `update`
   - follows Notion ownership/capability restrictions; an upstream 404/403 is returned as a normalized tool error rather than hidden

7. `upload_notion_file`
   - actions: `create`, `send`, `complete`
   - supports single-part and multipart upload flows
   - binary/file input is accepted only through the MCP/file-capable execution path; the PAT never crosses that boundary

The existing `search_notion` and `read_notion_page` stay registered unchanged from the user's perspective.

## Input policy

Tool inputs mirror Notion concepts but remain typed and bounded.

- IDs are strings and are passed only into known Notion endpoint templates.
- Mutation bodies accept only fields relevant to the selected resource/action.
- Arbitrary absolute request URLs are rejected.
- No LeileiOS confirmation flag is added.
- Notion-generated immutable fields are not accepted as writable inputs where the API rejects them.
- Large content/file operations respect Notion limits and surface validation errors instead of silently truncating mutations.

For content-heavy page/block operations, preserve Notion's native rich-text/block JSON shapes rather than inventing a second markup language. A later convenience layer may add Markdown-to-block conversion, but it is not required for full API write coverage.

## Output contract

All Notion mutation tools return a stable LeileiOS envelope:

```json
{
  "success": true,
  "data": {}
}
```

Errors return the existing MCP error style with a stable Notion error code and a safe message. Upstream response bodies are not dumped blindly if they could expose unnecessary internal data.

Useful returned identifiers (page ID, block ID, database ID, data-source ID, view ID, comment ID, file-upload ID, URL, trash state) are preserved when present.

## Error mapping

Normalize at least:

- `NOT_CONFIGURED` — `NOTION_PAT` missing
- `ACCESS_DENIED` — Notion 401/403
- `NOT_FOUND` — Notion 404 or inaccessible resource
- `CONFLICT` — Notion 409
- `RATE_LIMITED` — Notion 429
- `VALIDATION` — Notion 400 validation/input rejection
- `UPSTREAM` — network/5xx/invalid response

Do not retry non-idempotent writes automatically. Rate-limit/upstream errors are returned to the caller unless a later endpoint-specific idempotency strategy is explicitly designed.

## Destructive behavior

The user has explicitly approved direct destructive actions without an extra confirmation layer.

Examples that may execute immediately when requested:

- move a page/block to trash
- restore from trash
- delete/trash a block
- remove a data-source property by sending the API-supported null/removal form
- move databases/data sources/pages where supported
- replace/update content in ways that remove prior content

Notion's own trash/restore behavior is preserved. LeileiOS does not pretend an operation is permanently deleted if Notion represents it as `in_trash`.

## Testing

Use TDD for each resource module.

Unit tests mock the Notion HTTP boundary and verify:

- exact method/path/version/auth headers
- no PAT leakage in returned results/errors
- correct JSON and multipart request shaping
- error normalization for 400/401/403/404/409/429/5xx/network failures
- destructive actions do not require a synthetic confirmation field
- no write tool can target an arbitrary external URL

MCP contract tests verify:

- all seven new write tools are registered
- existing `search_notion` and `read_notion_page` still work
- unauthenticated MCP access is rejected before Notion mutation
- action-specific schemas reject unrelated fields

Verification gate before production:

```bash
pnpm test
pnpm typecheck
pnpm build
cd web && npm ci && npm run typecheck && npm run build
git diff --check
```

## Production smoke

After CI passes and production deploy succeeds, run authenticated MCP smoke tests against disposable Notion content created specifically for verification:

1. Create a temporary page.
2. Update its title/content.
3. Append and update a block.
4. Move/trash and restore the temporary page or block as supported.
5. Create a temporary database/data source/view when feasible without touching existing user structures; update them, then trash the temporary resources where the API supports cleanup.
6. Create a temporary comment and update/reply where permitted.
7. If a tiny disposable attachment is available through the MCP file path, verify the file-upload flow and attach it to the temporary page.
8. Re-read/search the temporary page to prove write/read round-trip.
9. Clean up the disposable test content using Notion's trash semantics.

Do not use existing user pages for destructive smoke tests.

## Non-goals

- No Notion-to-LeileiOS database synchronization.
- No background polling/webhooks in this phase.
- No local replica of Notion permissions.
- No extra confirmation workflow.
- No browser-side Notion token or direct browser-to-Notion calls.
- No promise to implement UI-only Notion features that the official API does not expose.

## Acceptance criteria

This phase is complete when:

- existing Notion global search/read remains operational;
- the seven resource-oriented mutation tools are available through authenticated LeileiOS MCP;
- they cover the current official Notion API write surface described above;
- destructive mutations have no LeileiOS-side confirmation requirement;
- PAT stays server-only;
- focused tests and full project verification pass;
- Railway deployment succeeds;
- a disposable end-to-end create/update/destructive/read-back smoke passes without modifying existing user content.