# Notion Global Write Design

Date: 2026-08-13
Status: Historical design; superseded by the implementation now present on `main`
Original implementation branch: `feat/notion-global-write`

This document is retained for design provenance. It is not a current
deployment or implementation checklist. The approved explicit-write scope is
implemented in the current `main` tree, including the authenticated
resource-oriented write tools; do not use the historical branch named above
as an integration target.

## Goal

Extend the existing production Notion integration from global read-only access to the full write surface exposed by the Notion API for the configured Personal Access Token (PAT), while preserving the existing `search_notion` and `read_notion_page` tools.

The user explicitly wants no LeileiOS-side confirmation gate for destructive mutations. If the PAT/user has permission and the Notion API accepts the operation, the MCP tool may execute it directly.

## Security boundary

`NOTION_PAT` remains server-side only in Railway/environment configuration. It must never be returned by MCP tools, logged, committed, embedded in browser code, or accepted as a tool argument.

The PAT is user-scoped. LeileiOS may act only on Notion resources the PAT owner can access. LeileiOS adds no page allowlist and no additional read/write restriction layer.

No second `confirm=true` field is required for destructive operations. Native Notion authorization, validation, trash semantics, capability/plan checks, and API errors are the only mutation gates.

## API baseline

Use Notion API version `2026-03-11`.

The supported target is the official REST API surface available to a PAT with the `Notion API` capability. “Global/full write” means all relevant write operations that the official API exposes and that the authenticated Notion user is permitted to perform. It does not promise UI-only actions or plan-gated capabilities that Notion does not make available to this workspace.

The write surface includes:

- Pages: create, update properties/content metadata, enhanced-Markdown content updates, move, trash, restore, lock/template/erase-content fields supported by the page update endpoint.
- Blocks: append/insert children with the 2026-03-11 `position` object, update, delete/trash, and restore where supported.
- Databases: create and update database-level metadata/location, lock state, trash, and restore.
- Data sources: create and update schema, properties, title/icon, parent, trash/restore; setting a supported property schema entry to `null` removes it.
- Views: create, update filters/sorts/quick filters/layout/configuration, and permanently delete a view when Notion permits it.
- Comments: create/reply, update, and delete where Notion permits the authenticated connection to do so. Notion limits update/delete to comments created by that connection.
- File uploads: create upload, send file bytes, complete multipart uploads where required, support Notion's external URL import mode through the create body, and attach returned file-upload IDs through later mutations.
- AI Meeting Notes: create a Meeting Note through the current meeting-note endpoint from a supported source when the workspace/plan exposes that capability.

Existing read/search behavior stays intact.

## Architecture

Keep Notion isolated as its own domain and avoid a raw arbitrary-URL HTTP passthrough.

### Shared transport

A shared Notion transport is responsible for:

- `Authorization: Bearer <NOTION_PAT>`
- `Notion-Version: 2026-03-11`
- JSON request/response handling
- multipart upload handling
- rate-limit/upstream/error normalization
- ensuring only relative Notion API paths are used

The existing read client reuses this transport so read and write calls share one auth/error implementation.

### Domain clients

Resource behavior stays split into focused modules rather than one large client:

- read/search client
- page/block mutation client
- database/data-source/view mutation client
- comment client
- file-upload client
- meeting-note client

Each module exposes typed operations to MCP registration code and contains no MCP authentication/session logic beyond the shared PAT transport.

### Server composition

The existing base MCP server continues to register the established LeileiOS tools, including `search_notion` and `read_notion_page`.

A focused Notion write registrar composes the eight write tools onto each authenticated production MCP session after the base server is created. It lazily constructs one shared Notion transport from `env.NOTION_PAT` and focused domain clients on top of it. This keeps the write feature isolated instead of expanding the already-large base server factory.

### MCP tools

Expose explicit resource-oriented tools instead of one generic raw request tool. Tool schemas use discriminated action unions or one bounded body so ChatGPT has a discoverable contract and cannot send arbitrary endpoint URLs.

1. `write_notion_page`
   - actions: `create`, `update`, `move`, `update_content`, `trash`, `restore`
   - supports page properties, title, icon/cover, parent, lock/template/erase fields, and enhanced-Markdown content operations supported by Notion

2. `write_notion_block`
   - actions: `append_children`, `insert_children`, `update`, `delete`, `restore`
   - supports official block payloads and 2026-03-11 child `position` fields

3. `write_notion_database`
   - actions: `create`, `update`, `trash`, `restore`
   - database-container metadata/location/lock/trash operations; schema mutations belong to data sources

4. `write_notion_data_source`
   - actions: `create`, `update`, `trash`, `restore`
   - supports schema/property creation, modification, removal and supported moves

5. `write_notion_view`
   - actions: `create`, `update`, `delete`
   - supports current view types and official filter/sort/quick-filter/configuration fields; delete is permanent and Notion rejects deletion of a database's last view

6. `write_notion_comment`
   - actions: `create`, `reply`, `update`, `delete`
   - follows Notion ownership/capability restrictions; update/delete may only target comments that the connection created

7. `upload_notion_file`
   - actions: `create`, `send`, `complete`
   - supports single-part, multipart, and external-URL creation flows supported by Notion
   - `send` accepts a bounded base64 payload through MCP JSON, decodes it server-side to a `Blob`, and never accepts local filesystem paths or a token

8. `create_notion_meeting_note`
   - sends a bounded official request body to `POST /blocks/meeting_notes`
   - supports the current Notion meeting-note source/parent/title/language/options body without inventing a separate LeileiOS format
   - an unavailable workspace/plan capability is surfaced as a Notion error rather than treated as success

The existing `search_notion` and `read_notion_page` stay registered unchanged from the user's perspective.

## Input policy

Tool inputs mirror Notion concepts but remain typed and bounded.

- Resource IDs are strings passed only into known Notion endpoint templates and cannot be absolute URLs or paths.
- Mutation bodies use bounded JSON objects and are sent only to the endpoint implied by the selected tool/action.
- No raw HTTP endpoint URL and no PAT/token field is exposed.
- No LeileiOS confirmation flag is added.
- Large content/file operations are bounded at the MCP boundary and still surface Notion validation errors rather than silently altering payloads.
- Generic Notion request-body fragments intentionally preserve the official API's evolving rich-text/block/property/view/meeting-note shapes instead of duplicating the entire Notion schema inside LeileiOS.

## Output contract

All Notion mutation tools return a stable LeileiOS envelope:

```json
{
  "success": true,
  "data": {}
}
```

Errors return the existing MCP error style with a stable safe message. Upstream response bodies and PAT values are never blindly dumped into the MCP result.

Useful returned identifiers such as page ID, block ID, database ID, data-source ID, view ID, comment ID, file-upload ID, URL and trash state are preserved when present.

## Error mapping

Normalize:

- `NOT_CONFIGURED` — `NOTION_PAT` missing
- `ACCESS_DENIED` — Notion 401/403
- `NOT_FOUND` — Notion 404 or inaccessible resource
- `CONFLICT` — Notion 409
- `RATE_LIMITED` — Notion 429
- `VALIDATION` — Notion 400/406 validation/input rejection
- `UPSTREAM` — network/5xx/invalid response

Do not retry non-idempotent writes automatically. Rate-limit/upstream errors are returned to the caller unless a later endpoint-specific idempotency strategy is explicitly designed.

## Destructive behavior

The user has explicitly approved direct destructive actions without an extra confirmation layer.

Examples that may execute immediately when requested:

- trash/restore a page, block, database, or data source where Notion exposes trash state
- delete a view permanently
- delete a comment created by this Notion connection
- remove a data-source property through Notion's supported `null` property-removal form
- move supported pages/databases/data sources
- erase or replace page content through supported page update/Markdown operations

Notion's own semantics are preserved. LeileiOS does not describe a trash operation as a permanent delete, and it does not describe a permanent view deletion as restorable.

## Testing

Use TDD for each resource module.

Unit tests mock the Notion HTTP boundary and verify:

- exact method/path/version/auth headers
- no PAT leakage in results/errors
- correct JSON and multipart request shaping
- error normalization for 400/401/403/404/409/429/5xx/network failures
- destructive actions do not require a synthetic confirmation field
- no write tool can target an arbitrary external endpoint URL
- view/comment delete endpoints are represented separately from Notion trash semantics
- meeting-note creation uses only the fixed official endpoint

MCP contract tests verify:

- all eight new write tools are registered
- existing `search_notion` and `read_notion_page` remain present
- unauthenticated MCP access is rejected before Notion mutation
- action-specific schemas reject unrelated fields
- token/confirm/user-id fields are not part of the public schemas

Verification gate before production:

```bash
pnpm exec tsx --test --test-concurrency=1 <all test files>
pnpm typecheck
pnpm build
cd web && npm ci && npm run typecheck && npm run build
git diff --check
```

## Production smoke

After CI passes and production deploy succeeds, run authenticated MCP smoke tests only against disposable Notion content created specifically for verification:

1. Create a temporary page.
2. Update its title/content.
3. Append and update a block.
4. Trash and restore the temporary page/block.
5. Create a temporary database/data source/view when feasible; update them, test trash/restore where applicable, and test deletion only on a disposable non-last view.
6. Create a temporary comment, update/reply, and delete only that disposable connection-created comment.
7. Upload a tiny disposable attachment, attach its returned file-upload ID to disposable Notion content, and read back the result.
8. Create a disposable Meeting Note only if the workspace exposes the capability and a disposable supported source is available; otherwise record the upstream capability/plan block explicitly.
9. Re-read/search the temporary page to prove write/read round-trip.
10. Clean up disposable content using the appropriate Notion trash/permanent-delete semantics.

Do not use existing user pages for destructive smoke tests.

## Non-goals

- No Notion-to-LeileiOS database synchronization.
- No background polling/webhooks in this phase.
- No local replica of Notion permissions.
- No extra confirmation workflow.
- No browser-side Notion token or direct browser-to-Notion calls.
- No raw arbitrary REST passthrough.
- No promise to implement UI-only Notion features that the official API does not expose.

## Acceptance criteria

This phase is complete when:

- existing Notion global search/read remains operational;
- the eight resource-oriented write tools are available through authenticated LeileiOS MCP;
- they cover the current official Notion API write surface described above;
- destructive mutations have no LeileiOS-side confirmation requirement;
- PAT stays server-only;
- focused tests and full project verification pass;
- Railway deployment succeeds without Web regression;
- disposable end-to-end create/update/destructive/read-back smoke passes without modifying existing user content; capability-gated Meeting Note creation may be recorded as unavailable only when Notion itself rejects it for this workspace/plan.
