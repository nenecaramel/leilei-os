# Bash / Monitor stage-one implementation

Scope is the user-approved 3-stage outline: simplify existing state/dispatch, then usable background Bash/Monitor; Cron/Loop are stage two. No complete-history sync, task replay, new scheduler, Background Agent/goal/desktop-control/push expansion.

## Stage-one tasks (one feature branch; no foundation-only completion claim)
1. Unify task membership in one SDK projection. Preserve raw membership after process loss for truthful handoff; keep task status separate from local stop-request status. Preserve exact run/handle isolation and bounded history.
2. Keep SDK event consumption alive during background result acknowledgement. The existing router alone serializes canonical commits; gate only new input on those commits. Test ordering in both directions and failure/close/reentrant paths.
3. Consolidate overlapping tool admission without caching lifetime authorization. Permission waits still require fresh checks. Reuse existing session owner and result submission; do not add another task engine.
4. Validate bounded output retrieval using pinned SDK0.3.296's existing get_task_output control protocol. No arbitrary file paths, prompt parsing, model invocation or dependency upgrade; unsupported capability fails closed.
5. Reuse existing authenticated runtime controls for task list/output/stop, preserving listener/session/current-branch/opaque-handle ownership. Reuse existing iOS task components and navigation. No new table or migration merely for task transport.
6. Run relevant controlled SDK/HTTP/real isolated PostgreSQL/UI regressions, typecheck/build/runtime gate, independent whole-branch review. No real model call or formal daemon restart without separate acceptance authorization. Preserve canonical checkout and existing user data.

TDD per task; intermediate local commits may preserve progress, but stage one is incomplete until task controls are reachable and verified. Live acceptance remains separate and must never be inferred from controlled streams.
