# Web Permanent Delete — Memory / Diary / Task

Status: proposed implementation contract
Branch: `feature/web-permanent-delete-memory-diary-task-v2`

## Goal

Add irreversible deletion for archived Memory, Diary, and Task records from the Web only, without changing existing archive/restore behavior or exposing any MCP delete command.

## Scope

In scope:
- Memory, Diary, Task only.
- Web API and Web UI only.
- Owned records belonging to the current active user.
- Permanent deletion only after the record is already archived.
- Removal of the deleted resource from direct reads, archived reads, global search, export, and existing MCP read surfaces.
- Transactional cleanup of directly associated audit/idempotency traces and lifecycle history.

Out of scope:
- Todo, Universe, Notion.
- Any MCP delete tool or command.
- Changes to existing archive/restore endpoints or semantics.
- Database schema or migration changes.
- Unrelated refactors or UI redesigns.

## Product contract

Permanent delete is an archived-state action. Active records must use the existing archive flow first.

The permanent-delete control appears only on archived detail surfaces. The first click enters an explicit irreversible-confirmation state; it does not call the API. The user must click a distinct second action, `确认永久删除`, to submit. `取消` leaves confirmation mode without mutation. A one-click browser `window.confirm` is not sufficient.

A successful permanent delete removes the resource from every normal read surface. Existing archive and restore behavior remains unchanged.

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
| Diary | `diary` | `diary_entry` | `tool_calls` with the same user, `resourceType = diary_entry`, and resource ID |
| Task | `task` | `task` | none |

The transaction must perform these steps in order:

1. Call the existing in-transaction active-user guard for the current `userId`.
2. Read the target with the exact eligible selector above. If no row matches, return the existing not-found result with no mutation.
3. Delete `mcp_write_idempotency` rows matching current `userId`, the mapped MCP resource type, and the target `resourceId`.
4. For Diary only, delete `tool_calls` rows matching current `userId`, `resourceType = diary_entry`, and the target `resourceId`. Do not rely on the Diary foreign key's `ON DELETE SET NULL` behavior.
5. Delete all prior `resource_lifecycle_events` rows matching current `userId`, mapped lifecycle resource type, and target `resourceId`.
6. Delete the target with the exact eligible selector above and require exactly one deleted row; otherwise fail the transaction.
7. Re-read the target by current `userId` and `id` without a status filter and fail the transaction if any row remains.
8. Insert exactly one lifecycle tombstone with current `userId`, mapped lifecycle resource type, original resource ID, action `permanent_delete`, `WEB_USER_LIFECYCLE_CONTEXT`, and `metadata = {}`. No resource content is copied into the event.
9. Commit only if every step succeeds.

No schema migration is needed: `resource_lifecycle_events.action` already permits `permanent_delete`, and its `metadata` column already accepts an empty object.

Deleting an old `mcp_write_idempotency` row intentionally does not reserve that key forever. Reuse of a purged key in a later MCP write is a new write; permanent idempotency tombstones and schema changes are outside this feature.

## Web UI contract

Apply the same behavior to archived Memory, Diary, and Task detail surfaces on desktop and mobile:
- Place `永久删除` next to the existing Restore action and style it as destructive.
- First click enters local confirmation mode and displays concise irreversible-warning text for that resource type.
- Show `确认永久删除` and `取消` as separate actions.
- While the request is pending, prevent duplicate submission and show a pending label.
- On `204`, remove the item from archived client state. Close the desktop detail dialog if open; on mobile return to the archived list.
- On failure, keep the item visible and keep the detail/confirmation context open while using the page's existing error treatment.
- Do not add permanent-delete controls to active-record detail surfaces.
- Add only the minimal shared destructive/confirmation styling required; do not redesign these pages.

## Read-surface invariants

After a successful permanent delete:
- Direct active and archived reads cannot return the resource.
- Archived lists cannot return it.
- Global Search cannot return it.
- Export cannot contain the deleted resource content.
- Existing MCP read surfaces cannot return it because the canonical resource row no longer exists.
- There is no MCP delete command.
- For Diary, the directly linked `tool_calls` rows are gone rather than retained with a null `resourceId`.

No Search or Export redesign is part of this feature; tests prove the existing canonical-table reads satisfy these invariants after physical deletion and trace cleanup.

## Acceptance criteria

- Memory, Diary, and Task expose exactly the three dedicated endpoints above and return `204` only after committed deletion.
- Missing, active, wrong-owner, and ineligible Memory IDs produce existing not-found semantics with no mutation.
- Disabled users produce existing disabled-user semantics with no mutation.
- Each successful delete removes the target, matching MCP idempotency rows, and prior lifecycle rows; Diary also removes the precisely matched `tool_calls` rows.
- Exactly one `permanent_delete` lifecycle tombstone with `metadata = {}` remains for the deleted resource.
- A second permanent-delete request for the same ID returns existing not-found semantics and performs no mutation.
- Repository/API readback after deletion confirms the resource is absent.
- Archived lists, Global Search, Export, and existing MCP reads do not expose deleted content.
- Desktop and mobile require the explicit second confirmation before any permanent-delete request is sent.
- Failed requests do not optimistically remove the item.
- Existing Memory/Diary/Task archive and restore tests remain green and their API semantics are unchanged.
- No MCP delete surface, Todo/Universe/Notion change, schema migration, or unrelated refactor is introduced.
- Root tests, root and Web typecheck/build checks, and `git diff --check` pass before PR review.
