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
- Transactional cleanup of directly associated content-bearing traces and lifecycle history.

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
- The service/repository path must require the current user to be active using the existing user-state helpers.
- The target must match the current `userId`, requested `id`, and archived status.
- Missing, wrong-owner, or active targets use the existing resource-not-found semantics and must not mutate data. This avoids revealing whether another user's record exists.
- Disabled-user behavior uses the existing domain error and HTTP mapping.
- The endpoint accepts no delete payload and introduces no Web idempotency-key protocol.
- Existing archive DELETE endpoints remain unchanged.

## Transaction contract

Each delete executes in one database transaction and mirrors the existing archive/restore ownership and active-user patterns.

Resource-type mapping:

| Resource | Lifecycle type | MCP idempotency type | Extra trace cleanup |
| --- | --- | --- | --- |
| Memory | `memory` | `memory` | none |
| Diary | `diary` | `diary_entry` | matching `tool_calls` rows |
| Task | `task` | `task` | none |

The transaction must perform these steps in order:

1. Require an active user inside the transaction.
2. Read the target as an owned archived record. Use the same ownership/status/visibility constraints already used by that repository's archived lifecycle operations. If it is not eligible, return the existing not-found result with no mutation.
3. Delete `mcp_write_idempotency` rows matching the current `userId`, mapped resource type, and `resourceId`.
4. For Diary only, delete `tool_calls` rows directly linked by `resourceId = diary.id` rather than allowing the foreign key to retain a null-linked content-bearing row.
5. Delete all prior `resource_lifecycle_events` rows matching the current `userId`, mapped lifecycle resource type, and `resourceId`.
6. Delete the target row using the same `userId`, `id`, and archived-state constraint.
7. Re-read the target inside the transaction and fail the transaction if any matching resource row remains.
8. Insert exactly one content-free lifecycle tombstone for the deletion: mapped lifecycle resource type, original resource ID, action `permanent_delete`, and `WEB_USER_LIFECYCLE_CONTEXT`. Do not copy resource content into `metadata`; leave metadata absent/null.
9. Commit only if every step succeeds.

There is no schema migration: `permanent_delete` is already an allowed lifecycle action.

Purging an old `mcp_write_idempotency` row intentionally does not reserve that idempotency key forever. A later write that reuses a purged key is treated as a new write; adding permanent idempotency tombstones or new schema is outside this feature.

## Web UI contract

Apply the same behavior to archived Memory, Diary, and Task detail surfaces on desktop and mobile:
- Place `永久删除` next to the existing Restore action, visually distinct as destructive.
- First click enters local confirmation mode and displays concise irreversible-warning text for that resource type.
- Show `确认永久删除` and `取消` as separate actions.
- While the request is pending, prevent duplicate submission and show a pending label.
- On `204`, remove the item from archived client state. Close the desktop detail dialog if it is open; on mobile return to the archived list/detail parent state.
- On failure, keep the item visible and keep the user in the detail/confirmation context while using the page's existing error treatment.
- Do not add permanent-delete controls to active-record detail surfaces.
- Add only the minimal shared destructive/confirmation styling required; do not redesign these pages.

## Read-surface invariants

After a successful permanent delete:
- Direct active and archived reads cannot return the resource.
- Archived lists cannot return it.
- Global Search cannot return it.
- Export cannot contain the deleted resource content.
- Existing MCP read surfaces cannot return it because the canonical resource row no longer exists.
- There is still no MCP delete command.
- For Diary, associated `tool_calls` rows are gone so exported tool activity cannot preserve the deleted diary payload through that link.

No Search or Export redesign is required; physical deletion plus the trace cleanup above should make the existing canonical-table reads satisfy these invariants.

## Acceptance criteria

- Memory, Diary, and Task each have the exact dedicated archived permanent-delete endpoint above and return `204` only after a committed deletion.
- Missing, active, or wrong-owner IDs produce existing not-found semantics and no mutation.
- Disabled users produce existing disabled-user semantics and no mutation.
- Each successful delete removes the target, matching MCP idempotency rows, and prior lifecycle rows; Diary also removes matching `tool_calls` rows.
- Exactly one content-free `permanent_delete` lifecycle tombstone remains for the deleted resource.
- A second permanent-delete request for the same ID returns not-found semantics and performs no mutation.
- Post-delete repository/API readback confirms absence.
- Archived lists, Global Search, Export, and existing MCP reads do not expose deleted content.
- Desktop and mobile require the explicit second confirmation before any permanent-delete request is sent.
- Failed requests do not optimistically remove the item.
- Existing Memory/Diary/Task archive and restore tests remain green and their API semantics are unchanged.
- No MCP delete surface, Todo/Universe/Notion change, schema migration, or unrelated refactor is introduced.
- Root tests, root and Web typecheck/build checks, and `git diff --check` pass before PR review.
