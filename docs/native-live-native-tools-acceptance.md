# Native Live official tool acceptance (SDK 0.3.296)

This is a preparation checklist, not evidence of real tool availability or end-to-end acceptance.
No SDK upgrade or replacement of `mcp__leileios_local__send_file` is included.

## Prepared paths

- Chrome: this branch includes PR #1041 and requests the official `--chrome` flag only when the Mac environment explicitly enables it. The extension/native messaging connection still needs acceptance.
- WebFetch: the existing SDK default tool set is retained; there is no extra LeileiOS fetch server or forced `allowedTools`. Availability still comes from SDK initialization and account/settings policy.
- Tool-result images: foreground SDK turns forward actual Anthropic base64 image blocks and MCP `image` blocks to the existing private attachment uploader before binary data is omitted from normalized events. PNG/JPEG/GIF/WebP images up to 20 MiB use the existing chat image attachment renderer after successful turn finalization. Images share the eight-attachment turn limit with `send_file`; replayed images from the same tool are deduplicated. Upload waiting has a shared 15-second budget and stops on cancellation. Failure emits `TOOL_IMAGE_UNAVAILABLE` without failing the text response. Text, URL/path references, sidechains, malformed images and unsupported formats are not fetched or interpreted as pictures. Inline audio, MCP Apps and Artifact rendering are separate work. Offline tests verify delivery through the actual Mac factory using synthetic bytes and mocked storage, not live device acceptance.
- Artifact: `LEILEI_NATIVE_LIVE_CLAUDE_ARTIFACT=1` passes invocation settings `{ enableArtifact: true }` in ordinary and interactive queries. Unset/0 leaves existing SDK defaults unchanged. The SDK honors its own account/organization checks, environment disable and permission denies; the adapter does not rewrite user settings or clear disables. This is an opt-in request, not proof the account can publish.
- Cloud routines: existing `/schedule` and `/routines` command dispatch is preserved. These create tasks on claude.ai, not a local LeileiOS scheduling service. No routine was created, fired, or modified during preparation.
- Tool permissions: the Mac transport factory now selects owner-authorized `auto_allow`. Native and external MCP requests reaching `canUseTool` are approved without a LeileiOS Allow/Deny card; ordinary and interactive queries both use this policy. `AskUserQuestion` still requires real answers through the question callback. A query without a question handler refuses it rather than inventing answers. The general bridge adapter retains its default `ask` policy for callers that need manual decisions.

Automatic approval uses SDK `permissionMode: "default"` and the host callback, not `bypassPermissions` or a global settings change. Existing SDK hooks, explicit deny rules, operating-system permissions, login, account and tool-availability constraints still apply. User/project/local setting sources remain enabled. This policy does not provide a background Monitor lifecycle, change `/schedule` behavior, or prove live tool execution. Offline tests exercise actual adapter callbacks and the Mac factory with controlled SDK requests; no model calls are made. Changes require pulling the merged code and refreshing the Mac daemon with Node 22; running queries keep their previous policy.

LeileiOS native iPhone push is deferred by user choice while using a free Apple Personal Team. No APNs capability, registration or backend sender is added. Official notification acceptance remains distinct from LeileiOS push.

## Existing runtime capability evidence

Read-only inspection of existing successful Native Live init metadata on 2026-10-12 (no new model call) found a complete 81-tool snapshot containing WebFetch, WebSearch, RemoteTrigger, CronCreate/List/Delete, ScheduleWakeup, Monitor and PushNotification. It also contained the existing local send_file tool. Artifact and Chrome tool names were absent in that snapshot. A later snapshot hit the existing 256-name observability bound; presence is evidence, but absence in that truncated list is inconclusive. These records prove tool advertisement on that runtime, not execution, persistence or delivery.

The branch is aligned to main including #1044's interrupted SDK tail recovery and #1045's send-failure visibility. Their tests and production changes are preserved.

## Boundaries not solved by adding tool names

The compatibility `AgentSdkTurnHandle` ends the input stream on a terminal result and closes the query at cleanup. The default persistent daemon path instead keeps its SDK writer alive after foreground completion; the daemon being alive alone is still not sufficient.

- Session-scoped schedules require the persistent writer, fresh admission and durable background receipts described below. Tool advertisement alone remains insufficient evidence of live execution.
- PushNotification targets Claude's desktop/Remote Control clients. It does not register an APNs delivery path for the LeileiOS iPhone app. Successfully invoking that tool would not prove LeileiOS notification delivery.
- A private Artifact link is published on Anthropic infrastructure. It is not an upload into the LeileiOS attachment Bucket or a new inline renderer.

## One controlled acceptance session, after code/config approval

1. Record the running Mac code/SDK version and the real SDK initialization tool list without printing prompts, transcripts or credentials.
2. Confirm Chrome's official extension connection. Ask for one benign browser read and verify the native tool result. If it requires site access, use the official approval flow.
3. Ask for one public webpage through WebFetch; verify the returned content in LeileiOS. Do not change WebFetch safety policies.
4. Ask for one small, non-sensitive Artifact. Verify publishing permission and open the returned private link. Do not treat a local HTML fallback as a published Artifact.
5. Inspect the official cloud routine path before authorizing task creation. Any created recurring task needs an explicit schedule, spend limit/stop rule and cancellation check; nothing should begin polling merely because the daemon started.
6. Decide which client must receive notifications before testing delivery. Claude Remote Control delivery and LeileiOS iPhone delivery are separate acceptance targets.
7. For Monitor or session-local schedules, require a lifecycle design and offline fault tests before any long-lived model execution. Test session transfer, cancellation and no duplicate wakeups; do not equate a passing mock tool call with a persistent scheduler.

No production settings, credentials, daemon startup, recurring jobs or browser actions are changed by this document or offline tests.

## Primary references

- https://code.claude.com/docs/en/chrome
- https://code.claude.com/docs/en/tools-reference
- https://code.claude.com/docs/en/scheduled-tasks
- https://code.claude.com/docs/en/routines
- https://code.claude.com/docs/en/artifacts

## Stage 3A: task state and stop safety (offline)

The persistent host now exposes `listTasks()` and `task-state` events for its own SDK process. Shell, Agent and Monitor tasks use the SDK's full live membership snapshots. `task_started`/progress/terminal edges retain exact `run_id`; they may arrive before or after a membership change. They never add or remove live membership. Missing run IDs do not authorize ambiguous edge attribution. Task descriptions and summaries are bounded; only 128 inactive observations and up to 1,024 live tasks are retained. Larger/invalid level snapshots fail the session closed.

Each task appearance has an opaque local handle. A caller can pass it to `stopTask(id, {handle})`; stale handles are refused even if a newer run reuses the same ID. Concurrent/repeated stop calls share one SDK request and a two-second response deadline. A response only acknowledges the request. The task remains live until the SDK removes it; a matching terminal notification supplies its known outcome. Timeout/disconnect sets `stopStatus: "unknown"`, and the same appearance is never automatically retried. When the process closes or fails, unfinished observed/live tasks become `unknown`. This process-local ledger is not persisted and does not recover subprocesses on daemon restart.

The background Bash/Monitor integration reuses `native_live_runtime_controls` for bounded list/output/stop requests. A CHECK-constraint-only migration adds `task` to its permitted kinds; there is no new task table or scheduler. A separate Mac control wait consumes only requests for its live session generations, including while a foreground turn is running. The old turn-control pump cannot consume these requests. Phone task headings and the existing conversation menu’s Tasks item open a native task list, including when all SDK tasks are ambient and suppressed in the transcript; selecting a task reads output or requests an individual stop. Stop acknowledgement is not task completion. List polling occurs only while this sheet is open.

Every request is scoped to the source user, surviving canonical branch, native session, live listener lease and local process generation. Output/stop additionally require the opaque task appearance handle. Desktop ownership, a continuation handoff floor, Rewind/fork, expired/taken-over listener and retired processes reject stale operations. Task receipts are rechecked on completion and user reads. A lost response never replays a stop; an uncertain reserved request remains unknown, and a fresh list observes the actual SDK state. Pending commands expire after 15 seconds. Process restart does not recover subprocesses.

The paired persistent runtime advertises `perTaskStopAffordance` only after the authenticated backend reports task-control protocol version 1 and its consumer is wired, so foreground interrupt can leave background work running. Legacy/test callers without that consumer retain the whole-session fallback. Deploy the matching backend/schema before refreshing the Mac daemon; older backends do not provide this contract. Idle tool callbacks require a fresh surviving-session admission and a second check after permission; a concurrent foreground turn revokes that captured admission. There is no lifetime permission grant, no automatic prompt or model call just to read task state, and no idle permission/question UI borrowed from an old turn.

Pinned SDK 0.3.296 publicly exposes `stopTask` and `backgroundTasks`, but no public task-output reader on `Query`. An internal `get_task_output` protocol type is not a supported public API. A deliberately isolated compatibility shim now invokes the pinned SDK's internal `Query.request` for this one declared `get_task_output` subtype. It reads at most the last 8 KiB as plain text with a two-second deadline, rejects stale handles before/after the request, and fails closed if the method or response is unsupported. A synthetic subprocess test drives the real installed SDK control protocol without launching Claude or sending a prompt; this is not live CLI acceptance. There is no arbitrary task-output file read or dependency upgrade. TaskOutput/TaskStop availability alone does not prove background task management is complete. Live CLI/model, restart, sleep/wake, Rewind and Desktop acceptance remains pending; no formal daemon refresh was performed.

## Session-local Cron / Loop

Use the CLI's existing `CronCreate`, `CronList`, `CronDelete`, `ScheduleWakeup`
and `/loop`; there is no LeileiOS timer service, cron table or recovery replay.
An explicit human `/loop` is dispatched as a native skill on the existing writer.
Ordinary prompts, attachments, silence wakes and mid-turn input retain literal
delivery with per-message `client_composed: true`. A prompt supplied by a wake
cannot invoke `/loop` merely by starting with that text.

Before model inference, `UserPromptSubmit` admits only explicitly stamped
`schedule_wakeup` / `loop_wakeup` triggers with the current native session and a
bounded nonempty `prompt_id`. Subagent triggers, missing provenance, duplicates
and retired writers fail closed. User/SDK input and existing system/poll task
notifications keep their existing paths. Older CLIs can omit `source`: an exact
literal foreground hook may consume one pending ticket from an already admitted
input (including mid-turn input). It cannot reuse that ticket after the hook has
run. Native schedule creation is refused until this writer has observed stamped
hook provenance, while list/delete/stop and ordinary legacy chat remain available.
This is compatibility for ordinary input, not support for unstamped native timers;
a preexisting legacy timer with identical text overtaking the first foreground
hook cannot be absolutely distinguished by that older schema. No transcript
parsing or historical task replay attempts to repair that ambiguity.
The SDK control callback can overtake consumption of the preceding result, so
admission waits for that exact foreground boundary and durable acknowledgement,
then checks the existing surviving-branch/listener/session fence. A new foreground
reservation, handoff or checkpoint change during the check denies it.

Admission and its boundary wait share a two-second deadline. Per writer, at most
64 scheduled admission attempts are allowed, at least 60 seconds apart, within
seven days of opening that writer; denied/uncertain attempts are not replayed.
These are aggregate writer bounds, not per-job quotas or a billing guarantee.
Budget exhaustion does not cancel the CLI's stored task: a later trigger is
blocked, while ordinary chat, `CronList`, `CronDelete` and `ScheduleWakeup(stop)`
remain available. Creating another schedule does not reset these bounds. Each
individual invocation can still consume the model's normal turn budget.

Native scheduling owns persistence, cancellation, expiry and missed-fire handling;
this adapter neither scans native task files nor promises restart recovery. A
closed daemon cannot run local timers. Resuming a native session may restore
CLI-owned schedules according to the installed CLI's own policy. Rewind, fork,
handoff, lease loss and unknown delivery retain existing writer retirement and
receipt fences. Background output uses the same durable receipt/outbox and
continuation cursor as Bash/Monitor results, without inventing a visible user
message. SDK-internal queued timer IDs in an interrupt receipt are ignored for
user-input attribution; they are not reported as user messages or as cancelled.

### Wake cleanup boundary

Modern silence wakes already reserve as same-session resumes when the listener
advertises persistent sessions. The initial fork preparation and legacy executor
remain necessary for older listeners, missing generation evidence, capacity and
unsupported branch operations. They are compatibility paths, not another timer
engine. Remove them only after real daemon/device/handoff acceptance establishes
that their consumers can be retired. This change removes stale claims that the
daemon never calls the persistent host; it does not remove ordinary fork/edit/retry
or delete native session history, stored schedules or recovery receipts.

Offline evidence covers native input and hook serialization through the pinned
SDK with a synthetic CLI, boundary/commit races, denial and execution bounds.
It does not prove the real CLI has enabled a particular scheduling tool, that a
live job fires/cancels, or that sleep/restart restores it. Those remain explicit
live acceptance checks after an authorized daemon refresh. No model call,
production mutation, deployment or daemon restart is part of these tests.

Reference: [Claude Code scheduled tasks](https://code.claude.com/docs/en/scheduled-tasks).

Task-state observers are nonfatal and see committed membership before they can issue reentrant controls; one failing subscriber cannot prevent process cleanup or later subscribers. Local handles fence control admission and stale responses. They cannot add a run ID to the SDK's ID-only `stopTask` RPC: replacement inside the external process after dispatch remains an SDK boundary, not a proven atomic run-targeting guarantee.


Controlled tests do not establish the actual CLI's result after a foreground interrupt. If the provider returns an error instead of a successful result, the existing failure path still closes the writer rather than claiming background preservation. Real CLI interruption, restart/sleep/wake and handoff acceptance remain required before retiring the old fallback paths.
