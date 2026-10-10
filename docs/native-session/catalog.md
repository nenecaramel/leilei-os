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
