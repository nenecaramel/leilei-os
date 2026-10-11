# Fixed-command conversation selection

The fixed command must not assume a default Session, choose the newest transcript,
or resolve a conversation by title. Titles are labels; identity is explicit.

After the server and maintained Mac checkout contain this change, install the
tracked wrapper at `~/Documents/Codex/leileios-switch.command`:

```bash
cp ~/Developer/leilei-os-main/scripts/leileios-switch.command ~/Documents/Codex/leileios-switch.command
bash ~/Documents/Codex/leileios-switch.command desktop
bash ~/Documents/Codex/leileios-switch.command leileios
```

`desktop` lists active LeileiOS conversations; `leileios` lists Desktop sessions.
Select a numbered row or type `q` to cancel. The menu shows title, activity time,
conversation and provider Session identities, and reasons for unavailable rows.
Local titles are displayed only in the owner's terminal, never sent back to the
server by the picker. No credentials, transcript or Memory bodies are displayed.

The internal choices endpoint returns bounded, authenticated owner-scoped metadata
only. A missing/old server, malformed response, truncated catalog, ambiguous native
identity, busy turn or changed selection stops the command. The menu is an
observation, not an execution lease. Existing native-source, release, recovery,
checkpoint and canonical CAS checks still run after selection.

An existing restored Desktop Session maps back to its original active LeileiOS
conversation. Only a first restore with no binding uses the native Session UUID as
the new conversation ID. Multiple bindings or an unbound ordinary conversation
are never silently replaced. Source files and Desktop indices are never edited by
the picker. Switching back to LeileiOS requires the selected Desktop Session to be
closed, even if it is idle.

## Current limit

The existing handoff requires a valid Desktop index and an existing native-source
binding. A newly created ordinary LeileiOS conversation with no Desktop index is
listed as `DESKTOP_INDEX_REQUIRED`; this change does not make that unsupported path
work by forging an index. New-session-to-Desktop support remains a separate task.

The supported handoff uses manual Desktop opening, as previously accepted. The
picker does not start Desktop, a daemon, an SDK query, or a model turn. The old
explicit `desktop|leileios SESSION_ID` path remains available, with its existing
checks; it is not an automatic window selector.

Roll out the read-only server endpoint and maintained checkout before claiming the
interactive command is accepted. No production migration is required. Live
switching and device/browser acceptance remain separate from offline tests.
