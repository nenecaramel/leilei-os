# Toy Duration Design

## Scope

Add a bounded `duration_seconds` option to `toy_set` without changing the
existing Toy intensity range, command TTL, stop semantics, or introducing
schedules/multi-segment plans.

The public MCP shape is:

```text
toy_set(percent, duration_seconds?)
```

`percent` remains an integer from 1 through 40. `duration_seconds` is an
integer from 1 through 1200 and defaults to 60 when omitted. The default keeps
`toy_set(percent)` backward compatible.

## Runtime semantics

The Railway `expires_at` value remains a strict 10-second command-queue TTL.
It controls whether a command may be claimed and acknowledged; it does not
represent device runtime. After the Mac Worker successfully reaches the local
API, the local Controller owns a monotonic deadline for the requested duration.
Expiry sends the existing safe stop sequence. `toy_stop` clears that deadline
under the same Controller lock before sending stop, so stop remains the highest
priority operation.

The existing fail-safe paths remain authoritative: BLE disconnect/write failure,
API failure, Worker failure, and supervisor failure all stop the device and do
not create a new runtime deadline. BLE reconnect remains bounded by the
existing backoff policy. There is no duration extension, scheduling, or
multi-segment behavior in this change.

## Wire and persistence contract

- MCP input uses `duration_seconds` for consistency with the existing public
  `idempotency_key` naming.
- Domain and database code use `durationSeconds`/`duration_seconds` as
  appropriate for their existing conventions.
- The bridge payload adds `durationSeconds` only for `set` commands.
- The local Worker accepts the new field and treats a missing field from an
  older bridge payload as 60 seconds during rollout compatibility.
- A normalized duration is part of the idempotency request hash. Reusing an
  idempotency key with a different duration remains a conflict.

The migration is additive: add nullable `duration_seconds`, backfill existing
`set` rows to 60, set the application/database default to 60 for new set rows,
and add a dedicated check for set range and stop nullability. The existing
percent check, command status checks, TTL expression, indexes, and other
schema are unchanged. No production migration is run in this task.

## Files in scope

Cloud LeileiOS:

- Toy domain types, validation, repository, Web API bridge serialization, MCP
  tool schema/output, database schema, and one additive migration.
- Existing Toy service/tool/router/migration tests plus focused duration tests.

Local Toy:

- `toy_bridge.py`, `toy_api.py`, and `toy_command_worker.py` for bounded local
  validation, deadline ownership, payload forwarding, and compatibility.
- Existing local Controller/Worker tests for deadline expiry, stop priority,
  parsing, and request forwarding.

No percent mapping or upper bound changes, no LeileiOS Phase 8/Universe files,
no production deploy, and no merge are part of this change.

## Rollback

Application rollback can safely ignore the additive column after stopping new
duration writes; existing rows remain valid because omitted duration is the
60-second compatibility value. Do not drop or rewrite the column as an
automatic rollback: first roll back application code, verify no newer clients
depend on it, take the normal database backup, and use a separately reviewed
destructive migration if removal is ever required. This branch does not run a
production migration.
