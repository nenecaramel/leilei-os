# Implement Toy duration support

> **Execution note:** Follow this plan task-by-task and run the focused test after each implementation task.

**Goal:** Carry an optional bounded duration from `toy_set` through Railway and the Mac Worker, then let the local Controller stop automatically at the requested deadline.

**Architecture:** Normalize the optional MCP input to 60 seconds in the Toy domain. Persist it in an additive nullable database column, serialize it as `durationSeconds` on bridge set commands, and forward it to the local API. Keep the 10-second command TTL in the queue unchanged. The local Controller owns a monotonic runtime deadline and preserves stop-first/fail-safe behavior.

**Repo/worktrees:** Cloud changes are on `agent/toy-duration` in `/Users/Admin1/projects/leilei-os-clean-2026-07-28`, based on `origin/codex/phase-8-3-weighted-galaxy-expand`. Local runtime changes remain in `/Users/Admin1/leilei-toy` and are reported separately because that directory is not part of the LeileiOS repository.

### Task 1: Establish design and red tests

- Keep the design/spec in `docs/superpowers/specs/2026-08-16-toy-duration-design.md`.
- Add failing cloud tests for default 60, bounds 1/1200, strict rejection, persistence/serialization, and additive migration/backfill.
- Add failing local tests for parsing/forwarding duration and Controller deadline/stop behavior.
- Run focused tests and record the expected red failures.

### Task 2: Implement cloud contract

- Add shared duration constants/types and normalize optional set input to 60.
- Add `duration_seconds` to the Drizzle schema and an additive migration only.
- Include duration in repository selection/inserts/raw mapping and preserve the 10-second TTL.
- Add duration to Web API bridge/user serialization and MCP input/output; leave stop unchanged.

### Task 3: Implement local runtime

- Validate 1–1200 with default 60 in the local API and Worker.
- Forward duration to the API and let the Controller set its monotonic deadline.
- Preserve deadline clearing in stop/disconnect/failure paths and preserve reconnect/fail-safe behavior.
- Update compatibility snapshots/scripts only if they are active or covered by the existing local tests; do not change unrelated historical behavior.

### Task 4: Verify

- Run focused cloud tests, migration tests, typecheck, build, and full cloud test suite.
- Run local unit tests, Python compilation, and local service status/secret checks as applicable.
- Run the real-chain minimum acceptance only after code tests pass, with old-command TTL isolation and no production deploy.
- Inspect diff for percent/TTL/Phase 8/Universe changes and scan for secrets.

### Task 5: Review handoff

- Commit only Toy duration cloud/local documentation and implementation changes.
- Push `agent/toy-duration` and open a draft PR against the selected Toy-containing mainline branch; do not merge or deploy.
- Report files, migration, tests/results, rollback, and remaining limitations.
