# Manual native Session archival after continuation-only switching

The existing local `leileios-archive.command` remains the manual entry point.
The default invocation applies archival; `--plan` is read-only, including no plan
or archive-directory creation. Daily continuation switching does not automatically
archive anything, regardless of an old `AUTO_APPLY` flag.

## What stays resident

- Every recognized Desktop window's own Session, including archive windows.
- All Sessions returned by the authenticated `referenced-sessions` endpoint.
  This remains conservative: old checkpoints can still support Edit/Retry in
  legacy conversations. No checkpoint is discarded merely because it is old.
- Companion bundles directly referenced by retained physical chains (for example,
  a fork's tool output still stored under an older Session's directory).
- Sessions modified within the existing one-hour grace period, or whose native
  peer is open/unknown. Pending append receipts and terminal/background result
  outboxes stop archival until recovered through the existing daemon flow.
- The entire project when a kept Session's physical execution chain cannot be
  validated, including conflicting UUIDs or an unavailable selected checkpoint.

Only projects containing a Desktop window or a server-referenced local Session
are considered. This is not a general cleanup of unrelated Claude projects.
A referenced local-only Session's project is covered even without a Desktop
window. Unreadable Desktop account/index data stops the command.

## What can be archived

Older, unreferenced native JSONL files and their same-named companion directories
can be archived when the retained native roots are self-contained. The archiver
validates UUID/physical-parent ancestry with `durableCheckpointPrefix`; it does
not expand `logicalParentUuid` to recreate pre-compact display history. A Session
that used to be kept solely as a full-history projection source can therefore
become eligible. Indexed Desktop archive windows still remain protected.

No records inside a kept or archived JSONL are edited. This is a filesystem
preservation check, not a live SDK resume/rewind acceptance test. Do not use it
to promise that Desktop can display pre-compact messages which the native file
does not itself contain. More candidates are possible, not guaranteed.

## Apply and recovery safety

1. Refresh remote references, Desktop windows, peer activity, and recovery state;
   re-plan and compare the planned source-file hashes before packing.
2. Pack the full JSONL and companion directory, extract only into a temporary
   verification directory, and compare every file's SHA-256. Write a manifest
   with the original location and restore instructions.
3. Recheck the plan and source digests. Atomically move only the candidate paths
   into a private `.archive-recovery-*` directory within the original project.
4. Recheck references/recovery and require `lsof` to confirm that no file or
   directory descriptor is open in that private directory. An unavailable or
   inconclusive probe refuses retirement. Check the staged bytes and refuse any
   recreated original paths. Only then remove the private staged copies.

The move captures the actual inode: a pre-existing writer remains detectable
there; a later reopen of an original name creates a different file that is never
unlinked by finalization. Hard-linked/symlink/special-file members are refused.
A failure after the move keeps the staged originals, restores missing names
without overwriting newer files, and writes `<label>.recovery.json` alongside
the verified archive. Stop clients before resolving such a recovery; do not
manually discard either version. Ordinary failures before the move leave all
originals in place.

Native peer observations are not official-client leases. Do not start/resume a
candidate while an explicit archive operation runs. The preservation mechanism
prevents a raced writer's bytes from being discarded; it does not turn archival
into a supported concurrent session handoff.

## Validation scope

Tests use temporary synthetic Sessions, including compact roots, protected
archive windows/checkpoints, overlapping references, pending recovery, changed
files, a recreated original pathname, and a real open-descriptor probe. The
existing archive round-trip test checks byte-for-byte restoration.

A local `--plan` can inspect the owner's metadata and transcripts without model
calls. Actual archival of the owner's Sessions remains a separate explicit
operation. This change does not alter the SDK version, switch protocol, backend,
Railway state, daemon, Desktop indexes, or any chat/attachment data.
