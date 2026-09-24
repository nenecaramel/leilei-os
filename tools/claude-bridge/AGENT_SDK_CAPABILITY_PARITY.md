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
| Abort / hard stop | CONTRACT | Real SDK close/abort maps to LeileiOS failure semantics; later interrupt has timeout + hard-stop fallback |
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
| Interrupt current turn | PENDING | Mid-turn interrupt works; startup/API-call edge cases fall back to timeout + hard stop |
| Normalized event compatibility | REAL SDK | Real SDK Read/Bash `tool_use` and two `tool_result` blocks survive normalization with raw/normalized count parity |
| Subscription-auth boundary | REAL SDK | Self-hosted Mac smoke succeeds with existing Claude login and no `ANTHROPIC_API_KEY` |
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
