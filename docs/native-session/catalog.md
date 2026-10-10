# Native session catalog (stage 1)

The catalog reads Claude Code JSONL files without importing the SDK, starting a
provider, opening Desktop, or writing session files. It is not a handoff command.

```sh
node tools/claude-bridge/scripts/native-session-catalog.mjs
node tools/claude-bridge/scripts/native-session-catalog.mjs --projects-dir /path/to/projects
```

The default root is `CLAUDE_CONFIG_DIR/projects`, or `~/.claude/projects`.
Output contains file identities, a SHA-256 snapshot revision, embedded session
IDs, working directories, record counts and **candidate** checkpoint leaves.
It deliberately omits titles, prompts, message bodies, tool outputs and images.
The CLI exits 2 when an individual transcript cannot be read safely, and 1 for
invalid arguments or an unavailable catalog root. Diagnostic-only ancestry
problems must also be checked by callers; successful enumeration is not proof
of resumability.

`readNativeSession(projectDirectory, sessionId)` exposes complete raw entries to
internal callers, with a 64 MiB default size limit. Invalid JSON/UTF-8, symlink
files, concurrent changes and replaced files fail closed. Records from previous
session IDs are preserved: Desktop history can share ancestry across IDs.
`readNativeBranch(snapshot, checkpointId)` delegates exact ancestry validation to
the existing checkpoint module, preserving attachment/system carriers and
rejecting missing parents, cycles and conflicting UUID parents. Sidechains are
not main-conversation fork targets. Auxiliary prefix records remain available;
this is not yet a product message projection or an attachment export.

## What this does not prove

- A JSONL leaf is not necessarily a completed assistant turn or a separate
  user-visible branch. The catalog does not infer the currently selected head.
- A stable read, old timestamp or session-env directory is not proof of idleness.
  `activity` is always `unknown`, and `currentHead` is always null.
- Readable history is not proof that referenced image/file bytes remain available.
- A shared historical UUID is not permission to merge two distinct sessions.
- Large or incomplete sessions are reported, never silently truncated.

Before stage 3 can hand off a session, it needs explicit selected-head evidence,
execution ownership and acknowledged terminal-result persistence. Until those
checks exist, this stage must never be used to grant a write lease or resume a
real conversation. Stage 2 will add an idempotent display projection, without
changing or reconstructing the native transcript.

## Desktop identity and history projection (stage 2 foundation)

`resolveDesktopSession(metadata, snapshotsBySessionId)` reads only Desktop's
identity fields: local session ID, exact CLI session ID, selected assistant UUID,
working directory, previous CLI IDs and rewind edges. The selected UUID must be
an assistant with valid native execution ancestry in that exact file. Missing
files, stale indices and unknown shapes do not fall back to another session.
Desktop's index is private and version-sensitive; it does not prove idleness.
No connector configuration, appended instructions or titles are exported.

`projectNativeHistory(snapshot, checkpointId)` creates a deterministic display
projection, not canonical database rows. Tool responses stored as user records
join the assistant turn; assistant SDK fragments stay grouped. Meta reminders,
compact summaries and hidden reasoning are not displayed as human prompts.
Original timestamps are retained; absent timestamps remain null. Image/document
blocks hold pending extraction references; raw binary content is not embedded in
the projected payload. Tool compatibility uses the existing bounded-output
contract. Truncation/redaction remains explicit; raw source entries are unchanged.

Compaction display ancestry is distinct from execution ancestry. A backwards
logical parent can retain earlier history. Desktop can also rewrite preserved
records, including reusing an old user UUID for a compact summary and making the
logical parent point forward into the preserved tail. This latter case reports
`COMPACT_SOURCE_HISTORY_REQUIRED`: a summary must never masquerade as complete
old messages. Neither current projection nor this error changes SDK fork rules.
Archived historical JSONLs may supply missing source evidence, but archives are
not restored or merged automatically by these modules.

`planNativeHistorySync(previous, next)` is a pure append/update plan. Repeated
snapshots produce no upserts. A currently last assistant can grow while keeping
previous blocks and UUIDs unchanged. Older message rewrites, truncation, changed
session IDs and changed branches require explicit handling; no delete plan is
created. A future authenticated writer must compare-and-swap the expected source
revision, validate source ownership, map canonical IDs, and atomically persist
the projection and checkpoint. The atomic writer below is internal only; its
API/UI integration does not yet exist. The pure planner alone does not establish
crash-safe synchronization.

`extractNativeHistoryAsset` extracts only embedded base64 image/document bytes
with a configured size cap, exact snapshot/reference checks and SHA-256/size
results. It does not re-encode images, read arbitrary paths, fetch URLs or upload.
Materialization and attachment ownership must later use the normal attachment
service. Missing file/URL assets remain explicitly unavailable.

## Native activity observation

`readNativeSessionActivity` reads only numeric PID `.json` peer records, never
`.key` files or IPC sockets. Files are bounded, non-symlink, stable snapshots.
The PID in the filename must match the record. `probeNativeProcessStart` invokes
`/bin/ps` without a shell, with UTC/C output and a two-second timeout; the exact
process start must match the native record to guard against PID reuse.

Only one matching live Darwin/protocol-1 peer explicitly reporting `idle` yields
`idle_observed`. Missing, stale, malformed, unsupported or multiple peer records
remain unknown; any non-idle status remains busy/unknown. No timestamp timeout
turns an uncertain session into an idle one. Output omits credentials/socket
paths. **Every result has `isWriteLease: false`**: this observation does not stop
Desktop from starting another turn and must never independently grant takeover.

## Combined read-only inspection

```sh
node tools/claude-bridge/scripts/native-session-inspect.mjs \
  --desktop-index /path/to/local-session-index.json \
  --project-dir /path/to/native/project
```

`--peer-dir` optionally overrides the native `sessions` directory. This command
verifies the exact Desktop-selected session/checkpoint, projects its ancestry to
count display messages/blocks, and observes native process activity. It rechecks
both index and transcript revisions after the activity probe; changing sources
invalidate the inspection. JSON output contains identity/counts/reasons only,
never transcript bodies, image bytes, titles or connector credentials. Index
files use the same stable, bounded, non-symlink reader as transcripts/peer files.

Exit 2 means original history is unavailable (including overwritten compact
history); exit 1 means invalid arguments or an unsafe/unavailable inspection.
An idle observation is independent of history completeness. Successful output
always has `handoffAllowed: false`: no writer, ownership protocol, SDK query,
database update or Desktop launch is performed. Complete ancestry also does not
prove all referenced attachment bytes are available.

`native-session-catalog.mjs --desktop` automatically enumerates Desktop's local
indices and finds each exact native session across project directories. There is
no mtime fallback; duplicate native locations fail as ambiguous. Index filenames
must match their embedded Desktop identity. Missing sources stay individually
visible with reason codes. `--desktop-dir`, `--projects-dir` and `--peer-dir` allow
explicit fixture locations. The default Desktop index location is macOS-specific
and private/version-sensitive. This is a local diagnostic entry point, not yet
the authenticated LeileiOS restore-list API or a product UI.

The existing `AgentSdkClaudeTransport.inspectDesktopSessions()` exposes this
read-only catalog without loading provider execution. It refuses inspection
during its own active turn; it does not replace legacy `listSessions`, change
runtime selection, or begin a provider turn.

`readDesktopNativeHistory` is an internal payload reader for the future restore
writer. It requires the selection's exact provider session ID, checkpoint UUID
and SHA-256 native revision. A head change is stale even if file bytes did not
change; incomplete original history throws rather than returning a partial
payload. Returned projection bodies are private and must never be logged or
included in diagnostic CLI output. Callers still need authorization and atomic
ledger/checkpoint persistence; reading does not grant execution ownership.

## External source preservation (restore prerequisite)

Migration 0107 adds a default-false `preserve_external_session` permission bit
to the existing SessionStore status index. A trusted restore path can mark a
verified original session through `preserveExternalSession`; no public endpoint
currently exposes this operation. This is source-deletion protection, not an
execution lease, a second session store, or a declaration that the remote
transcript is complete.

The marker survives removal of every conversation checkpoint and remains sticky
through status updates. Physical-session cleanup checks it across client aliases;
cached transcript operations remain tenant-scoped. Marking and cleanup reservation
share a native-UUID transaction lock, including the window before a marker row
exists. Already reserved cleanup blocks preservation. The final SessionStore
delete path also refuses a marked source; main/subpath bytes are retained.

Local validation: seven real PostgreSQL protection/race tests pass; removing the
reservation lock makes the race test fail by reserving the protected source.
Checked-in migrations apply to a fresh isolated database (108 ledger rows), and
the 0106→0107 upgrade has exactly one pending migration, preserves all other
tables and leaves zero pending migrations afterward. Root typecheck/build and
the offline runtime gate pass. Existing SessionStore/conversation integration
tests pass; the lifecycle-boundaries test reports `RESULT_MISMATCH` on both this
branch and unchanged main `3af6817c` (a baseline failure, not a passing test).

The existing Drizzle snapshot predates several current tables and retired tables.
This change follows the repository's custom-SQL migration pattern, adding only
0107 and its journal entry, rather than generating unrelated schema changes.
Drizzle check passes; full snapshot regeneration is outside this scope. No
production migration has run. Execution handoff remains unimplemented.

## Atomic native-history projection (internal restore boundary)

`restoreNativeSessionHistory` accepts a verified complete selected-head projection
and a stable target conversation ID. It validates the native message fingerprints,
then atomically writes existing conversation/message/content/checkpoint tables and
the preservation marker. Original UUIDs map to `source_message_id`; canonical IDs
remain distinct, so two explicit restored branches never share primary keys.
Original dates populate the existing message date fields. Missing original dates
remain null in `source_created_at`; the non-null database creation date is recording
time, not evidence of an original timestamp.

Conversation metadata stores only source identity/revision and per-message hashes,
not another copy of transcript bodies. Every restored assistant has its exact
native checkpoint and original working directory. Existing reader/prepare paths
can therefore read synthetic restored history, plan ordinary send as same-session
resume and plan non-root Retry/Edit from the historical parent checkpoint. This
does not authorize provider execution or prove Desktop's ownership has been released.

Repeated or concurrent delivery creates one projection. Appends require expected
source revision and canonical head. Completed local continuation is adopted only
when native user UUIDs equal canonical user IDs and durable assistant checkpoints
prove the same native session and working directory. Existing canonical IDs, bodies,
parents, dates and activity remain untouched; only native identity/path indexes
are added. The actual parent chain determines the current path, so off-path evidence
is not deleted or merged by text. Unproved local heads/checkpoints, old-message
rewrites, explicit branch changes and in-flight turns/compacts fail closed. A real
content-insert fault rolls back messages, checkpoints, head and preservation together.
The existing conversation row lock plus the production prepare path's serializable
transaction prevent a concurrent old-head preparation and advancing restore from
both committing; an actual PostgreSQL interleaving test verifies this without adding
a second lock framework or retries. Completed projected messages are immutable;
the reader's pure growing-assistant plan is not accepted as a completed restore.

No route, daemon command or UI invokes this writer yet. Attachment references still
need the existing owned attachment materializer before images/files are previewable.
Root-message replacement and two-client execution handoff still need their own
explicit coordination; these are not silently treated as verified by foundation
tests. A synthetic production prepare/relay/finalize lifecycle proves switch-back
projection after local canonical advancement, with no SDK query or native file write.

### Execution boundary still closed

The pinned SDK 0.3.286 implementation materializes `sessionStore.load()` entries
into a temporary `claude-resume-*` configuration directory before resume. Its
`Options.sessionStore` documentation describes a mirror, not ownership of Desktop's
original JSONL. The existing transport also checks checkpoints against the configured
store before local backfill. A restored source marker alone does not make that
remote transcript complete or authorize continuing Desktop's original file.

Consequently the next execution stage must prove native-source selection, mirror
freshness and single-client handoff together. Do not silently use a stale remote
snapshot, drop mirroring/durability guarantees, or infer an execution lease from an
idle peer observation. This foundation deliberately adds no caller to the restore
writer and no native execution mode. SDK version, native persistence location,
source revision and exact checkpoint remain acceptance requirements, not assumptions.


### Native records versus display projection

`readDesktopNativeHistory` returns an internal `nativeSnapshot` containing the
complete original records, session ID and exact file revision alongside the
selected display projection. Sidechains, thinking signatures, image source bytes
and file-history records are preserved in this transient native payload. They are
not reconstructed from display messages, persisted into conversation metadata or
printed by either diagnostic command. This is a record-preservation interface,
not a byte-for-byte file export or permission to materialize/execute it.

An executable synthetic fixture checks exact record equality, selected display
isolation, CLI redaction and unchanged source bytes. It fails before this addition
because the native payload is absent; the display projection alone is insufficient
for native restoration.

### Open-but-idle is not released ownership

Read-only inspection of the installed official CLI 2.1.285 found `kt(sessionId)`
checking registered peer processes, including open interactive peers. Its `yr`
resume diagnostics explicitly distinguish `open-elsewhere`/`running` and explain
that resume started a copy with a new session ID. This is evidence from the installed
CLI, not a live SDK test or proof that every embedded CLI version behaves identically.
Do not infer same-session execution eligibility from `idle_observed`. Before the
execution stage is enabled, the original peer must genuinely release the session
through a supported handoff/close path, and returned session identity must still be
verified. This task has neither closed a peer nor opened a Desktop session.

### Completed turns stay stable across next-turn context

A later native attachment/isMeta context record belongs to the ancestry leading
into the next real user turn; it must not change the preceding completed assistant's
checkpoint or fingerprint. Assistant fragments and tool responses still advance
that assistant's own checkpoint. The next user's `parentProviderCheckpointId`
retains the exact hidden native parent, with no synthetic visible message.

A RED → GREEN pure regression and a real isolated prepare/relay/finalize/sync case
verify this distinction. The latter adopts completed local messages without inserting
new copies, keeps the existing canonical head and reader output identical, and
continues enforcing the original-history fingerprint guard.


## Minimal two-client implementation scope

The user has selected a smaller first release: fixed-script selection, history
restore/sync, same-native-session continuation and returning to Desktop. Old
Edit/Retry/Fork, automatic branch discovery and handoff buttons are deferred.
Only one client may continue the session. An idle peer is still an owner;
unconfirmed release must refuse execution. The user's real `.claude` remains
read-only during implementation. Real switching will be accepted jointly with
the user, not exercised by unattended model calls.

### Native query boundary (offline implementation, not enabled in the daemon)

`createAgentSdkTurnHandle` has an opt-in `requireSameSessionBeforePrompt` guard.
It requires a resume of the same parent at an exact checkpoint and holds all
user input until a `system/init` event confirms that identity. A copied session,
missing identity, EOF before init, startup timeout or cancellation ends the
blocked input without sending it. The default existing turn path is unchanged.
There is no automatic retry in this guard.

`createNativeSessionMirror` keeps the existing store's durable `append` path,
including subagent keys and rejection propagation, while returning null/empty
for SDK resume `load`/`listSubkeys`. In the inspected SDK 0.3.286 implementation,
`N2` returns before creating `claude-resume-*` when this load is null. The adapter
pins the expected SDK project-directory key and session UUID. Its key is the
SDK's encoded project-directory name, not necessarily the absolute cwd. It does
not seed old records, mark a SessionStore complete, grant ownership or replace
the existing append intent/outbox machinery. Only branded mirrors are accepted
by the native identity guard; ordinary materializing stores are refused.

Read-only inspection of the installed CLI 2.1.285 engine found its `Ks` output
generator yielding the first system/init before reading commands from `qe`.
This supports the proposed prompt gate, but is not a live characterization of
the SDK's bundled CLI or Desktop version. Offline synthetic query tests prove
our withholding/refusal and adapter contracts, not upstream version behavior.
If a real version waits for user input before init, the guard must time out and
refuse; it must never send a probe prompt to bypass the guard.

Still pending: native source/cwd preflight, actual peer release check, durable
baseline mirror synchronization, normal transport/terminal outbox integration,
the fixed switching command and joint real Desktop/LeileiOS round-trip tests.
The two-client feature is not yet ready for end-user switching. No query,
`.claude` write, daemon restart, deployment or production mutation was performed
for this implementation step.

Validation for this step: full bridge offline suite 241 pass / 0 fail / 4 live
skips; root typecheck and build pass; local production runtime gate pass; diff
and hygiene checks pass. No full canonical-suite or real Desktop acceptance is
claimed. Regression RED witnesses are the copied-session prompt, missing-init
and startup-timeout failures; the subsequent offline suite is GREEN.


### Switching source/release preflight

The next implementation step adds `readNativeSessionRelease`: a successfully
read, identified peer scan with no matching UUID is `not_open_observed`; an
idle verified owner is still `still_open`. Missing/unreadable peer directories,
malformed or unidentified records, stale/reused PID identities and unsupported
matching owners remain unknown. UUID comparison is case-insensitive. No peer
key, socket credential or original source is modified. This is still an
observation, never an atomic lease; the native init identity guard remains
necessary against an official-client race after the scan.

`preflightNativeSessionSwitch` pins Desktop identity/checkpoint/revision and
requires complete display history, the actual project beneath the selected
config's `projects` directory and that config's `sessions` peer directory. It
rechecks source and index after scanning for release. It returns sanitized
identity/count evidence with `readOnly: true` and `executionAuthorized: false`.
Canonical in-flight and baseline-mirror checks are not yet wired into this
entry, so it cannot authorize a real turn.

The fixed script supports read-only `--check` and explicit authenticated `--restore` (described below):

```sh
node tools/claude-bridge/scripts/native-session-switch.mjs --check \
  --desktop-index INDEX_FILE --project-dir PROJECT_DIRECTORY
```

`--config-dir` is available for an explicitly selected native configuration;
otherwise the existing `CLAUDE_CONFIG_DIR` or `~/.claude` is used. Execution and
Desktop launch verbs are rejected while integration is unfinished. File paths
are currently inspection inputs; the final selection entry still needs catalog
resolution so the user does not need to find JSONL or index files manually.

Latest validation: bridge 247 pass / 0 fail / 4 live skips, including executable
CLI fixtures; source/release checks use synthetic directories only. These tests
prove our source/release refusal and sanitization behavior, not an atomic native
lock or a real Desktop handoff. No real SDK query or original `.claude` write.

### Atomic native baseline and existing foreground execution

The internal `restoreNativeSessionHistory` accepts the stable reader's optional
`nativeSnapshot` (original records, matching session/revision/checkpoint). When
provided, preservation, full main-transcript replica synchronization and display
projection commit in the same transaction. It never substitutes display blocks
for native records. Old replica records must be an exact ordered prefix; a
shorter/rewritten source fails `NATIVE_TRANSCRIPT_DIVERGED` without replacing
history. JSONB object-key order is ignored, array order and identical records at
distinct positions are retained. Import chunks, normal SDK append and cleanup
serialize on the same physical-session advisory lock. Repeating an acknowledged
or lost-response import adds no duplicate records. Subagent import cannot claim
main-transcript completeness. Legacy projection-only callers do not gain a
completeness claim.

`AgentSdkClaudeTransport.executeTurn` now accepts the opt-in branded
`nativeSessionMirror`. It must belong to the transport's exact durable store and
original session; only exact-checkpoint resume is allowed. The original local
source and complete baseline must already exist. This path refuses backfill,
remote-copy materialization and incomplete-tail recovery. It marks the existing
baseline incomplete before execution, waits for original-SID init before sending
the prompt, and keeps the existing mirror-failure, completion/checkpoint and
terminal-result delivery paths. Default new/resume/fork behavior is unchanged.

These are connected internal write/execution paths, not a finished switching UI
or complete executable handoff script. The fixed script also supports history-only `--restore`. Caller
coordination still must enforce release, durable pending-intent/result replay,
fresh snapshot and canonical ownership before enabling this mode. Real Desktop
handoff, native file mutation and provider queries remain unexecuted; all tests
use synthetic transcripts/fake queries or the isolated local PostgreSQL database.


### Explicit authenticated history restore

```sh
node tools/claude-bridge/scripts/native-session-switch.mjs --restore \
  --desktop-index INDEX_FILE --project-dir PROJECT_DIRECTORY \
  --conversation-id STABLE_CONVERSATION_UUID
```

The command requires explicitly configured `LEILEI_NATIVE_LIVE_RELAY_URL` and
`LEILEI_NATIVE_LIVE_RELAY_TOKEN`; it does not discover credentials, invoke Railway
or fall back to production. Remote endpoints require HTTPS, local fixture HTTP is
limited to loopback; redirects and credential-bearing URLs are rejected. Native
records are never printed. Keep the same conversation UUID for retries/sync.

The authenticated existing session-store mount exposes `native-history/state`
and `native-history/restore`. Ownership comes only from internal auth, never the
payload. State returns head/revision CAS evidence only. The client checks a pinned
complete native source and release, fetches CAS evidence, rechecks source/release,
then submits the original snapshot and display projection to the atomic writer.
Backend checks canonical busy/head/source binding again. An interrupted nonempty
SessionStore replica is refused (`NATIVE_SESSION_RECOVERY_REQUIRED`); history
restore is not a way to mark unfinished append/result recovery complete.

This is a history-only write, not a lease or permission to start Claude. It does
not automatically retry HTTP requests. If server commit succeeds but its response
is lost, rerunning with the same conversation UUID reads the committed CAS state
and returns `already_current`, preserving message and transcript identities.
Request bodies above 30 MB fail locally (existing authenticated parser is 32 MB);
records are never truncated. Responses are bounded to 64 KB, output/errors contain
only allowlisted status and identity fields.

The actual CLI is tested against a synthetic local HTTP relay; the same restore
entry is separately tested through the authenticated router and isolated real
PostgreSQL, including commit followed by lost response. No original `.claude`
files, actual account sessions, daemon, Desktop or production were changed. Native
runtime ownership/caller wiring, catalog-based friendly selection, reverse
Desktop handoff and joint live acceptance remain incomplete. Do not enable this
Draft feature for real switching until those execution gates are connected.

Restore-entry validation under Node 22.23.3: authenticated API 3 pass;
serialized isolated database/API groups 40 pass / 0 fail / 0 skip; complete
bridge offline 254 pass / 0 fail / 4 live skips; existing runtime gate 536 pass.
Root typecheck/build and diff check pass. One initial concurrent database-group
run returned `INTERNAL_ERROR` in the existing synthetic same-session prepare
case; its isolated rerun and the full serialized groups pass. Its transient root
cause is not established, so this is recorded rather than called a proven fix.

### Existing daemon local-SDK continuation identity

The deployed daemon constructs the transport without a remote SessionStore. Its
ordinary exact-checkpoint `executeTurn` resume now enables the same pre-prompt
identity gate as the optional native mirror. This needs no daemon configuration
or additional wire field. It waits for SDK `system/init` with the original session
ID before delivering canonical user input. A copied ID fails before prompt
delivery. Fork/new, remote materializing stores and native schedule commands
retain their existing behavior; schedule commands use non-verbatim prompts and
are outside this native conversational resume gate.

The pre-fix offline witness observed one prompt delivered to a copied session;
after the fix it observes zero. The positive local-SDK fixture verifies one query,
one canonical user UUID, no fork or remote materializer, original session identity
and the new native assistant checkpoint. These are simulated SDK responses, not
live compatibility or ownership acceptance. Identity checking does not acquire a
client lease or protect an unsynchronized newer Desktop tail by itself. Those
handoff gates and reverse Desktop opening remain incomplete.

Node 22.23.3 validation for this change: complete Bridge offline 256 pass / 0 fail /
4 live skips; production runtime gate 400 root + 138 Bridge = 538 pass / 0 fail /
0 skip. Root typecheck/build and diff check pass. The first sandboxed Bridge run
could not bind its mock loopback HTTP server (`EPERM`); the authorized local-socket
rerun passes. No database test rerun was needed for this transport-only change.
