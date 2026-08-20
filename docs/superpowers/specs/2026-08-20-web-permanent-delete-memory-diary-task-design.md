# Web Permanent Delete — Memory / Diary / Task

Status: approved implementation contract
Branch: `feature/web-permanent-delete-memory-diary-task-v2`

## Goal

Add irreversible deletion for archived Memory, Diary, and Task records from the Web only, without changing existing archive/restore behavior or exposing any MCP delete command.

## Scope

In scope:
- Memory, Diary, Task only.
- Web API and Web UI only.
- Owned records belonging to the current active user.
- Permanent deletion only after the record is already archived.
- Removal of the deleted business resource from direct reads, archived reads, Global Search, Export, and existing MCP read surfaces.
- Transactional cleanup of resource-scoped lifecycle history and directly associated content-bearing audit traces.
- Preservation of the generic MCP write idempotency ledger until its normal retention expiry.

Out of scope:
- Todo, Universe, Notion.
- Any MCP delete tool or command.
- Changes to existing archive/restore endpoints or semantics.
- Database schema or migration changes.
- Unrelated refactors or UI redesigns.

## Product contract

Permanent delete is an archived-state action. Active records must use the existing archive flow first.

The permanent-delete control appears only on archived detail surfaces. The initial action label is `删除` and it uses the page's existing action styling; it is not promoted into a new red/destructive visual system. The action lives in the existing archived-detail top-right action area beside Restore. On compact/mobile layouts, it follows the existing compact-action presentation.

The first click enters an explicit irreversible-confirmation state; it does not call the API. The user must click a distinct second action, `确认永久删除`, to submit. `取消` leaves confirmation mode without mutation. A one-click browser `window.confirm` is not sufficient.

A successful permanent delete removes the business resource from every normal read surface. Existing archive and restore behavior remains unchanged.

## HTTP contract

| Resource | Endpoint | Success |
| --- | --- | --- |
| Memory | `DELETE /api/v1/memory/archived/:id/permanent` | `204 No Content` |
| Diary | `DELETE /api/v1/diary/archived/:id/permanent` | `204 No Content` |
| Task | `DELETE /api/v1/task/archived/:id/permanent` | `204 No Content` |

Rules:
- Authentication continues to use the existing Web API middleware.
- The service/repository path requires the current user to be active using the existing user-state helpers.
- Eligible Memory selector: `id`, current `userId`, `status = archived`, `visibility = assistant`.
- Eligible Diary selector: `id`, current `userId`, `status = archived`.
- Eligible Task selector: `id`, current `userId`, `lifecycleStatus = archived`.
- Missing, wrong-owner, active, and non-assistant Memory targets use the existing resource-not-found semantics and must not mutate data. This avoids revealing whether another user's record exists.
- Disabled-user behavior uses the existing domain error and HTTP mapping.
- The endpoint accepts no delete payload and introduces no Web idempotency-key protocol.
- Existing archive DELETE endpoints remain unchanged.

## Transaction contract

Each delete executes in one database transaction and mirrors the existing archive/restore active-user and ownership patterns.

| Resource | Lifecycle type | MCP idempotency type | Extra audit cleanup |
| --- | --- | --- | --- |
| Memory | `memory` | `memory` | none |
| Diary | `diary` | `diary_entry` | delete directly linked `tool_calls` rows |
| Task | `task` | `task` | none |

The transaction must perform these steps in order:

1. Call the existing in-transaction active-user guard for the current `userId`.
2. Read the target with the exact eligible selector above. If no row matches, return the existing not-found result with no mutation.
3. Preserve all matching rows in `mcp_write_idempotency`. Permanent deletion must not release an old MCP idempotency key; the ledger remains until its normal retention expiry.
4. For Diary only, delete `tool_calls` rows matching current `userId`, `resourceType = diary_entry`, and the target `resourceId`. `tool_calls.request_summary` and `result_summary` are JSON audit payloads that can carry resource-linked information, so do not rely on the Diary foreign key's `ON DELETE SET NULL` behavior.
5. Delete all prior `resource_lifecycle_events` rows matching current `userId`, mapped lifecycle resource type, and target `resourceId`.
6. Delete the target with the exact eligible selector above and require exactly one deleted row; otherwise fail the transaction.
7. Re-read the target by current `userId` and `id` without a status filter and fail the transaction if any row remains.
8. Insert exactly one lifecycle tombstone with current `userId`, mapped lifecycle resource type, original resource ID, action `permanent_delete`, `WEB_USER_LIFECYCLE_CONTEXT`, and `metadata = {}`. No title, content, tags, or other resource payload is copied into the event.
9. Commit only if every step succeeds.

No schema migration is needed: `resource_lifecycle_events.action` already permits `permanent_delete`, its `resourceId` is not an FK to the business row, and its `metadata` column accepts an empty object.

### MCP idempotency invariant

The generic `mcp_write_idempotency` row is deliberately retained after permanent deletion. A retry of an old MCP create/write request must not silently recreate the deleted resource. Existing replay behavior should continue to treat a retained ledger that points to a missing resource as a non-recreatable replay/error condition. This feature does not add MCP permanent-delete behavior or change idempotency retention policy.

Diary's native `diary_entries.idempotency_key` and `request_hash` disappear with the Diary business row itself; that does not change the rule above for the generic MCP ledger.

## Web UI contract

Apply the same behavior to archived Memory, Diary, and Task detail surfaces on desktop and mobile:
- Add `删除` beside the existing Restore action in the existing archived-detail top-right action area.
- Reuse the existing action styling; do not introduce a new destructive color/treatment for the first action.
- First click enters local confirmation mode and displays concise irreversible-warning text for that resource type.
- Show `确认永久删除` and `取消` as separate actions.
- While the request is pending, prevent duplicate submission and show a pending label consistent with the page's current action language.
- Treat `204 No Content` as a successful response without attempting to parse a JSON body.
- On `204`, remove the item from archived client state. Close the desktop detail dialog if open; on mobile return to the archived list.
- On failure, keep the item visible and keep the detail/confirmation context open while using the page's existing error treatment.
- Do not add permanent-delete controls to active-record detail surfaces.
- Do not redesign these pages or add unrelated styles.

## Read-surface invariants

After a successful permanent delete:
- Direct active and archived reads cannot return the business resource.
- Archived lists cannot return it.
- Global Search cannot return it.
- Business-resource Export cannot contain the deleted resource content.
- Existing MCP read surfaces cannot return it because the canonical resource row no longer exists.
- There is no MCP delete command.
- The generic MCP write idempotency ledger remains until normal expiry and is not exposed as deleted business content.
- Exactly one content-free `permanent_delete` lifecycle tombstone remains; lifecycle-audit export may therefore still expose that minimal audit event by design.
- For Diary, directly linked `tool_calls` rows are deleted rather than retained with a null `resourceId`.

No Search or Export redesign is part of this feature; tests prove the existing canonical-table reads satisfy these invariants after physical deletion and trace cleanup.

## Acceptance criteria

- Memory, Diary, and Task expose exactly the three dedicated endpoints above and return `204` only after committed deletion.
- Missing, active, wrong-owner, and ineligible Memory IDs produce existing not-found semantics with no mutation.
- Disabled users produce existing disabled-user semantics with no mutation.
- Each successful delete removes the target and prior resource lifecycle rows while preserving matching generic MCP write idempotency rows; Diary also removes precisely matched `tool_calls` rows.
- Exactly one `permanent_delete` lifecycle tombstone with `metadata = {}` remains for the deleted resource and contains no business content.
- A second permanent-delete request for the same ID returns existing not-found semantics and performs no mutation.
- Repository/API readback after deletion confirms the resource is absent.
- Archived lists, Global Search, business-resource Export, and existing MCP reads do not expose deleted content.
- Retrying an old MCP write key after permanent deletion does not recreate the deleted resource.
- Desktop and mobile require the explicit second confirmation before any permanent-delete request is sent.
- Frontend success handling accepts an empty `204` response body.
- Failed requests do not optimistically remove the item.
- Existing Memory/Diary/Task archive and restore tests remain green and their API semantics are unchanged.
- No MCP delete surface, Todo/Universe/Notion change, schema migration, or unrelated refactor is introduced.
- Root tests, root and Web typecheck/build checks, and `git diff --check` pass before PR review.
