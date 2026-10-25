# Durable background replies in the existing conversation

Status: design for replacing draft PR #1129; implementation and acceptance pending.

## Agreed outcome

Foreground chat remains usable. Autonomous Claude replies enter the same
conversation as new assistant messages in safe commit order, survive reopening
and operational retention, and are included in the native context inherited by
later chat. No fabricated user message, historical transcript reconstruction,
new scheduler, new chat store, or replacement UI.

## Findings in the draft

The overlay reads operational receipts whose parent preparations expire after
30 days. It leaves the canonical head unchanged, sorts visible bubbles by a
timestamp, and does not coordinate foreground publication. It cannot establish
the outcome above. Real isolated PostgreSQL execution also exposed an untested
timestamp decoding error in `visibleBackgroundResult`.

The current background submit requires the originating foreground assistant to
remain the canonical head and rejects pending foreground work. Merely inserting
a message there would break repeated autonomous replies and ordinary send races.
Removing those predicates alone would be unsafe.

## Recommended change

### Reuse the canonical message transaction

Use the existing wake-style assistant-to-assistant append, canonical event
normalizer, content blocks, provider checkpoints, and current-head update.
Append and checkpoint binding must commit atomically under the conversation
lock. Existing messages and their original blocks remain unchanged. Normal
current-path pagination, head notifications, and existing iOS rows display the
reply. Remove the draft's receipt overlay, special bubbles, timestamp ordering,
and extra periodic full-history refresh.

Store receipt identity and immutable result hash with the resulting durable
checkpoint. Check that identity before requiring an operational preparation or
receipt, so a lost response remains idempotent after operational cleanup. An
identical retry cannot append again; a changed payload conflicts. Silent
background activity advances only the native continuation cursor, without
manufacturing an empty visible reply.

### Separate queued output from published output

Keep the existing Mac outbox as transport durability. Persist background output
and its exact generation/session, producer checkpoint, and SDK segment order
before acknowledging it as **queued**. Queued is not canonical commit success.
Queue acknowledgement must release the SDK input barrier; it must not falsely
advance the backend's confirmed continuation or delete the outbox entry.

If no foreground work has intervened, drain into the canonical ledger normally.
If foreground is pending/reserved/executing, preserve its accepted user parent
and immutable command. Let it finish, then publish queued background replies
after that committed foreground reply. Do not silently reparent an accepted
user message or reexecute either model input.

Example: canonical history is H; background segment B finishes while foreground
U/F is pending. Publish H → U → F → B. This is safe commit order; client clocks
and the timer's originally requested time do not decide message order.

### Keep native continuation monotonic

Producer checkpoint B is provenance, not necessarily the latest continuation.
If native F already descends from B, verify that ancestry using existing native
checkpoint verification and bind published B to continuation F. Keep producer B
as separate metadata. Never roll continuation back from F to B.

If B instead follows F natively, verify F → B before advancing. No timestamp or
text matching can substitute for checkpoint evidence. Later foreground admission
must distinguish canonical parent from locally queued native advancement and
revalidate the exact live writer generation before dispatch.

Source preparation is provenance. Publication requires its surviving branch,
same session and working directory, live listener, and current ownership/source
revision. Edit, Retry, Rewind, fork, clear, and Desktop handoff retain their
fences. An ordinary same-session send alone must not discard valid queued output.

### Failure policy

If foreground fails or native ancestry cannot establish a safe continuation,
retain queued output, fence/retire the uncertain writer, and expose failure or
unknown status. Do not drop evidence, invent a checkpoint, or retry model work.
Recovery must respect persisted segment order and dependencies; existing hashed
filenames are not an ordering contract. Lost HTTP responses replay the exact
receipt, not the native task. New execution stays fenced until uncertainty is
resolved. No production backfill or migration is implied by this change.

## Required behavior tests

- A real background write adds a canonical assistant/head/checkpoint; reopening,
  delta reads, older pagination and existing row rendering show it once.
- After operational preparation/event deletion, content, continuation and
  committed-receipt replay remain valid.
- Multiple background results preserve transaction order without row-identity
  collision, and a later send resumes the latest covering checkpoint.
- Deferred barriers overlap background delivery with foreground preparation,
  active generation and success finalization in both orders. No deadlock,
  sibling branch, guessed user reparent, duplicate execution or cursor rollback.
- Foreground failure, lost submission response and process restart retain
  ordered recovery evidence and never claim an unverified commit.
- Stale branch, foreign user/session, expired listener and Desktop ownership
  refuse publication. Duplicate submissions append at most once.
- Actual Swift presentation and Xcode build exercise consecutive assistant
  messages using existing Original/iMessage rendering, with no special UI.

Run Node 22 targeted behavior tests and isolated PostgreSQL integration, root
typecheck/build, production runtime gate, bridge tests, and applicable iOS tests
and simulator build. No real model calls or production writes. Real device
acceptance, server rollout and daemon refresh remain separate from local proof.

## Review boundary

This changes the meaning of background acknowledgement and canonical publication,
not just presentation. Review this design before implementation. Draft #1129
must remain unmerged until the resulting full delivery path is implemented and
verified. Current tests and a successful CronCreate are not live acceptance.
