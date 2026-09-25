# Claude Code → Agent SDK capability parity

Date: 2026-09-25

This checklist governs the LeileiOS migration from `claude -p` to
`@anthropic-ai/claude-agent-sdk`.

The target is not terminal-UI parity. The target is to preserve the Claude
Code capabilities that LeileiOS needs while replacing Anthropic's terminal UI
with LeileiOS Runtime + native iOS surfaces.

Canonical Ledger remains authoritative. Claude / Agent SDK session state is
disposable provider execution state.

## Acceptance levels

- **CONTRACT** — LeileiOS adapter/unit contract exists.
- **REAL SDK** — verified against the pinned real SDK on the Mac.
- **RUNTIME** — wired through the durable LeileiOS production Runtime;
  native presentation may still wait for the single UI / Productization task.
- **PRODUCT** — wired through LeileiOS Runtime and, where applicable, visible
  through a native product surface.
- **DEFERRED** — intentionally not a current core gate; the product decision
  and authority boundary are explicit rather than accidentally missing.

A capability is not considered migrated merely because upstream documentation
says the SDK supports it. The table below is the current truth; the dated
slice sections later in this file are historical acceptance evidence and may
describe an earlier pre-integration state.

| Capability | Current level | Required LeileiOS acceptance |
| --- | --- | --- |
| New session | RUNTIME | Agent SDK is the default Mac transport; production foreground can create a provider session |
| Resume session | REAL SDK | Real SDK preserves provider session identity; native/live product continuation currently uses exact checkpoint fork semantics rather than exposing resume as product identity |
| Fork session | RUNTIME | Retry/Edit and historical continuation fork from the exact canonical parent checkpoint into a distinct provider session |
| Abort / hard stop | REAL SDK | Hard abort remains the accepted fallback; product control is kept distinct from graceful interrupt |
| Failure mapping | RUNTIME | Provider/runtime failures stay bounded and cannot be finalized as canonical success |
| Claude Code system prompt | CONTRACT | Claude Code preset is configured; an independent semantic fingerprint/readback is still absent |
| CLAUDE.md | REAL SDK | Controlled project fixture proves project memory is loaded |
| user / project / local settings | REAL SDK (partial) | project + local fixtures are proven; user source is selected but user-level content is intentionally not mutated by smoke |
| Skills | PENDING REAL SDK | Controlled project-Skill smoke is now checked in; run it on the Mac before claiming parity |
| Slash commands | DEFERRED | Normal user turns deliberately remain verbatim; slash-command dispatch must be an explicit non-verbatim Runtime control rather than magic user-text parsing |
| Subagents | PENDING REAL SDK | Controlled project-subagent smoke is now checked in; require structured delegation evidence |
| Plugins | PENDING | Load/reload a controlled local plugin and observe status before claiming parity |
| MCP | PENDING REAL SDK | Controlled in-process SDK MCP smoke is checked in; require a real qualified MCP tool call + hidden handler sentinel before claiming parity |
| Hooks | PENDING REAL SDK | Controlled local PostToolUse hook smoke is now checked in |
| Read | REAL SDK | Read controlled fixture file and observe tool event/result |
| Write | REAL SDK | Real permission smoke proved deny plus allow-with-rewritten Write bytes |
| Edit | PENDING REAL SDK | Controlled filesystem parity smoke is now checked in |
| Bash | REAL SDK | Run inert controlled command and verify stdout |
| Glob / Grep | PENDING REAL SDK | Controlled filesystem parity smoke is now checked in |
| Streaming output | RUNTIME | Partial text is normalized, durably relayed, owner-scoped, and terminal result remains authoritative |
| Permission callbacks | RUNTIME | Real SDK deny/allow-rewrite is proven and production uses durable owner/listener-scoped interactions |
| AskUserQuestion | RUNTIME | Real SDK answer round-trip is proven and production uses durable owner/listener-scoped interactions |
| Mid-turn user input | RUNTIME | Same-query steering is proven and production uses durable exact-turn controls |
| Context usage | RUNTIME | Interactive foreground usage is sampled, bounded, persisted in runtime metadata, and readable by turn |
| Compact | RUNTIME | Manual compact is REAL SDK; deterministic 75% turn-boundary auto-compact is deployed, with real >75% production acceptance still pending |
| Model selection | RUNTIME | Requested selection is persisted; interactive applied-model readback is bounded and persisted |
| Thinking / effort | RUNTIME (partial) | Applied effort is readable/persisted; exact applied thinking is not independently claimed because SDK has no unambiguous readback |
| Runtime model switch | REAL SDK + RUNTIME contract | Same provider session model switch is REAL SDK; production per-turn selection/readback is wired, cross-device switch acceptance remains |
| Execution readback | RUNTIME | requested/applied/capability readback is persisted; raw local SDK errors collapse to READBACK_UNAVAILABLE |
| Background task / subagent progress | RUNTIME + PENDING REAL SDK | Production durable task-event contract now projects Agent SDK task lifecycle without becoming canonical chat truth; controlled real background-subagent smoke is checked in |
| Thinking token usage | CONTRACT | Context category pipeline is durable, but no independent real-SDK thinking-category acceptance is claimed |
| Interrupt current turn | RUNTIME | Graceful interrupt is REAL SDK and production exposes a durable exact-active-turn control; hard abort remains separate fallback |
| Normalized event compatibility | RUNTIME | Real tool event parity is proven; production foreground event stream persists bounded normalized events |
| Subscription-auth boundary | REAL SDK | Existing Claude subscription login succeeds with ANTHROPIC_API_KEY forbidden |
| Default Mac daemon transport | RUNTIME | Agent SDK is default with explicit headless rollback |
| Canonical authority | PRODUCT | Provider session/transcript/control state can be discarded without becoming product truth |

### Current integration audit — 2026-09-25

- #499 moved foreground execution onto the dedicated Agent SDK turn handle.
- #500 added the durable foreground normalized-event stream.
- #501 bound Permission and AskUserQuestion to durable exact-turn interactions.
- #502 bound mid-turn user input and graceful interrupt to durable exact-turn controls.
- #503/#504 added per-turn model/thinking/effort selection to the production relay/runtime path.
- #505 deployed deterministic turn-boundary auto-compact plus durable context/compaction metadata.
- #506 deployed bounded interactive execution readback and requested execution selection readback.
- #510 deployed bounded durable Agent SDK task lifecycle projection for background/subagent progress.
- Controlled REAL SDK smokes are now checked in for filesystem parity, in-process MCP, and a forced-background custom subagent task lifecycle. None of these new smokes count as REAL SDK PASS until run on the Mac subscription-auth environment.
- The remaining parity gate is therefore not Phase-2 transport plumbing. It is REAL execution of those controlled smokes, explicit plugin acceptance, and the separately deferred slash-command product semantics.


## Remaining controlled parity smokes — pending REAL SDK

### MCP

- `smoke:agent-sdk-mcp` creates a disposable in-process SDK MCP server with one hidden-sentinel tool.
- The sentinel is unavailable to the parent prompt; acceptance requires exactly one handler invocation, a structured qualified `mcp__...` tool-use event, and an exact terminal echo of the tool result.
- The smoke keeps existing Claude subscription auth and rejects `ANTHROPIC_API_KEY`.
- Passing this proves the Agent SDK host can carry SDK-owned MCP tools. Product-specific remote MCP trust/credential policy remains a separate runtime configuration concern.

### Background subagent task lifecycle

- `smoke:agent-sdk-background-task` defines a custom subagent with `background: true` and enables `agentProgressSummaries`.
- Acceptance requires real `task_started` and terminal `task_notification` system events from SDK 0.3.281, then runs those raw messages through the production `ClaudeEventNormalizer` and requires normalized `task` started / notification phases.
- The parent must receive the subagent-only hidden sentinel, proving the delegated background task actually completed.
- Additional `task_progress / task_updated / background_tasks_changed` frames are recorded when emitted but are not required for a very short deterministic task.
- Durable production projection intentionally stores bounded structured task state and omits local output-file paths / raw error text.

## Compaction discipline

LeileiOS decides **when** to compact; Claude / Claude Code decides the compact
content. The initial experimental policy is a turn-boundary trigger around
70–80% context usage, not a model-prompt guess and not reliance on an
undocumented provider threshold.

Every compact must remain observable: context usage, trigger reason, compact
source, boundary, summary/lifecycle, and fallback/failure. Compact never
deletes Canonical Ledger history and is never the long-term-memory authority.

## UI direction

Structured Runtime capability should eventually map to native LeileiOS
surfaces: file activity, diffs, command/stdout, permission and question
controls, thinking/execution state, subagent/background progress, context
usage, compact lifecycle, and model/thinking/effort selection.

Do not redesign existing Chat/Composer while transport parity is still being
established.


## Accepted real-SDK evidence — 2026-09-24

- #477 exact head `828649244eea5c103cfc5b12fac21122d47355c9`: new → resume → fork PASS with existing Claude subscription login.
- #478 exact head `d9f84b9443b2c8974f457695ea89d6adc52a43cf`: capability smoke PASS.
- #478 observed Read + Bash tool use, 2 raw tool-result blocks, 2 normalized tool-result blocks, and live `getContextUsage()` structured usage.
- The smoke intentionally leaves user-level settings content untouched; selecting `user` as a setting source is verified at invocation, but user-setting content semantics are not yet fixture-tested.
- Claude Code preset is configured on the real SDK query path, but no independent semantic fingerprint/readback has yet been added for the exact preset contents; keep that row at CONTRACT until such evidence exists.


## Compaction observability slice — pending real smoke

- Stable context-usage projection and a pure turn-boundary advisory now exist; default experimental threshold is 75%, configurable only within the agreed 70–80% band.
- The advisory never executes `/compact`; automatic compaction remains disabled until real acceptance.
- `system/compact_boundary` now has a dedicated normalized `compaction` event with trigger, pre/post tokens, duration, and preserved-segment metadata.
- The real smoke registers `PreCompact` and `PostCompact`; `PostCompact.compact_summary` is the intended summary-observability path.
- Internal `/compact` dispatch must use non-verbatim prompt handling. Normal user turns may stay `verbatimPrompts: true`; the Runtime-owned compact control path explicitly uses `verbatimPrompts: false` because verbatim mode intentionally bypasses slash-command dispatch.


## Accepted compaction evidence — 2026-09-24

- #479 exact head `98cae1570a4ba3fcdfb435aa9f4e438a00e3af0e`: real Agent SDK manual-compaction smoke PASS.
- Same provider session survived manual `/compact`.
- Context usage before compact: 28,464 / 1,000,000 tokens (3%); after compact: 16,919 / 1,000,000 tokens (2%).
- Messages category dropped from 15,358 to 3,813 tokens.
- SDK exposed a 33,000-token `Autocompact buffer` category in structured context usage.
- Normalized compact boundary reported manual trigger, pre_tokens 28,485, post_tokens 1,302, duration 10,123 ms, plus preserved-segment UUIDs.
- PreCompact and PostCompact each fired once; PostCompact summary length was 2,487 characters and contained the durable marker.
- Post-compact resume returned the exact durable marker.
- This does not enable automatic compaction. Threshold evaluation remains advisory-only until transport/runtime integration is separately accepted.


## Transport integration slice — pending real smoke

- `AgentSdkClaudeTransport.sendNew/resume/fork` now capture the latest live `getContextUsage({ detail: "summary" })` sample observed before terminal result, project it into the stable LeileiOS shape, and return a pure `compactionAdvisory`.
- Context-usage sampling is fail-soft: foreground execution still completes if observability fails; the error is returned separately.
- `AgentSdkClaudeTransport.compact(sessionId)` is the dedicated Runtime-owned non-verbatim `/compact` control path. It requires same-session continuity, a normalized compact boundary, and captures PreCompact/PostCompact lifecycle data including the generated summary.
- The advisory remains non-mutating. No threshold-triggered automatic compact is enabled by this slice.
- Real acceptance for this slice must call the transport methods themselves, not raw SDK `query()`, and prove context usage → explicit compact → same-session post-compact continuity.


## Accepted transport compaction integration — 2026-09-24

- #481 exact head `67dd7f28f0da86c132eb3260fefd5381c2539c41`: REAL SDK transport-level compaction PASS.
- `AgentSdkClaudeTransport` itself now returns stable context usage plus a deterministic compaction advisory on normal turns.
- `compact(sessionId)` preserved provider session identity, emitted a normalized manual compact boundary, captured one PreCompact and one PostCompact hook, and returned a generated compact summary.
- Accepted boundary evidence: pre_tokens 15,739 → post_tokens 1,195; duration 12,645 ms.
- Accepted summary evidence: 2,098 chars and contained the durable marker.
- Post-compact resume returned the exact durable marker.
- Automatic threshold-triggered compaction remains disabled; daemon/default transport is still unchanged.

## Model / effort readback slice — pending real smoke

- Explicit LeileiOS execution selection continues to come from the product allowlist; SDK discovery is evidence, not product authority.
- For turns with an explicit execution selection, `AgentSdkClaudeTransport` now samples live `Query.getSettings()` plus `Query.supportedModels()` while the Query is still open.
- Stable `executionReadback` separates `requested` from `applied`; `applied.model` and `applied.effort` come from SDK runtime settings readback.
- `supportedModels()` is projected as capability evidence (`supportsEffort`, `supportedEffortLevels`, `supportsAdaptiveThinking`, fast/auto support). Missing entries do not invalidate an applied model because SDK discovery has historically omitted valid aliases.
- Real acceptance must prove the same provider session can run one turn on Sonnet 5 + adaptive + xhigh and the next turn on Opus 5.5 + adaptive + medium, with runtime-applied model/effort readback changing accordingly.
- Thinking mode is passed through the accepted query contract and capability support is read from SDK model metadata; exact applied thinking mode is not independently claimed until the SDK exposes an unambiguous runtime readback for it.

## Accepted model / effort readback evidence — 2026-09-24

- #482 executable exact head `afe4fd00f1a36d76c329f00a2f67089c54c355f6`: REAL SDK model/effort readback smoke PASS with `@anthropic-ai/claude-agent-sdk@0.3.281` and existing Claude subscription login.
- Turn 1 requested Sonnet 5 + adaptive + xhigh; live `getSettings().applied` returned `claude-sonnet-5` + `xhigh`.
- Turn 2 resumed the same provider session, requested Opus 5.5 + adaptive + medium; live `getSettings().applied` returned `claude-opus-5-5` + `medium`.
- Provider session identity remained `cc585fcb-1311-4684-9a18-2210944c576d` across the model switch.
- `supportedModels()` returned five discovery entries (`default`, `opus`, `claude-fable-5-1[1m]`, `sonnet`, `haiku`) and did not expose an exact/display alias match for either requested model, so per-model `capability` was null. This is accepted evidence of incomplete discovery aliases, not evidence that the applied runtime model failed.
- LeileiOS product allowlist remains authoritative for product selection; SDK discovery remains capability evidence; `getSettings().applied` is the execution readback for the actual turn.
- Exact applied thinking mode is still not independently claimed because the SDK does not expose an unambiguous runtime readback for it.


## Abort / failure mapping slice — pending real smoke

- Existing adapter/unit coverage already maps SDK terminal failures and query exceptions to `CLAUDE_PROCESS_FAILED`, and `abort()` closes the active Query then reports `ABORTED`.
- Real failure acceptance deliberately resumes a random nonexistent provider session through `AgentSdkClaudeTransport.resume()`; the real SDK must fail and the adapter must surface `CLAUDE_PROCESS_FAILED`.
- Real abort acceptance starts a Bash command that sleeps for 30 seconds and would create `abort-finished.txt` only after completion. The smoke waits until a normalized Bash `tool_use` is observed, calls `AgentSdkClaudeTransport.abort()`, requires `ABORTED`, and requires that the marker file was never created.
- This slice verifies parity hard-abort via Query `close()`; it does not claim the later mid-turn SDK `interrupt()` capability.
- Acceptance still uses the existing Claude subscription login and refuses `ANTHROPIC_API_KEY`.


## Accepted abort / failure mapping evidence — 2026-09-24

- #483 real SDK smoke PASS with `@anthropic-ai/claude-agent-sdk@0.3.281` and existing Claude subscription login.
- Failure mapping: resuming nonexistent provider session `95620d53-1a71-487f-a3b1-9862a4180a70` failed in the real SDK and surfaced through `AgentSdkClaudeTransport` as `CLAUDE_PROCESS_FAILED`.
- Abort: a real Bash turn was observed before cancellation; `AgentSdkClaudeTransport.abort()` closed the active Query and surfaced `ABORTED`.
- Abort provider session: `5e1fb88f-5a5e-4a98-b91b-953dd0c72f1e`.
- The 30-second Bash completion marker was not created, proving the in-flight command did not finish after abort.
- Abort completed in 6,940 ms and emitted 4 normalized events before termination.
- This proves the current parity hard-abort path via Query `close()`; it does not claim the later SDK `interrupt()` capability.


## Default daemon transport slice — pending real smoke

- The Mac daemon now resolves Claude transport through one shared factory instead of constructing `HeadlessClaudeTransport` directly.
- Default selection is `agent_sdk`; `LEILEI_NATIVE_LIVE_CLAUDE_TRANSPORT=headless` is the explicit rollback path.
- No runtime protocol, Canonical Ledger, branch, relay, reservation, or durable authority semantics change in this slice.
- Daemon logging exposes the selected transport kind for local observability.
- Real acceptance uses the exact same factory as the daemon, then passes the selected Agent SDK runtime through `NativeLiveMacRuntimeExecutor` and `NativeLiveMacBackgroundModelExecutor`.
- The smoke is local to the Mac runtime and performs no relay or canonical production mutation.
- Acceptance requires existing Claude subscription login, no `ANTHROPIC_API_KEY`, a successful foreground new turn with normalized final text/provider session, and a successful background pure-model turn.


## Accepted default daemon transport evidence — 2026-09-24

- #484 real SDK daemon-level smoke PASS with `@anthropic-ai/claude-agent-sdk@0.3.281` and existing Claude subscription login.
- Shared daemon transport factory selected `agent_sdk` by default and instantiated `AgentSdkClaudeTransport`.
- Explicit rollback selector still resolves `LEILEI_NATIVE_LIVE_CLAUDE_TRANSPORT=headless` to the legacy headless adapter.
- Foreground path passed through `NativeLiveMacRuntimeExecutor`: status `success`, provider session `5296d672-3099-4759-a1d0-b82307e4d6a4`, exact final marker `LEILEIOS_DAEMON_AGENT_SDK_FOREGROUND`, 5 normalized events.
- Background pure-model path passed through `NativeLiveMacBackgroundModelExecutor`: status `success`, task kind `distillation`, exact final marker `LEILEIOS_DAEMON_AGENT_SDK_BACKGROUND`.
- The smoke performed no relay or canonical production mutation.
- The first-phase parity gate is now closed: subscription auth, new/resume/fork, normalized tool events, failure mapping, abort/hard-stop, and daemon default transport all have real SDK evidence.


## Graceful interrupt capability slice — pending real smoke

- This slice is raw SDK acceptance only. It does not change the daemon/runtime protocol or Canonical Ledger semantics.
- The smoke uses streaming input so the SDK control channel stays live. The Bash command writes a STARTED marker, sleeps for 30 seconds, then would write a FINISHED marker; the smoke waits for both the structured Bash `tool_use` and the STARTED marker before calling `Query.interrupt()`.
- Acceptance requires a typed interrupt receipt from SDK 0.3.281, STARTED=true and FINISHED=false for the interrupted Bash command, and a successful follow-up resume on the same provider session.
- The interrupted turn's terminal subtype/error shape is recorded rather than assumed; provider quirks must be observed before LeileiOS chooses its stable interrupt projection.
- Hard abort via Query `close()` remains the fallback already accepted in #483.
- Known upstream history includes interrupt/control-channel behavior changes, so LeileiOS must not infer graceful-interrupt semantics from documentation alone.


## Accepted graceful interrupt capability evidence — 2026-09-24

- #485 raw SDK interrupt smoke PASS with `@anthropic-ai/claude-agent-sdk@0.3.281` and existing Claude subscription login.
- Provider session `6309bd56-9b2e-4d58-9e07-e4c856e17c7e` emitted a real Bash `tool_use`; the command wrote its STARTED marker before `Query.interrupt()` was called.
- `Query.interrupt()` returned receipt `{"still_queued":[]}`.
- STARTED marker was present and FINISHED marker was absent, proving the in-flight Bash command was actually interrupted after starting.
- The interrupted turn emitted terminal subtype `error_during_execution`, `is_error=true`, with diagnostic `[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use`; the async iterator also threw `Claude Code returned an error result: ...`.
- That provider error shape is treated as observed interrupt fallout, not as evidence that `interrupt()` failed, because the control receipt succeeded and the tool was stopped.
- Resuming the same provider session succeeded with exact marker `LEILEIOS_INTERRUPT_SESSION_CONTINUITY`; resumed session identity remained unchanged.
- This is still raw SDK capability evidence. LeileiOS has not yet projected graceful interrupt into the stable transport/runtime contract; hard abort via `close()` remains the accepted fallback.


## Dedicated turn-handle foundation — pending real smoke

- The first #486 approach is abandoned: retrofitting the phase-1 Promise transport itself into a streaming interruptable session produced repeated real hangs and is not an accepted architecture.
- The accepted #484 `AgentSdkClaudeTransport` remains unchanged on this branch.
- Phase 2 now introduces a separate `AgentSdkTurnHandle` lifecycle: one long-lived SDK Query owns `completion`, `interrupt()`, `abort()`, raw events, normalized events, and provider session identity.
- This preserves the architectural boundary already written in Runtime/Mind: mid-turn control belongs to a persistent turn/session handle instead of being hidden inside `sendNew()/resume()`.
- The first real handle smoke intentionally mirrors the already accepted #485 raw streaming-query shape before adding more product semantics.
- Acceptance requires a real Bash STARTED marker, successful typed interrupt receipt, FINISHED=false, stable `INTERRUPTED` projection, and successful same-provider-session resume through another turn handle.
- The smoke has a hard 60-second total watchdog plus a 5-second force-exit fallback, so a provider/SDK lifecycle bug cannot leave the local terminal hanging indefinitely again.
- This slice does not yet wire the handle into daemon/cross-device protocol, permission UI, or canonical turn semantics.


## Turn-handle startup ordering fix

- A second real smoke attempt exposed a startup-order race in the first handle draft: the constructor began consuming the SDK Query immediately, while the smoke could only attach its normalized-event listener after the factory returned. A fast provider could therefore emit the first Bash tool event before the listener existed.
- The handle lifecycle is now explicit: create handle -> attach listeners -> call `handle.start()` -> await `completion`.
- Unit coverage now proves no SDK iterator consumption or normalized events occur before explicit `start()`.
- The smoke prints every lifecycle stage to stderr, so any future stall identifies the exact stage instead of appearing as a silent hang.


## First real turn-handle smoke finding — Bash permission parity

- The first real turn-handle smoke reached normalized Bash `tool_use` but never created the STARTED marker.
- This was not a turn-handle lifecycle failure: the raw #485 interrupt smoke had explicitly set `allowedTools: ["Bash"]`, while the first turn-handle smoke omitted that equivalent permission condition.
- The smoke now carries the same explicit Bash allowance as #485 so the architectural comparison is like-for-like.
- If the STARTED marker still does not appear within 5 seconds, the smoke hard-aborts immediately and fails with a focused permission/execution diagnostic instead of waiting for the 60-second total watchdog.


## Second real turn-handle smoke finding — finite input plus bidirectional control

- The second real smoke passed the interrupted turn far enough to reach graceful interrupt and then stalled only on the normal same-session resume at `start_resume_consumption`.
- Root cause: the first handle draft kept its async input iterable open until terminal result. That works for an interrupted turn because `interrupt()` releases the input, but a normal turn can deadlock: the host waits for result before ending input while the SDK waits for input completion before final result.
- The handle now uses a finite one-message async iterable. It does not hold the input generator open itself.
- Bidirectional control liveness is supplied explicitly through SDK query options such as `canUseTool`; the handle forwards that callback but does not own product permission policy.
- The real smoke uses a pass-through `canUseTool` callback for both the interrupted turn and the continuity resume, with Bash explicitly allowed only for the interrupted turn.
- Unit coverage now proves the async input stream ends after exactly one user message and that bidirectional query options are forwarded unchanged.


## REAL SDK dedicated turn-handle acceptance — PASS

Validated on macOS against `@anthropic-ai/claude-agent-sdk@0.3.281` using the existing Claude subscription login.

Observed real smoke result:

- architecture: `dedicated_agent_sdk_turn_handle`
- graceful interrupt projected as LeileiOS `runtimeCode: "INTERRUPTED"`
- provider session: `0baff5d3-2231-4389-8dc3-8b91ab80353a`
- interrupt receipt: `{ still_queued: [] }`
- normalized Bash `tool_use` observed
- STARTED marker created; FINISHED marker not created, proving the in-flight Bash command was interrupted
- provider terminal remained the expected SDK fallout: `error_during_execution` with `is_error: true`
- same provider session successfully resumed after interrupt
- resumed final text: `LEILEIOS_TURN_HANDLE_CONTINUITY`
- accepted phase-1 `AgentSdkClaudeTransport` remained untouched

Acceptance meaning:

- a dedicated long-lived Agent SDK turn handle can own graceful interrupt without retrofitting phase-1 Promise-returning transport semantics;
- finite one-message streamed input avoids the normal-resume deadlock;
- bidirectional SDK control is kept alive through explicit query callbacks such as `canUseTool`;
- graceful interrupt and hard abort remain distinct runtime semantics;
- this is branch-level runtime capability acceptance, not a main/production rollout claim.


## Phase 2 permission callback contract — branch implementation

This slice moves permission handling out of raw `queryOptions.canUseTool` and into a stable LeileiOS turn-handle contract without adding streaming or mid-turn user-message semantics.

Contract:

- `createAgentSdkTurnHandle({ permissionHandler })` installs a single SDK `canUseTool` adapter before the Query starts.
- The host receives a normalized permission request with `toolName`, structured `input`, `toolUseId`, optional `requestId`, `agentId`, path/reason/display metadata, permission suggestions, and matched ask-rule evidence.
- SDK cancellation stays explicit: the host receives `{ signal }` separately from the durable/request-shaped metadata.
- LeileiOS decisions are deliberately smaller than the raw SDK result:
  - `{ decision: "allow", updatedInput? }`
  - `{ decision: "deny", message, interrupt? }`
- The adapter maps these to SDK `behavior: "allow" | "deny"`.
- This slice does **not** expose persistent permission mutation / remembered rules. SDK `updatedPermissions` and out-of-band `null` control responses are intentionally deferred until a later product/UI contract.
- `permission-request`, `permission-decision`, and `permission-error` events are emitted on the same turn-handle event surface; listeners can be attached before explicit `handle.start()`.

Deterministic safety boundary:

- `permissionHandler` cannot be combined with raw `queryOptions.canUseTool`.
- It cannot be combined with non-empty `allowedTools`, because pre-allowed tools can bypass the callback.
- It cannot be combined with `permissionMode: "bypassPermissions"` or `allowDangerouslySkipPermissions: true`.
- Automatic allow/deny policy belongs inside the LeileiOS permission handler when this contract is used, so the callback surface remains truthful about which tool requests were actually evaluated.

REAL SDK acceptance smoke:

- run a denied Bash request and prove the target marker is not created;
- require a real structured permission callback with a non-empty `toolUseId` and cancellation signal;
- run a second Bash request whose allowed input is rewritten by the callback;
- prove the original marker is not created and the rewritten marker is created;
- record optional SDK `requestId` when present;
- keep existing Claude subscription auth and `@anthropic-ai/claude-agent-sdk@0.3.281`;
- no daemon / canonical / iOS / streaming / mid-turn-input changes in this slice.


## First real permission smoke finding — callback only runs for actual permission prompts

- The first real smoke asked Claude to use Bash under default permission policy and observed zero `permissionHandler` invocations.
- That result is expected SDK semantics, not an adapter failure: `canUseTool` is a permission-prompt callback, not a universal tool-use interceptor. A tool call that the active permission policy already permits does not have to invoke the callback.
- The REAL SDK acceptance smoke now deterministically creates a permission prompt with a scoped `PreToolUse` hook returning `permissionDecision: "ask"` for Bash. This is fixture-only; the LeileiOS permission contract itself does not force every tool call through the permission UI.
- Acceptance therefore proves: when Claude Code surfaces a permission request, LeileiOS receives it, can deny it, can allow it with rewritten input, and receives the SDK cancellation signal.


## Second real permission smoke finding — built-in PreToolUse is not a reliable force-ask fixture

- The second real smoke still observed zero permission callbacks after adding a scoped built-in Bash `PreToolUse -> permissionDecision: "ask"` fixture.
- This does not invalidate the LeileiOS permission adapter. The current Agent SDK line has an open upstream bug where `options.hooks.PreToolUse` can fail to fire for built-in tools; using that hook to manufacture a permission prompt therefore makes the smoke depend on a separate SDK hook bug.
- The acceptance smoke no longer relies on `PreToolUse` to force a prompt.
- It now exercises the SDK's native built-in `Write` permission path under `permissionMode: "default"` with `tools: ["Write"]` and no `allowedTools` / bypass shadowing.
- This mirrors an upstream-confirmed streaming-input shape where a one-message async iterable plus `canUseTool` receives the Write permission request.
- Deny acceptance proves the requested file is not written. Allow acceptance rewrites `Write.file_path` and `content`, then proves only the rewritten target is created.


## Third real permission smoke finding — in-workspace Write was not a deterministic prompt

- A native `Write` request inside the smoke `cwd` still completed without invoking `permissionHandler` on the user's macOS subscription-auth path.
- That means "use Write" is not by itself a deterministic permission fixture on the current installed/runtime policy; a tool can be exposed and used without necessarily producing a permission request.
- The next smoke moves the requested Write target to a sibling directory outside the query `cwd`, while keeping it inside one disposable temp root. This is intended to exercise a path-scoped permission boundary without touching user files.
- The smoke now pins Sonnet 5 / low effort / verbatim prompt delivery for reproducibility.
- If the callback is still not invoked, the failure prints the real init permission mode, observed tool_use blocks, error tool_results, result.permission_denials, and final text. The next decision will be based on that runtime evidence instead of another guessed fixture.


## Fourth real permission smoke finding — SDK callback reached; context key casing was wrong

- The out-of-workspace Write smoke produced the decisive evidence: a real `Write` tool_use was emitted, the SDK attempted the permission round-trip, and the callback failed inside the smoke assertion with `Real SDK permission request must expose toolUseId.`
- The resulting tool error was `Tool permission request failed: Error: Real SDK permission request must expose toolUseId.`, and `result.permission_denials` contained the exact Write tool_use id/input. Therefore permission routing and the LeileiOS callback adapter were already active.
- Root cause was only context-key normalization. The Agent SDK callback uses `toolUseID` and `agentID` casing on the public callback options; the first LeileiOS adapter draft only read `toolUseId` / `agentId`.
- The adapter now accepts the real SDK casing plus camelCase/snake_case aliases, while continuing to expose stable LeileiOS `toolUseId`, `requestId`, and `agentId`.
- Unit coverage now locks the real `toolUseID` / `agentID` shape so this cannot regress.


## REAL SDK permission callback acceptance — PASS

Validated on macOS against `@anthropic-ai/claude-agent-sdk@0.3.281` using the existing Claude subscription login.

Observed deny path:

- one real `Write` permission request reached the LeileiOS `permissionHandler`;
- normalized `toolUseId`: `toolu_01SRJxYUE8YnaGDGuMJqMLyJ`;
- SDK `requestId`: `8c114695-5bfa-4f36-a353-0ec225155a2c`;
- SDK cancellation signal was present;
- LeileiOS returned `decision: "deny"`;
- denied marker was not created;
- final assistant text acknowledged the denial path.

Observed allow + input rewrite path:

- one real `Write` permission request reached the LeileiOS `permissionHandler`;
- normalized `toolUseId`: `toolu_01SpnVotVoQQucnkg2JrvPWh`;
- SDK `requestId`: `4868cc13-edb5-4f70-a0c8-acf2ef4b2514`;
- SDK cancellation signal was present;
- LeileiOS returned `decision: "allow"` with rewritten `file_path` / `content`;
- the original requested marker was not created;
- the rewritten target was created, proving the SDK executed the callback's `updatedInput`.

Acceptance meaning:

- the dedicated Agent SDK turn handle now has a real host permission boundary, not only raw `canUseTool` passthrough;
- the callback contract correctly normalizes Agent SDK `toolUseID` / `agentID` casing into stable LeileiOS fields;
- deny and allow-with-rewrite are both proven against real SDK tool execution;
- permission requests remain distinct from universal tool interception: only SDK permission prompts enter this callback;
- no persistent permission mutation, out-of-band null response, streaming expansion, mid-turn user input, daemon protocol, canonical semantics, or iOS behavior is added in this slice.


## Phase 2 streaming-output contract — branch implementation

This slice adds displayable assistant text streaming on top of the accepted dedicated Agent SDK turn handle without adding mid-turn user input.

Contract:

- `createAgentSdkTurnHandle({ streaming: true })` turns on Agent SDK `includePartialMessages: true`.
- `streaming: true` rejects an explicit contradictory `queryOptions.includePartialMessages: false`.
- Real Agent SDK `stream_event / content_block_delta / text_delta` frames normalize into the existing stable LeileiOS `partial_text` event:
  - `payload.delta`
  - `payload.accumulated_length`
- Consumers attach listeners before explicit `handle.start()`, preserving the already accepted turn-handle startup ordering.
- Completed assistant messages and the terminal result remain available as before; streaming is additive and does not replace terminal truth.
- The stable streaming contract intentionally includes displayable assistant text only. SDK `thinking_delta` frames are not promoted into LeileiOS `partial_text` or another reasoning stream in this slice.
- Permission callback, graceful interrupt, hard abort, provider session identity, canonical authority, daemon protocol, and iOS behavior are unchanged.

REAL SDK acceptance requires:

- at least one raw `stream_event`;
- at least one normalized `partial_text`;
- monotonically increasing accumulated length;
- concatenated normalized deltas reconstruct the terminal result text exactly for a deterministic no-tool prompt;
- same existing Claude subscription auth and pinned `@anthropic-ai/claude-agent-sdk@0.3.281`.


## REAL SDK streaming-output acceptance — PASS

Validated on macOS against `@anthropic-ai/claude-agent-sdk@0.3.281` using the existing Claude subscription login.

Observed real smoke result:

- architecture: `dedicated_agent_sdk_streaming_output`
- provider session: `78bdec91-1771-4316-b9fc-111a0fe7114c`
- raw SDK `stream_event` count: `14`
- normalized LeileiOS `partial_text` count: `9`
- streamed character count: `86`
- terminal text: `LEILEIOS_STREAM_ALPHA LEILEIOS_STREAM_BETA LEILEIOS_STREAM_GAMMA LEILEIOS_STREAM_DELTA`
- concatenated normalized deltas reconstructed terminal text exactly
- reasoning stream policy remained `text_deltas_only`

Acceptance meaning:

- `streaming: true` on the dedicated turn handle successfully activates Agent SDK partial messages;
- Agent SDK `stream_event/content_block_delta/text_delta` frames now project into stable LeileiOS `partial_text` events;
- `accumulated_length` is monotonic and terminal text remains the final authoritative turn result;
- thinking deltas are intentionally not exposed as displayable assistant streaming text;
- no mid-turn user input, canonical authority, daemon protocol, or iOS behavior is added in this slice.


## Phase 2 mid-turn user input contract — branch implementation

This slice adds a queued user-message path to the accepted dedicated Agent SDK turn handle. It is intentionally narrower than a full persistent multi-turn session abstraction.

Contract:

- `createAgentSdkTurnHandle({ midTurnInput: true })` uses a pushable async input iterable instead of the default finite one-message iterable.
- The initial prompt is queued first and remains the first SDK user message.
- Once `handle.start()` has begun, `handle.sendUserMessage(text)` can queue a nonblank additional user message while the same SDK Query is still active.
- Accepted mid-turn input returns `{ status: "queued" }`.
- Mid-turn input is rejected before start, after terminal completion, after hard abort, and once graceful interrupt has been requested.
- The input queue closes when the SDK turn emits its terminal result, on hard abort, on graceful interrupt, and in all terminal cleanup paths.
- The existing finite-input behavior remains the default when `midTurnInput` is false, so the already accepted normal-turn and resume semantics are unchanged.
- This slice does not assign canonical user-message identity or durable conversation authority to the provider input queue. Canonical Ledger remains authoritative.

SDK evidence informing this design:

- Agent SDK 0.3.274 fixed `getSessionMessages()` so a user message sent while Claude was running a tool is retained where Claude read it.
- Agent SDK 0.3.275 fixed fork/history handling for messages sent while Claude was working.
- The async iterable therefore remains the provider input channel for same-query steering; LeileiOS does not simulate steering by interrupting and restarting the turn.

REAL SDK acceptance requires:

- one real Bash tool call whose command creates STARTED, sleeps, then creates FINISHED;
- observe normalized Bash `tool_use`;
- wait until STARTED exists and prove FINISHED does not yet exist;
- queue the second user message through `handle.sendUserMessage()` while Bash is still running;
- let the Bash tool finish without calling `interrupt()` or restarting/resuming the provider session;
- require the terminal answer to follow the later user instruction exactly;
- same existing Claude subscription auth and pinned `@anthropic-ai/claude-agent-sdk@0.3.281`.

Hard boundaries:

- no canonical message write in this lower runtime layer;
- no daemon/cross-device protocol change yet;
- no iOS input UI semantics yet;
- no background-task preservation semantics are claimed;
- graceful interrupt remains a separate control from user steering.


## REAL SDK mid-turn user input acceptance — PASS

Validated on macOS against `@anthropic-ai/claude-agent-sdk@0.3.281` using the existing Claude subscription login.

Observed real smoke result:

- architecture: `dedicated_agent_sdk_mid_turn_input`
- provider session: `70445d71-1a51-4c7b-881e-109eca6c213b`
- real Bash `tool_use` observed
- STARTED marker existed before injection
- FINISHED marker did not yet exist when the second user message was queued
- `handle.sendUserMessage(...)` returned `{ status: "queued" }`
- Bash then completed normally and produced FINISHED
- terminal text: `LEILEIOS_MIDTURN_UPDATED`
- no `interrupt()`, provider restart, or resume was used
- same-turn steering: true

Acceptance meaning:

- the dedicated Agent SDK turn handle can accept a second user message while the same provider turn is active;
- the additional user message can steer the terminal answer after an in-flight tool call without cancelling that tool;
- the provider input queue is execution state only and does not become canonical conversation authority;
- graceful interrupt remains a separate control path;
- default finite one-message input behavior remains unchanged when `midTurnInput` is disabled.


## Phase 2 AskUserQuestion host round-trip — branch implementation

This slice closes the remaining `permission / AskUserQuestion` capability item by giving the dedicated turn handle a stable host question callback.

Contract:

- `createAgentSdkTurnHandle({ questionHandler })` installs an Agent SDK `canUseTool` dispatcher that routes `AskUserQuestion` to the host question callback.
- `questionHandler(request, { signal })` receives:
  - stable `toolUseId`, `requestId`, and `agentId`;
  - the raw structured `input`;
  - normalized non-empty `questions[]`, preserving option metadata such as labels, descriptions, previews, annotations, and multi-select flags when the SDK supplies them.
- LeileiOS question decisions are:
  - `{ decision: "answer", answers }`
  - `{ decision: "cancel", message }`
- An answer maps to SDK `behavior: "allow"` with `updatedInput: { ...input, answers }`.
- Cancellation maps to SDK `behavior: "deny"` without interrupting the provider turn.
- The turn-handle event surface emits `question-request`, `question-decision`, and `question-error`.
- If both `questionHandler` and `permissionHandler` are installed, `AskUserQuestion` is routed to the question handler first; other permission prompts continue through the permission handler.
- A question-only host fails closed for an unrelated permission prompt instead of silently auto-allowing it.
- Raw `queryOptions.canUseTool`, non-empty `allowedTools`, and permission bypass remain forbidden while host interactive callbacks own the SDK control path.

REAL SDK acceptance smoke:

- restrict the tool surface to `AskUserQuestion`;
- use plan mode to make the deterministic clarification turn natural;
- require exactly one question asking which theme to choose, with Light and Dark options;
- answer Dark through the LeileiOS `questionHandler`;
- require real `toolUseId`, `requestId`, and cancellation signal;
- require the same Query to continue and return the exact Dark marker;
- no resume, no interrupt, no canonical mutation, and no UI implementation in this slice.

The public Agent SDK already exposes `AskUserQuestion` and Anthropic's own demo uses the same `canUseTool -> updatedInput.answers` round trip. LeileiOS keeps that provider mechanism behind its own stable question contract rather than leaking the raw callback shape into product layers.


## REAL SDK AskUserQuestion acceptance — PASS

Validated on macOS against `@anthropic-ai/claude-agent-sdk@0.3.281` using the existing Claude subscription login.

Observed real smoke result:

- architecture: `dedicated_agent_sdk_ask_user_question`
- provider session: `fd107afd-585e-4f76-86eb-2ad9aeaa91f1`
- exactly one real `AskUserQuestion` request reached the LeileiOS `questionHandler`
- normalized `toolUseId`: `toolu_01BUX4qz8gTAVGX2nq9QFUFS`
- SDK `requestId`: `d5cad4ba-c5d1-4ac2-8439-038a9cad8677`
- SDK cancellation signal was present
- structured question: `Which theme should this smoke choose?`
- option labels included exactly the expected Light / Dark choices
- LeileiOS selected `Dark`
- same Query continued through `updatedInput.answers`
- terminal text: `LEILEIOS_ASK_USER_QUESTION_DARK`
- same-query round trip: true

Acceptance meaning:

- the dedicated Agent SDK turn handle now has a stable host question callback in addition to the stable permission callback;
- `AskUserQuestion` is routed to `questionHandler` before generic permission handling;
- structured question metadata stays available to the host while the provider-specific callback shape remains hidden below the runtime contract;
- answer delivery is proven against the real SDK through `updatedInput.answers`;
- cancellation signal, tool-use identity, and request identity are available to the host;
- no resume, interrupt, canonical mutation, daemon protocol, or iOS UI behavior is introduced by this slice.
