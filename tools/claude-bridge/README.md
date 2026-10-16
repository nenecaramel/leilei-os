# Claude Bridge module boundaries

The bridge remains a supported compatibility module for future Native Live use.
Structural maintenance does not enable a workload or call Claude. SDK and
lockfile versions remain unchanged (`@anthropic-ai/claude-agent-sdk@0.3.286`).

## Responsibilities

| Module | Owns | Deliberately retained boundary |
| --- | --- | --- |
| `claude-transport.mjs` | Abstract transport contract | No SDK or runtime state |
| `agent-sdk-claude-transport.mjs` | SDK options, session preflight/portability, identity and checkpoint completion, compact, SendFile MCP adapter | Session mutation and durability stay together; callbacks and ordering unchanged |
| `provider-checkpoint-prefix.mjs` | Pure canonical ancestry validation and query-local SessionStore read views | No SDK/filesystem imports; real store writes still receive their original receiver |
| `local-checkpoint-fork.mjs` | Transient local fork transcript and durable cleanup receipt | Path/symlink guards, fsync, permissions and orphan cleanup remain intact |
| `agent-sdk-turn-handle.mjs` | Input queue, MCP readiness, interactive callbacks, interrupt and event-consumption lifecycle | One query and one lifecycle owner; no state-machine rewrite |
| `normalized-events.mjs` | Ordered provider-event projection, attribution, bounded tool output and telemetry | Stateful sequence/stream accumulation remain here; no event schema change |
| `output-contract.mjs` | Bounded compatibility envelopes, reasoning/binary redaction, provenance and SDK surface map | Its limits differ intentionally from tool-result text projection |
| `agent-sdk-permission.mjs` | Explicit trusted-read policy and permission callback projection | Unknown/write/destructive tools stay untrusted; exact attachment reads and SendFile retain dedicated policy |
| `agent-sdk-question.mjs` | Question/answer validation and callback projection | Separate from permission decisions despite similar small validation helpers |
| `agent-sdk-interrupt.mjs` | Interrupt receipt validation | Pure, no query lifecycle ownership |
| `agent-sdk-execution-selection.mjs` | Explicit model/thinking/effort validation | Requested options differ from provider readback |
| `agent-sdk-execution-readback.mjs` | Applied settings/capability observability | Does not override execution state |
| `agent-sdk-context-observability.mjs` | Context usage projection | Not canonical conversation state |
| `leileios-wake-system-prompt.mjs`, `leileios-murmur-system-prompt.mjs` | Wake/murmur-only custom prompt | No Claude Code preset or Mind memory-write prompt |

The checkpoint extractor is still re-exported from the transport for existing
consumers. All moved validation/read-view bodies are unchanged. Missing ancestry,
conflicting carriers, cycles, sidechains, session/subpath isolation and legacy
slice semantics retain their existing fail-closed behavior.

The interactive Claude SDK receives a custom prompt string containing only Wake and Murmur instructions. Non-interactive queries omit `systemPrompt` and use the SDK minimal default. Neither path enables the `claude_code` system prompt preset. This change removes prompt guidance for writing Mind memories, not the separate MCP memory tool or memory hooks.

## Host boundaries

`src/domains/bridge/mac/native-live-mac-claude-transport.ts` adapts the SDK bridge
into the Native Live runtime contract. Relay, runtime executor, durable SessionStore
append intents and terminal-result outbox remain host responsibilities. The daemon
imports local-fork cleanup separately; this refactor does not change startup,
receipt paths, credentials or the active Claude Code Mind runtime.

Transport orchestration has related but intentionally distinct interactive-turn
and command/compact paths. Collapsing them or splitting their mutable lifecycle
solely to reduce line count risks callback, mirror and terminal-result ordering.
Likewise the two bounded output projectors have different wire envelopes and
budgets. They are not interchangeable duplicate implementations.

## Offline tests

The package test entry checks the smoke script syntax and runs `test/**/*.test.mjs`.
Ordinary tests use mocks, temporary transcripts and a fake SDK subprocess. Live
branch tests are opt-in and must remain disabled during offline maintenance.
`provider-checkpoint-prefix.test.mjs` directly executes the pure validation and
read-view boundary. Root production-runtime-gate tests exercise host contracts;
the gate name does not mean it connects to production.

No live SDK query, daemon refresh or production acceptance was performed for this
structural cleanup. Those checks are distinct from offline compatibility proof.
