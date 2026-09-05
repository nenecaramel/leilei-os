# C Author Parity Production Rollout

1. Verify final branch SHA and actual migration head.
2. Confirm a current encrypted PostgreSQL backup and restore readiness.
3. Record pre-migration author counts for core_memories, diary_entries, tasks, and todo_papers.
4. Apply and verify only the additive content_author C migration.
5. Re-read counts and prove no existing author values changed.
6. Deploy the exact C-aware application SHA.
7. Verify /health and startup logs.
8. Verify legacy L, G, and null reads before any C write.
9. Verify ChatGPT and Claude both read MCP schemas/results containing L, G, and C.
10. Obtain explicit user authorization before the first production C write.
11. Smoke-test an approved C Memory/Diary/Task/Todo path and verify Home and Day Space.
12. Inspect safe Railway logs for OAuth, MCP, database, and validation failures.

## Rollback

Before any C record exists, application rollback is allowed; leave the additive enum value in place.

Never run a destructive production down migration.

After a C record exists, do not deploy an L/G-only application. Fix forward with a C-aware build.
