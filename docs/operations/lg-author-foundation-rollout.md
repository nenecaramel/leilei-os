# L/G author foundation rollout

## Rollout order

1. Fresh-verify intended app SHA and migration head.
2. Confirm current encrypted external PostgreSQL backup and restore readiness.
3. Record pre-migration counts for `core_memories`, `diary_entries`, and `tasks`.
4. Apply only the additive nullable-author migration.
5. Recheck counts and prove existing rows remain null unless explicitly authored after rollout began.
6. Deploy application code.
7. Smoke-test Memory/Diary/Task old-null reads.
8. Smoke-test Web creates/edits with L and G.
9. Smoke-test archive/restore and Task status actions preserve author.
10. Smoke-test `write_memory`/`write_diary`/`create_task` with explicit author and idempotency behavior.
11. Perform iPhone production paper-signature acceptance.
12. Only after production acceptance, sync accepted main into isolated PWA 7.6A and rerun full gates/standalone smoke.

## Rollback

Application rollback is allowed.

Leave the additive nullable author columns and `content_author` enum in place.

Do not run a destructive production down-migration.
