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


## Native Cron admission follow-up (2026-10-16)

The owner reports background/foreground continuity and task inspection/stop PASS.
CronCreate was still rejected by the bridge's optional-source capability check.
An offline probe using the real pinned CLI2.1.296, isolated config and a rejecting
loopback model endpoint confirms its UserPromptSubmit omits source while supplying
prompt_id; the probe made zero model HTTP requests. A second offline probe confirms
native /loop still supplies the exact submitted foreground hook text.

Remove the cached stamped/unstamped tool capability check. CronCreate and
ScheduleWakeup now use the existing fresh durable admission in PreToolUse and
before/after canUseTool permission, including current listener/session/branch/lease
checks and stale-turn rejection. Optional hook metadata is not authorization.
No custom scheduler, timer persistence, prompt inference or parser was introduced.
The input guard's shared 64-attempt/seven-day limit, in-flight admission reservation,
two-second timeout and known-source timer ID/cadence checks remain unchanged.
The native five-field Cron has minute granularity; native ScheduleWakeup clamps
60..3600 seconds. An unstamped fire still cannot supply host duplicate provenance;
CLI scheduling owns that identity, while host admission bounds cost and ownership.

The opt-in agent-sdk-native-cron-offline test runs the actual CLI and native
CronCreate/CronList against a loopback synthetic Anthropic endpoint with empty
settings/MCP/config, synthetic auth and nonpersistent session. It verifies a real
minute-boundary one-shot fire and automatic removal, plus native /loop
ScheduleWakeup firing and stop acknowledgement, without a real model call or
production state. Run with RUN_NATIVE_CLI_OFFLINE_CRON_TEST=1; default suites skip
these cases to avoid minute-long gates. Controlled tests also keep post-PreToolUse ownership
revocation coverage. Live Cron/Loop acceptance remains separate from this offline
native-CLI evidence; do not mark the user's third/fourth acceptance PASS yet.
