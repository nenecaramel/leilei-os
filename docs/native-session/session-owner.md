# Native Session owner row (design, 2026-10-20)

Status: PRs 1 and 2a are merged. PR 2b implements the generation-reader
transition; later owner/slot consolidation remains planned. This implements consolidation candidate 2 from
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

It **rotates** at the first moment a foreground turn can have changed the
native session file, and once more when a turn that starts a new line commits:

1. **Input started.** The persistent writer's input binding moves to `started`
   (`native-live-input-binding.ts`). From then on the SDK has the user input,
   whether or not the turn later commits.
2. **First runtime events** of a non-Wake turn whose binding has not started.
   This covers the one-shot path, which has no binding
   (`native-live-runtime-event-stream.ts`).
3. **Commit of a non-resume foreground turn:**
   `operation <> 'wake' AND runtime_mode <> 'resume'`. In practice this is edit
   and retry (always `fork`), and a send that starts `new` or forks from a
   bootstrap. Wake prepares with `runtime_mode = 'fork'`
   (`native-live-silence-wake.ts:445`), but it is pinned to the same session, so
   it is excluded by operation, not by mode.

It **does not rotate** on:

- prepare;
- rejection, failure or supersede of a turn **whose input never started**;
- a visible Wake;
- a background commit.

Owner changes are already covered by `owner_revision`.

Rules 1 and 2 are the exact proof that `reconcileRejectedWakePresentationOwner`
reconstructs today: the rejected send's binding never started, and it left no
runtime events (`bg-repo:177-183`). Rotating at prepare (today's slot) was too
early, because it also staled rejected turns that never touched the file
(F12, F13). Rotating only at commit would be too late, because a started turn
that failed has already appended its input.

Background output made while F is pending or running still goes through the
existing `executionStart`/`deferred` pending-owner exceptions. Those exceptions
are about the turn slot, and they stay. Once F starts, earlier output is stale
by rule 1, as it is today.

What this removes (PR 2b):

- F12 / F13: a rejected send that never started no longer changes the
  generation, so Wake→Cron receipts keep matching.
  `reconcileRejectedWakePresentationOwner` and its lineage walk are deleted.
- The background append's slot-equality requirement
  (`native-live-background-message.ts:76`). It is replaced by the same
  generation, plus "no live foreground turn". Today's repair rewrites the slot
  for exactly this reason.

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
| `begin_release` leileios→releasing | Same head and revision CAS as `changeOwner` today. No in-flight turn and no pending compaction (`cont-repo:89-94`). No queued receipt, or prepared receipt whose `expiresAt` is still in the future (S9, unhandled transition 5). |
| `complete_release` releasing→desktop | `owner_revision` equals the value written by `begin_release`. Head unchanged. Completed checkpoint check as today (`cont-repo:107`). |
| `cancel_release` releasing→leileios | `owner_revision` equals the `begin_release` value. Idempotent. |
| `attach` desktop\|releasing\|leileios→leileios | As today (`changeOwner(...,'leileios')`). |

The legacy full-history restore/release writers refuse while the row owner is
`releasing`; they cannot bypass a switch in progress. Owner/revision mirroring
preserves `releasing` and never changes the turn slot or writer generation.

**Execution guard.** Only `owner = 'leileios'` may prepare, admit, renew, bind
input, commit background output or run Wake. One SQL helper reads the row and
replaces the 15 `coalesce` copies:
`nativeSessionExecutableSql(conversationAlias)`. A missing row means the
conversation was never bound. Prepare and attach create the row (upsert under
the conversation lock), so every other reader can join it strictly.

**Prepare refusal codes.**

- `desktop`: `SESSION_OWNED_BY_DESKTOP` (already exists).
- `releasing`: `NATIVE_SESSION_SWITCHING` (new).

Both codes map to HTTP 409 for new preparations and create no turn. A retained,
exactly matching request may replay its original idempotent result; begin has
already excluded every live/staged dispatch, enqueue cannot revive a non-staged
record, and admission still refuses execution. This does not authorize a new
turn while releasing. iOS currently shows its generic
failure text; a dedicated switching string is a separate follow-up.

### New switch-out order

The server's `releasing` owner is the primary fence. The Mac `handoff` suspend
remains a second line of defence: it prevents a fresh SDK child opening the native
file before admission. This PR changes the CLI's management of that fence, not
the daemon.

1. Read `continuation-state`, call `continuation-release-begin` with the current
   session/head/revision, and retain the returned revision R1. Begin needs no
   native evidence. Existing in-flight turns/compaction and unsettled background
   receipts return BUSY before ownership changes.
2. Pin the source, drain the daemon (keeping `handoff`), settle, run the recovery
   gate, and perform existing preflight/native evidence validation.
3. Call the existing `continuation-release` with `expectedRevision: R1`, then
   launch Desktop. Full checkpoint/cwd/ancestry validation is unchanged. A direct
   `leileios → desktop` release remains supported for one legacy CLI release.
4. On any error after a confirmed begin, call `continuation-release-cancel` and
   then `requestNativeSessionResume`, in that order. Preserve the original code;
   print any cancel/resume failure as a separate sanitized code. Cancel rotates
   R1 back to a new LeileiOS revision and is idempotent for that R1.
5. Begin/cancel use the existing bounded short-request retries. If begin's
   successful response is lost and all retries fail, the CLI cannot guess R1.
   A crashed CLI or failed cancel can leave durable `releasing`. Recover with
   `leileios-switch.command leileios` (attach). There is no new `--cancel` CLI
   flag. If Desktop launch fails **after complete succeeded**, cancel cannot
   undo Desktop ownership; manual attach is the recovery path in that case too.

Success keeps the local handoff fence while Desktop owns the session. A successful
attach still calls resume; failure cleanup calls cancel before resume. No daemon
restart is required. While releasing, a due silence Wake returns the existing
`ignored/source_changed` shape without inserting a preparation or receipt, so it
cannot strand complete/retry/attach behind newly pending work. Its conversation
lock serializes this decision with begin-release; no new Mac wire code is needed.

Valid current-head quiet cursors survive begin/cancel owner-revision changes.
The transaction rebinds only a tail that already passes all session/base/cwd/head,
revision and writer-generation checks. Administrative continuation reads may read
such a verified tail while releasing; execution readers retain the strict owner
fence. Old checkpoint generation stamps and background receipts are never
rebound. An at-anchor continuation adopts a resolved tail only when its canonical
session/base checkpoint/cwd match the binding, preserving the replacement floor.

Deployment: server endpoints first, then the owner fast-forwards the canonical
checkout used by the switch command. No migration or daemon refresh. The owner
performs Desktop ⇄ LeileiOS, Edit/Retry, fork/compact, a forced post-begin failure,
and a phone send during switching acceptance after review/merge authorization.

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
- PRs 1–3 are server-only. PR 4 changes the switch CLI but not the daemon;
  the daemon does not need a restart.

## PR plan

Each PR is RED→GREEN against the isolated DB (`leileios_native_session_test`)
and runs `pnpm agent:verify --run`.

| PR | Scope | Behavior change | Deploy / refresh |
| --- | --- | --- | --- |
| 1 | Migration and backfill. Schema in `src/database/schema`. A `native-live-session-owner.ts` repository: `ensure`, `setTurn`, `advanceAnchor`, `rotateGeneration`, `changeOwner`. Dual write at every presentation-owner and `nativeSessionSource.owner/revision` writer. `writer_generation` stamps added next to `presentation_owner_id`. **No reader changes.** | None (the row is shadow state). The tests assert that the row and the JSON agree after each operation, and that a rejected prepare leaves `writer_generation` unchanged. | Server only. Migration: needs go-ahead. |
| 2a | Rotate `writer_generation` when input starts (binding `started`) and on a non-Wake turn's first runtime events. | None (nothing reads the generation yet). RED: queued input keeps the generation; started input rotates it once; one-shot first events rotate it once. | Server only. |
| 2b | Generation readers move to the row: background snapshot and append, resume tail (`native-live-resume-checkpoint.ts`), Wake admission branch, finalize Wake check. Delete `reconcileRejectedWakePresentationOwner`. | F12/F13 class fixed at the root. RED: a rejected unstarted send after Wake, then Cron B is accepted *without* the repair path. A started send stales B. An edit commit stales old-writer B. | Server only. |
| 3 | `nativeSessionExecutable()` helper replaces the 15 owner predicates. Turn-slot readers (admission, input binding, finalize success/failure, `reads.ts`) move to the row. The presentation-owner JSON is no longer written. | None intended. RED: a conversation with `owner='releasing'` is refused by prepare, admission, renewal, input binding, background and Wake. | Server only. |
| 4 | `begin/complete/cancel_release` routes and the new switch-out order in `native-session-continuation.mjs`. S9 receipts in the busy check. `NATIVE_SESSION_SWITCHING`. The Mac handoff fence and resume remain; CLI failure cleanup cancels then resumes. | Fixes unhandled transitions 1, 2 and 5. | Server first, then owner fast-forward for the CLI; no daemon restart. Acceptance: Codex steps 1–4, plus a release killed mid-way, plus a send during switching. |
| 5 | Cleanup: retire the legacy direct release and remove `nativeSessionSource.owner/revision` JSON copies once readers no longer use them. Leave historical keys in place (no bulk rewrite). Removing the Mac handoff/resume belt requires a separate approved design; it is not implied by PR 4. | None. | Daemon `:fresh`. |

iOS: `NATIVE_SESSION_SWITCHING` needs a user-facing string. Until iOS ships it,
the generic failure text appears; that is safe and does not lose input.

## PR 2b reader scope

Generation equality reads `native_live_session_owners.writer_generation`, with
`coalesce(stamp.writer_generation, stamp.presentation_owner_id)` for historical
stamps. Background receipts retain an optional `context.writerGeneration`;
renewal and normal submission compare the immutable canonical binding and native
generation, allowing a rejected/unstarted turn to change only the presentation
slot. Legacy receipts without that field still require the checkpoint stamp to
match the row. No slot is rewritten to the old producer.

The independent quiet-Wake cursor entry point also checks this generation before
writing. Its queued-send retarget and all turn-slot rules remain unchanged.
Visible Wake admission/finalization still requires the current user epoch: a real
new user message invalidates the old Wake, even if its send is later rejected.
The slot-only regression uses an unstarted retry in the same epoch, rather than
relaxing that isolation rule.

`reconcileRejectedWakePresentationOwner` is removed. The separate historical
`reconcileLegacyVisibleWakeAnchor` remains. This is server-only, with no migration,
Mac daemon refresh, ownership transition or production DB operation.

## PR 3a execution-owner reader scope

Execution readers use `nativeSessionExecutableSql` or `readNativeSessionOwner`
from `turn-repository/session-owner.ts`. The owner row is authoritative even if
`nativeSessionSource.owner` disagrees. In PR 3a, both `desktop` and `releasing` took the
existing desktop/busy refusal paths. PR 4 adds `NATIVE_SESSION_SWITCHING` for
releasing prepare requests.

A missing row remains executable as `leileios`: a newly created conversation
gets its row at first prepare. The conversation locks, user/session fences,
writer-generation checks and turn-slot readers are unchanged. The continuation
and history writers still write JSON and mirror it into the row, and the switch
CLI still reports the JSON owner. Turn-slot migration belongs to PR 3b.

This is server-only: no migration, daemon refresh or production DB operation.

## PR 3b turn-slot reader/writer scope

`native_live_session_owners.turn_prepare_id` and `turn_anchor_message_id` are
now the authoritative turn slot. Prepare removes the stale
`native_live_presentation_owner` JSON key and sets the row turn to its prepare
ID and the current head. It preserves an existing writer generation and owner.
Missing rows or a NULL prepare ID mean no slot; failure finalization retains its
no-slot recovery compatibility path.

`setNativeSessionTurn` performs the prepare upsert. All anchor advances use
`advanceNativeSessionTurnAnchor` under the existing conversation lock and
transaction, checking prepare ID, expected anchor and new canonical head.
Foreground, visible Wake, background append and the narrowly scoped historical
Wake repair retain their prior eligibility checks. Finalize never clears a slot;
Wake advances the inherited slot without replacing its prepare ID.

Switch writers still mirror owner/revision from JSON, but that mirroring never
touches the turn columns. Receipt and checkpoint `presentation_owner_id` stamps
remain for compatibility, taking their value from the row. There is no JSON-slot
fallback, migration, daemon refresh or Mac wire change. Existing JSON keys vanish
only at next prepare; there is no bulk rewrite. Release lifecycle changes remain
in PR 4.

## Open questions (resolved in the PR that touches them)

- **Manual compaction.** Should committing a compaction rotate
  `writer_generation`? It keeps the same session id, so the current design says
  no. Verify against the compaction checkpoint in PR 2.
- **Deferred B and edit/retry** (unhandled transition 6). Does the generation
  rotation at edit commit correctly stale deferred B from the retired writer?
  PR 2 adds the test.
- **Cron across daemon restart** (unhandled transition 3) is out of scope. It
  belongs to the Mac recovery consolidation.
