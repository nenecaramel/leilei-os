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
the projection and checkpoint. This writer and its API/UI integration do not yet
exist; the pure planner alone does not establish crash-safe synchronization.

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
