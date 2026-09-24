# Claude Code → Agent SDK capability parity

Date: 2026-09-24

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
- **PRODUCT** — wired through LeileiOS Runtime and, where applicable, visible
  through a native product surface.

A capability is not considered migrated merely because upstream documentation
says the SDK supports it.

| Capability | Current level | Required LeileiOS acceptance |
| --- | --- | --- |
| New session | REAL SDK | Real SDK returns provider session + normalized terminal result |
| Resume session | REAL SDK | Real SDK preserves provider session identity |
| Fork session | REAL SDK | Real SDK creates a distinct provider session from the canonical parent checkpoint |
| Abort / hard stop | REAL SDK | Real SDK active Query close/abort maps to `ABORTED` and interrupts an in-flight Bash turn; later SDK interrupt still requires timeout + hard-stop fallback |
| Failure mapping | REAL SDK | Real SDK invalid-session failure maps to `CLAUDE_PROCESS_FAILED` without pretending canonical success |
| Claude Code system prompt | CONTRACT | Real SDK smoke proves Claude Code preset is active |
| CLAUDE.md | REAL SDK | Controlled project fixture proves project memory is loaded |
| user / project / local settings | REAL SDK (partial) | `project` + `local` controlled fixtures proved applied; `user` source is selected but user-level content is intentionally not mutated by smoke |
| Skills | PENDING | Enumerate/load controlled skill and observe execution/event evidence |
| Slash commands | PENDING | Enumerate/execute supported command without parsing terminal UI |
| Subagents | PENDING | Spawn controlled subagent; observe structured progress/result events |
| Plugins | PENDING | Load/reload controlled local plugin and observe status |
| MCP | PENDING | Connect controlled MCP server; call tool; observe structured tool result |
| Hooks | PENDING | Controlled hook fires at expected lifecycle boundary |
| Read | REAL SDK | Read controlled fixture file and observe tool event/result |
| Write | PENDING | Write controlled temp file with explicit permission policy and verify bytes |
| Edit | PENDING | Edit controlled temp file after read-state requirements and verify diff |
| Bash | REAL SDK | Run inert controlled command and verify stdout |
| Glob / Grep | PENDING | Query controlled fixture tree and verify results |
| Permission callbacks | PENDING | Permission request reaches host callback and decision is honored |
| AskUserQuestion | PENDING | Host receives structured question/options and can answer programmatically |
| Context usage | REAL SDK | `getContextUsage()` structured readback succeeds while Query is live; Runtime persistence/UI wiring remains later |
| Compact | REAL SDK | Manual `/compact`, compact boundary, PreCompact/PostCompact, generated summary, same-session continuation, and durable-marker continuity all passed on the real SDK |
| Model selection | REAL SDK | Selected model executes and `getSettings().applied.model` matches the requested per-turn model |
| Thinking / effort | REAL SDK (partial) | Applied effort readback is proven for Sonnet 5 xhigh and Opus 5.5 medium; adaptive thinking is accepted by the query contract, but exact applied thinking is not independently exposed and discovery aliases may be incomplete |
| Runtime model switch | REAL SDK | Same provider session switches Sonnet 5 → Opus 5.5 across turns while runtime-applied model/effort readback changes and provider session identity remains stable |
| Background task state | PENDING | Structured background task membership/progress is observed |
| Thinking token usage | PENDING | Usage readback reaches Runtime observability without becoming canonical message content |
| Interrupt current turn | REAL SDK (raw capability) | Query.interrupt() interrupts an in-flight Bash turn and preserves same provider session continuity; transport/runtime projection remains next |
| Normalized event compatibility | REAL SDK | Real SDK Read/Bash `tool_use` and two `tool_result` blocks survive normalization with raw/normalized count parity |
| Subscription-auth boundary | REAL SDK | Self-hosted Mac smoke succeeds with existing Claude login and no `ANTHROPIC_API_KEY` |
| Default Mac daemon transport | REAL SDK | Daemon defaults to Agent SDK through one shared factory, preserves explicit headless rollback, and passes real foreground/background executor smoke |
| Canonical authority | PRODUCT | Provider session/transcript can be discarded without losing LeileiOS product truth |

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
