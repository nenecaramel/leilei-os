# Native Session checkpoint-only handoff (opt-in migration)

Goal: Continue the same native Claude session between official Desktop and LeileiOS without importing pre-existing Desktop messages, pre-Compact file ancestry, or historical image/document copies.

This implementation is **opt-in and not production-validated**. Native JSONL stays on the Mac as the execution source; Railway holds conversation IDs, checkpoint and ownership state. No database table is deleted or migrated.

## Implemented

- Selected native Session inspection: session UUID, checkpoint, cwd, native source revision. No old display-history reconstruction.
- Authenticated internal light-state and light-switch operations with compare-and-swap on current conversation head/checkpoint, writer ownership and outstanding-work checks.
- Desktop handoff drains Mac runtime before releasing LeileiOS ownership. Return from Desktop advances ordinary Send to its descendant checkpoint while keeping prior LeileiOS checkpoint for Edit/Retry.
- No native-history restore call, asset-stage upload, full JSONL submission, or automatic transcript archive in the light path.
- Existing full-history route and all old data remain intact.

Test-only local invocation with an updated local checkout and server (not ready for production):

    node scripts/native-session-local.mjs desktop-light SESSION_ID CONVERSATION_ID
    node scripts/native-session-local.mjs leileios-light SESSION_ID CONVERSATION_ID

These modes require a linked LeileiOS conversation with a committed Claude checkpoint. Session ID and conversation ID are different identities. The owner must exit official Desktop before re-entry into LeileiOS; unknown/active native owners are refused. The light path does not start Desktop, query Claude, or edit its transcript.

## Limitations before replacing the old default

1. The first Desktop-only Session still uses the existing external-session bootstrap. It currently forks when LeileiOS first sends, so strict same-UUID initial continuation is a separate migration step.
2. Compactions that erase proof of the previous checkpoint, or official Edit/Retry switching to another native Session, currently fail closed. A compact-aware branch proof and explicit rebind flow are still required.
3. The fixed interactive picker still uses the legacy catalog. It must move to lightweight selection after acceptance.
4. SessionStore, asset staging and old PostgreSQL tables remain to preserve existing sessions and recovery paths. Retire them only after tested replacement, verified backups and a separate retention/migration plan.
5. Official Desktop cannot be forced to honor Railway ownership. Recheck local peer activity and never send from both clients concurrently.

Validation gate: pnpm typecheck; pnpm build; isolated PostgreSQL integration suite RUN_NATIVE_SESSION_PRESERVATION_DATABASE_TEST=1 against the disposable leileios_native_session_test database; live two-way handoff including Edit/Retry, compaction and cold restart; verify no new native-history-assets rows.

No production deployment, database cleanup, or modification of archived chats is part of this PR. The separate #1108 asset-dedup draft concerns the old architecture and should remain unmerged during this migration.
