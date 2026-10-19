# Native Live concerns

A concern is something Claude chose to keep in mind for the current Native Live
conversation, e.g. "ask how today's interview went, in three hours, until
tomorrow night". Claude decides what to keep, edit or let go of; the backend only
stores it, times it and wakes the same session through the existing silence Wake.
It is short-term state, not Memory and not an emotion system.

## Tool

`update_concern` is registered only on the internal MCP namespace that the Mac
daemon's Claude session uses (never on the public connector). Actions:

| Action | Input | Effect |
| --- | --- | --- |
| `create` | `content`, optional `reason`, `consider_in_minutes` (≥ 5), `expires_at` (ISO with offset, ≤ 7 days) | Bind a concern to the conversation and user turn now being answered. A create with identical content in the same conversation within 10 minutes replays the existing row. |
| `update` | `concern_id`, `expected_revision`, any of `content`/`reason`/`progress`/`consider_in_minutes`/`expires_at` | Edit or move earlier/later. |
| `release` | `concern_id`, `expected_revision`, `outcome` (`resolved`/`dropped`) | End it. |
| `list` | — | Active, unexpired concerns of the current conversation. |

`update` and `release` are fenced by `expected_revision`, enforced in the `UPDATE`
predicate, so a stale turn can never overwrite a newer edit, release or expiry;
the error returns the current revision. Expiry is computed from `expires_at`;
an expired concern can no longer be edited.

## Program-owned limits

Claude cannot change these through the tool: at most 12 active concerns per user;
text ≤ 300 characters; at most 3 wakes per concern (`wake_count`, `last_woken_at`,
`woken_consider_at` are an execution record outside the model revision); at most
3 concern-only wakes per unanswered user message (receipt slots
`concern_1..3`); no concern wake within 5 minutes of a reply or 30 minutes of any
other wake in the same epoch; at most 5 concerns per wake. Released or expired
rows are pruned 7 days after they end. The local Wake switch
(`pnpm wake off`) and `NATIVE_LIVE_SILENCE_WAKE_ENABLED=false` stop concern wakes
too; storing and editing concerns keeps working.

## Scheduling

No model call, timer or polling loop is added. The silence schedule the Mac
already reads gains `concernDueAt`; the Mac's existing idle wait uses the
earliest of the fixed deadlines and `concernDueAt`. When a concern is due the Mac
fires slot `concern`; the server recomputes everything in the same serializable
transaction as the fixed wake and maps it to the next free receipt slot.

* Fixed wakes keep priority. Any wake (fixed or concern) carries every concern
  due at fire time in its prompt and marks it woken for its current consider
  time, so a concern a fixed wake already delivered never fires on its own.
  A concern that a fixed wake will reach within the cooldown gets no separate
  wake.
* A woken concern is eligible again only when Claude moves its consider time.
  This holds even when the wake later ends quiet, stale or failed: the program
  never retries a concern on its own, so a failing runtime cannot turn one
  concern into repeated wakes.
* After Mac sleep/restart at most one wake fires and carries every overdue,
  unexpired concern; expired ones are never replayed.

The wake prompt is the usual `[wake · … · no reply]` marker followed by one block
per concern with its ID, `expected_revision`, wake count, `keep until`, content,
reason and progress, plus a one-line reminder that Claude may speak, postpone or
release via `update_concern`, or output `<quiet />`. Visible replies are
persisted exactly like any other silence Wake reply; later chat continues from
them.

## Session protection

Concern wakes reuse the silence Wake preparation, receipts and execution
admission unchanged, so they inherit foreground blocking, source/epoch checks,
presentation-owner and source-revision fences. In addition a concern is only
due while:

* its conversation is the current silence source (switching sessions leaves it
  dormant; returning revives it if it has not expired);
* its origin user message is still on the current head path, or is the in-flight
  turn (a Rewind past the turn that recorded it silences it without rewriting
  Claude's row);
* the conversation has not been handed to the official client
  (`nativeSessionSource.owner` other than `leileios`).

## Rollout

Server first (migration `0110_native_live_concerns`), then a Mac daemon fresh.
An older Mac ignores `concernDueAt`, so concerns are stored but only delivered by
fixed wakes until the daemon is refreshed; an older server omits the field and
the new Mac treats it as no concern.
