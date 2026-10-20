# Native Session owner row (design, 2026-10-20)

Status: proposed. It implements consolidation candidate 2 from
[state-audit.md](state-audit.md). It does not change candidate 1 (the route table)
or candidate 3 (the cursor function). It leaves room for both.

## Problem

`conversations.provider_metadata.native_live_presentation_owner`
(`{prepareId, anchorHeadMessageId}`) does three unrelated jobs:

1. **Turn slot.** It records which preparation owns the visible reply. A newer
   prepare replaces it (`prepare.ts:709-718`).
2. **Head anchor.** It records the canonical head at the moment of prepare.
   Admission, input binding and finalize compare it with
   `current_head_message_id`.
3. **Writer generation.** Checkpoints, resume tails, Wake contexts and background
   receipts are stamped with `presentation_owner_id`. A background result is
   accepted only while that stamp still equals the current `prepareId`
   (`native-live-background-result-repository.ts:221-236`).

Job 3 rotates on every prepare, including one that is later rejected. That one
fact caused F10, F12 and F13. It also produced the 100-line repair function
`reconcileRejectedWakePresentationOwner` (`bg-repo:57-196`) and the
`pendingOwner` exceptions (`bg-repo:209-218`, `wake-resume-cursor.ts:76-98`).

Ownership between Desktop and LeileiOS is split the same way:

- The server keeps `nativeSessionSource.owner`. It is read through 15
  copy-pasted `coalesce(...,'leileios')` predicates.
- The Mac keeps an in-memory `handoff` fence (`executor:35-49`). It is lost on
  restart and leaks when a release fails after the drain (unhandled transition 1).
  The server cannot see it, so it accepts sends the Mac will refuse (unhandled
  transition 2, which was F3).

## Decision

Add one durable server row per native conversation that holds all of it. Each
fact gets its own column, so changing one fact cannot move another.

```sql
CREATE TABLE native_live_session_owners (
  conversation_id   uuid PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Who may execute this native Session.
  owner             varchar(16) NOT NULL DEFAULT 'leileios'
                    CHECK (owner IN ('leileios', 'releasing', 'desktop')),
  -- Ownership generation (today nativeSessionSource.revision). It rotates on
  -- every owner transition, so a delayed request from an older owner fails.
  owner_revision    text,
  -- Native line identity. It rotates only when the line diverges (see below),
  -- never on prepare.
  writer_generation uuid NOT NULL,
  -- Turn slot, which takes over the old presentation-owner jobs 1 and 2 unchanged.
  turn_prepare_id   uuid,
  turn_anchor_message_id uuid,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
```

`nativeSessionSource` stays the place for binding details: session, checkpoint,
native revision, cwd, handoff anchor and lineage. The row does not copy them. Its
`owner` and `revision` are written in the same transaction as the row until the
cleanup PR removes the JSON copies.

### Writer generation

`writer_generation` answers one question: does output from the SDK writer still
belong to the native line at the canonical head?

It **rotates** when a turn commits whose native line is not a resume of the head:

- `operation IN ('edit', 'retry')`, or
- `runtime_mode IN ('new', 'fork')`.

It **does not rotate** on:

- prepare;
- rejection, failure or supersede of a prepared turn;
- an ordinary `send`/`resume` commit;
- a visible Wake;
- a background commit.

Owner changes are already covered by `owner_revision`.

Why the head check is enough for ordinary sends: a background result made against
head H is stale as soon as the head moves past H. That is the existing `head = cp`
condition (`bg-repo:233`), plus the covering path for deferred B. The generation
no longer needs to change for that.

What this removes:

- F12 / F13: a rejected send no longer changes the generation, so Wake→Cron
  receipts keep matching. `reconcileRejectedWakePresentationOwner` and its
  lineage walk are deleted.
- The pending-owner OR branch in the snapshot generation check
  (`bg-repo:236`). The generation is unchanged while F is pending. The *busy*
  exceptions for executionStart/deferred B stay; they are about the turn slot,
  not the generation.

### Turn slot

`turn_prepare_id` and `turn_anchor_message_id` keep today's semantics exactly:

- They are set on prepare (`prepare.ts:709-718`).
- The anchor advances on the slot owner's commit, on a visible Wake commit and
  on a background commit (`finalize-success.ts:396-421`,
  `native-live-background-message.ts:70-79`).

This design only moves them. Clearing the slot on finalize, or refusing a
second foreground instead of superseding it (unhandled transition 4), are
separate decisions. Today's failure purge (`finalize-failure.ts:154-157`)
depends on the slot never being empty.

### Owner state machine

```
                attach (rotate rev)
   desktop ───────────────────────────► leileios
      ▲                                  │   ▲
      │ complete_release (rotate rev)    │   │ cancel_release / attach (rotate rev)
      │                                  ▼   │
      └──────────────────────────────── releasing
                       begin_release (rotate rev)
```

| Transition | Guard (inside one transaction, conversation row locked) |
| --- | --- |
| `begin_release` leileios→releasing | Same head and revision CAS as `changeOwner` today. No in-flight turn and no pending compaction (`cont-repo:89-94`). **New:** no `prepared`/`queued` background receipt (S9, unhandled transition 5). |
| `complete_release` releasing→desktop | `owner_revision` equals the value written by `begin_release`. Head unchanged. Completed checkpoint check as today (`cont-repo:107`). |
| `cancel_release` releasing→leileios | `owner_revision` equals the `begin_release` value. Idempotent. |
| `attach` desktop\|releasing\|leileios→leileios | As today (`changeOwner(...,'leileios')`). |

The legacy complete-history path (`history-repo:369-370,494-495`) writes the row
through the same helper, so it rotates the revision too (unhandled transition 7).

**Execution guard.** Only `owner = 'leileios'` may prepare, admit, renew, bind
input, commit background output or run Wake. One SQL helper reads the row and
replaces the 15 `coalesce` copies:
`nativeSessionExecutable(conversationAlias)`. A missing row means the
conversation was never bound. Prepare and attach create the row (upsert under
the conversation lock), so every other reader can join it strictly.

**Prepare refusal codes.**

- `desktop`: `SESSION_OWNED_BY_DESKTOP` (already exists).
- `releasing`: `NATIVE_SESSION_SWITCHING` (new).

iOS shows both as "this conversation is on Desktop / switching" and does not
start a turn.

### New switch-out order

Today the order is drain → settle → release. The Mac drain sets the fence, and
the server learns about it only at release.

New order:

1. `begin_release`. From this moment the server refuses new prepares, admissions
   and lease renewals for this conversation. A running turn keeps
   `NATIVE_CONVERSATION_BUSY` as today, and nothing is fenced.
2. Mac drain. It stops the writer and native Cron and waits for the outbox. It
   **no longer sets a `handoff` fence**: admission already refuses everything,
   because the owner is not `leileios`.
3. Settle and preflight of the native file (#1112, unchanged).
4. `complete_release`, then launch Desktop.
5. Any failure after step 1: the switch script calls `cancel_release` before it
   exits. If the script itself dies, the owner stays `releasing`. That state is
   durable and visible: iOS shows "switching". Running
   `leileios-switch.command leileios` (attach) recovers it, and so does a new
   `--cancel` flag. A daemon restart no longer silently changes ownership.

Switch-in (attach) no longer needs the `resume` socket call (#1114): there is
no Mac fence left to lift. The socket keeps answering `resume` as a no-op for one
release, so an older switch script still works.

## Compatibility and migration

- **Backfill** (in the migration): one row per `native_live` conversation.
  - `owner` = `coalesce(nativeSessionSource.owner,'leileios')`.
  - `owner_revision` = `nativeSessionSource.revision`.
  - `turn_*` = the current presentation-owner JSON.
  - `writer_generation` = the current `prepareId` when it is a UUID, otherwise
    `gen_random_uuid()`. Existing stamps that are valid today
    (`presentation_owner_id` = current `prepareId`) therefore stay valid. Stamps
    that are stale today stay stale.
- **Stamps.** New stamps carry both `writer_generation` and
  `presentation_owner_id` (the slot at stamp time; Wake retargeting still needs
  it). Readers compare
  `coalesce(stamp->>'writer_generation', stamp->>'presentation_owner_id')` with
  the row. The receipt kind stays `persistent_background_receipt_v1`; the
  context gains an optional `writerGeneration`.
- **Merging any PR with a migration runs it in production**: Railway runs
  `preDeployCommand: node dist/database/migrate.js`. That needs the owner's
  explicit go-ahead at merge time.
- No Mac change until PR 4. PRs 1–3 are server-only, and the daemon does not
  need a restart.

## PR plan

Each PR is RED→GREEN against the isolated DB (`leileios_native_session_test`)
and runs `pnpm agent:verify --run`.

| PR | Scope | Behavior change | Deploy / refresh |
| --- | --- | --- | --- |
| 1 | Migration and backfill. Schema in `src/database/schema`. A `native-live-session-owner.ts` repository: `ensure`, `setTurn`, `advanceAnchor`, `rotateGeneration`, `changeOwner`. Dual write at every presentation-owner and `nativeSessionSource.owner/revision` writer. `writer_generation` stamps added next to `presentation_owner_id`. **No reader changes.** | None (the row is shadow state). The tests assert that the row and the JSON agree after each operation, and that a rejected prepare leaves `writer_generation` unchanged. | Server only. Migration: needs go-ahead. |
| 2 | Generation readers move to the row: background snapshot and submit, resume tail (`native-live-resume-checkpoint.ts`), Wake admission branch, Wake cursor, silence-Wake source, finalize Wake check. Delete `reconcileRejectedWakePresentationOwner` and the generation half of `pendingOwner`. | F12/F13 class fixed at the root. RED: a rejected send after Wake, then Cron B is accepted *without* the repair path. A send rejected without Wake, then B is accepted. Edit commit, then old-writer B is stale. | Server only. |
| 3 | `nativeSessionExecutable()` helper replaces the 15 owner predicates. Turn-slot readers (admission, input binding, finalize success/failure, `reads.ts`) move to the row. The presentation-owner JSON is no longer written. | None intended. RED: a conversation with `owner='releasing'` is refused by prepare, admission, renewal, input binding, background and Wake. | Server only. |
| 4 | `begin/complete/cancel_release` routes and the new switch-out order in `native-session-continuation.mjs`. S9 receipts in the busy check. `NATIVE_SESSION_SWITCHING`. The Mac drain stops setting `handoff`; `resume` becomes a no-op. | Fixes unhandled transitions 1, 2 and 5. | Server, then daemon `:fresh`. Acceptance: Codex steps 1–4, plus a release killed mid-way, plus a send during switching. |
| 5 | Cleanup: delete the M1 `handoff` reason and the `resume` socket action. Remove the `nativeSessionSource.owner/revision` JSON copies once readers no longer use them. Leave the old JSON keys in place (no data rewrite). | None. | Daemon `:fresh`. |

iOS: `NATIVE_SESSION_SWITCHING` needs a user-facing string. Until iOS ships it,
the generic failure text appears; that is safe and does not lose input.

## Open questions (resolved in the PR that touches them)

- **Manual compaction.** Should committing a compaction rotate
  `writer_generation`? It keeps the same session id, so the current design says
  no. Verify against the compaction checkpoint in PR 2.
- **Deferred B and edit/retry** (unhandled transition 6). Does the generation
  rotation at edit commit correctly stale deferred B from the retired writer?
  PR 2 adds the test.
- **Cron across daemon restart** (unhandled transition 3) is out of scope. It
  belongs to the Mac recovery consolidation.
