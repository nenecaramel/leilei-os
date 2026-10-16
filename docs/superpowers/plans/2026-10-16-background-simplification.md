# Bash / Monitor stage-one implementation

Scope is the user-approved 3-stage outline: simplify existing state/dispatch, then usable background Bash/Monitor; Cron/Loop are stage two. No complete-history sync, task replay, new scheduler, Background Agent/goal/desktop-control/push expansion.

## Stage-one tasks (one feature branch; no foundation-only completion claim)
1. Unify task membership in one SDK projection. Preserve raw membership after process loss for truthful handoff; keep task status separate from local stop-request status. Preserve exact run/handle isolation and bounded history.
2. Keep SDK event consumption alive during background result acknowledgement. The existing router alone serializes canonical commits; gate only new input on those commits. Test ordering in both directions and failure/close/reentrant paths.
3. Consolidate overlapping tool admission without caching lifetime authorization. Permission waits still require fresh checks. Reuse existing session owner and result submission; do not add another task engine.
4. Validate bounded output retrieval using pinned SDK0.3.296's existing get_task_output control protocol. No arbitrary file paths, prompt parsing, model invocation or dependency upgrade; unsupported capability fails closed.
5. Reuse existing authenticated runtime controls for task list/output/stop, preserving listener/session/current-branch/opaque-handle ownership. Reuse existing iOS task components and navigation. No new table; a minimal migration extends the existing control-kind CHECK constraint, which currently rejects task controls.
6. Run relevant controlled SDK/HTTP/real isolated PostgreSQL/UI regressions, typecheck/build/runtime gate, independent whole-branch review. No real model call or formal daemon restart without separate acceptance authorization. Preserve canonical checkout and existing user data.

TDD per task; intermediate local commits may preserve progress, but stage one is incomplete until task controls are reachable and verified. Live acceptance remains separate and must never be inferred from controlled streams.


## Live acceptance follow-up (2026-10-16)

The first background Bash acceptance failed. Metadata establishes a local
`LeileiOS scheduled input rejected.` warning at the background-completion boundary,
then a subsequent foreground command selected an unavailable persistent writer.
It does not capture the rejected hook's fields or prove the exact idle failure.
Do not report the whole scheduling/background feature as live accepted.

`UserPromptSubmit.source` is optional independently of `prompt_id`; that ID is
ordinary prompt correlation, not proof of timer provenance. Missing-source
callbacks now use bounded, fresh durable autonomous admission, without inspecting
prompt content or granting native timer support. Autonomous admission has one
in-flight attempt, 64 total attempts and a seven-day lifetime per live writer;
explicit timer sources retain duplicate-ID and one-minute cadence checks.
Unclassified notifications may burst and cannot provide enforceable timer cadence
or duplicate-event provenance. A mixed/unstamped producer disables new
CronCreate/ScheduleWakeup tools for that writer; list/delete/cancel remain usable.
Fixed rejection codes identify admission timeout/denial, stale ownership, budget,
cadence and unsupported-source failures without including prompt or tool content.
Already-restored unstamped fires are bounded by the shared attempt/lifetime budget,
not represented as verified timer events. Native Cron/Loop acceptance remains open.

A closed/failed registry binding is no longer eligible for persistent routing;
existing explicit retirement/fallback fences remain in place. No broad exemption
was added for background results lacking a verified assistant checkpoint: an
unknown result must not silently advance or discard native continuation state.

Tasks Loading screenshots alone do not establish an endless UI load. HTTP metadata
shows pending controls while no usable persistent writer handled them; no UI
redesign or unrelated timeout change is included. Repeat background completion,
foreground continuity and list/output/stop on a refreshed daemon and iOS build.
