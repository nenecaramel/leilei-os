# Native Live official tool acceptance (SDK 0.3.286)

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

`AgentSdkTurnHandle` ends the input stream on a terminal result and closes the query at cleanup. The Mac daemon remaining alive does not keep that SDK session alive.

- Session-scoped CronCreate/ScheduleWakeup and Monitor cannot be advertised as reliable idle background execution with the current per-turn lifecycle. Retaining a query would also require explicit idle event ownership, cancellation, session handoff and quota controls; this change does not silently implement that new lifecycle.
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
