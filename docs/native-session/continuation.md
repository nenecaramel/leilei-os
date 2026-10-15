# Continuation-only native Session switching

This implementation changes the **daily fixed switch command**, not Claude's
native history format. It requires the matching server and local scripts.
Offline verification is not live Desktop/iPhone acceptance; do not deploy or
refresh the owner's daemon as part of preparing this change.

## User contract

- Desktop → LeileiOS binds the current native Session and exact completed
  checkpoint. Desktop history, tool records and images are not imported into
  the LeileiOS UI. Claude retains its native context when execution resumes.
- LeileiOS shows its own existing/local messages. It never erases an existing
  conversation to make an empty one. A new native Session ID (including a
  Desktop Fork before Compact) selects a new empty continuation conversation.
  An exact current Session match reuses the corresponding conversation.
- Edit/Retry of messages created after the last handoff forks at their exact
  native parent. Earlier messages are immutable. The discarded branch does
  not need to be displayed or recovered.
- LeileiOS → Desktop releases the **actual current head Session**, including a
  LeileiOS Edit/Retry fork. It does not first upload/reconstruct display history.
  Existing Desktop windows can be opened manually; a local-only fork uses the
  official `claude --desktop --resume SESSION_ID` launcher. Launcher failure
  retains the Desktop ownership fence and must not silently roll it back.
- Compact/history display is Claude's native behavior. For pre-compact history,
  retain the user's Desktop archive windows; do not delete or alter files.

## Operation after separate deployment/acceptance

Use the existing `leileios-switch.command leileios` / `desktop` selection
workflow. The picker and fixed wrapper now pass `--history-mode continuation`.
Wait for generation to finish; quit Desktop (⌘Q) before switching to LeileiOS.
The other client must remain closed while this Session is in use.

The low-level switch CLI still defaults to `complete` for backwards-compatible
explicit historical import. It is not an automatic fallback. The local wrapper's
programmatic `historyMode: 'complete'` retains its previous archive option;
**daily continuation mode never runs after-switch archival**, even if an old
`AUTO_APPLY` flag exists. This change does not disable independently scheduled
archive jobs, restore missing files, modify archive retention or move backups.

## Durable and concurrency boundaries

`nativeSessionSource.mode = continuation` records Session, checkpoint, native
file revision, independent ownership generation, cwd, owner and canonical handoff anchor in existing conversation
metadata. No fake user/assistant/checkpoint rows are inserted. No schema migration
is added. Subsequent LeileiOS messages keep their ordinary canonical checkpoints.

The authenticated Mac reader validates the current root's physical parent chain,
completed reply and trailing Stop receipts, pins file/index revision and checks
native peer release. It does not follow compact logical parents into archive
files. Only UUID ancestry metadata crosses the network; no transcript or image
bytes. Missing/corrupt/unfinished roots are refused, never repaired or inferred.

Server transactions lock the conversation and provider Session, check busy turns
(including delivery_unknown) and compacts, compare canonical head/binding revision,
and reject conflicting Session attachments. Ownership generations rotate even if no new native message was written; retries must match the recorded transition base and result, preventing delayed requests from undoing a newer handoff. Existing external-Session preservation
protects attached files from LeileiOS cleanup. Terminal/background outboxes and
pending append intents must be recovered through the daemon before handoff.
Native files are never written by the new switch path. A receipt proves only the
observed local release, not an atomic lock enforced by the official client.

The JSONL itself remains necessary for native execution. This is not a cross-Mac
restore feature, an archive extraction feature or a guarantee that Desktop will
render pre-compact messages. Old full-history imports remain available explicitly
and reject continuation bindings instead of converting/reimporting them implicitly.

## Offline verification (2026-10-16)

Node 22.23.3; Agent SDK remains 0.3.296. Fresh isolated PostgreSQL 18 database
`leileios_native_session_test` on localhost; no production configuration loaded.

- Full bridge suite: **508 PASS / 0 FAIL / 4 SKIP**. Skips are opt-in real SDK
  live cases; both live environment switches were explicitly zero.
- Isolated continuation/history/admission + internal HTTP contracts: **76 PASS /
  0 FAIL / 0 SKIP**. Includes first-send exact resume, post-handoff Edit/Retry,
  current-fork handback, immutable handoff floor, concurrent initial attachment,
  duplicate acknowledgements and stale ownership ABA retries.
- Complete production-runtime gate (offline): **848 PASS / 0 FAIL / 0 SKIP**
  across its two test processes (567 + 281); this is not production acceptance.
- Root typecheck, root build and whitespace checks passed.
- New tests were observed failing before their corresponding implementation;
  the independently reviewed ownership ABA case was also reproduced RED→GREEN.

Not run: real Claude queries, live Desktop launcher, iPhone conversation/attachment
viewing, real two-client switching or production rollout. No migration, SDK upgrade,
UI/CSS change, daemon restart or user transcript/archive write was performed.
