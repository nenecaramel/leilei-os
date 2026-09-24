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
| New session | CONTRACT | Real SDK returns provider session + normalized terminal result |
| Resume session | CONTRACT | Real SDK preserves provider session identity |
| Fork session | CONTRACT | Real SDK creates a distinct provider session from the canonical parent checkpoint |
| Abort / hard stop | CONTRACT | Real SDK close/abort maps to LeileiOS failure semantics; later interrupt has timeout + hard-stop fallback |
| Claude Code system prompt | CONTRACT | Real SDK smoke proves Claude Code preset is active |
| CLAUDE.md | CONTRACT | Controlled project fixture proves project memory is loaded |
| user / project / local settings | CONTRACT | Controlled fixtures prove all three selected setting sources are applied |
| Skills | PENDING | Enumerate/load controlled skill and observe execution/event evidence |
| Slash commands | PENDING | Enumerate/execute supported command without parsing terminal UI |
| Subagents | PENDING | Spawn controlled subagent; observe structured progress/result events |
| Plugins | PENDING | Load/reload controlled local plugin and observe status |
| MCP | PENDING | Connect controlled MCP server; call tool; observe structured tool result |
| Hooks | PENDING | Controlled hook fires at expected lifecycle boundary |
| Read | PENDING | Read controlled fixture file and observe tool event/result |
| Write | PENDING | Write controlled temp file with explicit permission policy and verify bytes |
| Edit | PENDING | Edit controlled temp file after read-state requirements and verify diff |
| Bash | PENDING | Run inert controlled command and verify stdout |
| Glob / Grep | PENDING | Query controlled fixture tree and verify results |
| Permission callbacks | PENDING | Permission request reaches host callback and decision is honored |
| AskUserQuestion | PENDING | Host receives structured question/options and can answer programmatically |
| Context usage | PENDING | `getContextUsage()` readback is captured in Runtime observability |
| Compact | PENDING | Observe compact lifecycle/boundary and retain canonical history unchanged |
| Model selection | CONTRACT | Real SDK turn executes selected model and applied model is read back |
| Thinking / effort | CONTRACT | Capability validation + applied settings/readback for supported combinations |
| Runtime model switch | PENDING | Persistent Query changes model without changing logical conversation identity |
| Background task state | PENDING | Structured background task membership/progress is observed |
| Thinking token usage | PENDING | Usage readback reaches Runtime observability without becoming canonical message content |
| Interrupt current turn | PENDING | Mid-turn interrupt works; startup/API-call edge cases fall back to timeout + hard stop |
| Normalized event compatibility | CONTRACT | Existing canonicalizer receives equivalent session/text/tool/result events |
| Subscription-auth boundary | CONTRACT | Self-hosted Mac smoke succeeds with existing Claude login and no `ANTHROPIC_API_KEY` |
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
