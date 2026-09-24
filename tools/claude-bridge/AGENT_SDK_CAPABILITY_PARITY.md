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
| Compact | PENDING | Observe compact lifecycle/boundary and retain canonical history unchanged |
| Model selection | CONTRACT | Real SDK turn executes selected model and applied model is read back |
| Thinking / effort | CONTRACT | Capability validation + applied settings/readback for supported combinations |
| Runtime model switch | PENDING | Persistent Query changes model without changing logical conversation identity |
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
