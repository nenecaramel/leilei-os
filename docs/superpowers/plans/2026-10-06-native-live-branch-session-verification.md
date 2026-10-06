# Native Live branch-session verification

Base: `origin/main@7be4401ac6d10d26fc97c9a37a44e9b3c740227c`.
Branch: `feat/native-live-branch-session-resume`. PR: #908 (Draft).

## Lifecycle contract

- Old resolveRuntimeParent selected fork for every non-empty foreground parent; checkpoints normally held only a session ID.
- New: first foreground send creates A; linear sends resume A from the canonical transcript UUID and require returned session ID A. Retry/Edit use the target user's canonical parent UUID and fork B, never the latest mutable tail. Further sends resume B.
- providerCheckpointId is the last persisted main-chain user/assistant/system/attachment carrier UUID. It is not inferred from the SDK result UUID. End-turn structured/tool carriers remain in the checkpoint.
- Legacy null-UUID sessions fork once on first continuation (explicitly approved), then use v4 resume. External source X is forked once, never directly resumed/mutated.
- Shared cleanup checks all surviving same-user/provider canonical checkpoints, bootstraps, prepared turns and pending/reserved compacts when queuing/reserving. Cross-conversation and newly referenced queued sessions are protected.
- Compact receives the canonical source UUID, keeps provider identity and updates only the current head checkpoint after durable completion. Earlier checkpoint UUIDs remain unchanged. Speculative wake remains an exact fork, so discarded background work cannot append into the foreground session.
- Interrupted exact resumes recover a full local transcript before retry; remote-only incomplete stores fail closed. Modern success cannot downgrade to v1–v3 or silently discard the UUID.

## RED → GREEN

| Witness | RED | GREEN |
| --- | --- | --- |
| SDK exact UUID dispatch/capture | missing resumeSessionAt / persisted checkpoint | provider checkpoint suite passes |
| Five sends + Retry/Edit | missing frozen parent UUID | A×5, exact historical B/C, replacement continuation pass |
| Queued shared-session cleanup | still-referenced A incorrectly reserved | protected across conversations / bootstrap / active turn |
| Compact checkpoint | head retained pre-compact UUID | head advances, earlier UUID unchanged |
| Durable completion | markComplete failure accepted | success rejected |
| Interrupted resume | incomplete status prevented all future completion | local backfill then exact resume succeeds |
| Compact source | no canonical resumeSessionAt | exact-source execution and completion required |

Fresh branch review identified interrupted-resume and compact-source/durability blockers. Both were reproduced with failing tests, fixed, then re-reviewed with no remaining blockers identified.

## Tests actually run

Script-equivalent commands were used because pinned pnpm startup attempted a network/version download. No version declaration or lockfile changed.

| Gate | Result |
| --- | --- |
| Targeted protocol/coordinator/executor/daemon/relay/purge | 124 pass / 0 fail |
| Final production-runtime-gate, Node 22.23.3 | 536 pass / 0 fail |
| Related isolated Postgres integrations | 32 pass / 0 fail |
| Final shared-session Mind follow-up/compact lineage | 3 pass / 0 fail |
| Final checkpoint fence/branch/bootstrap integration | 6 pass / 0 fail |
| Full Claude bridge | 153 pass / 0 fail / 1 opt-in live skip |
| Opt-in real SDK 0.3.286 | 1 pass / 0 fail |
| Root typecheck/build, Node 22.23.3 | PASS |
| Web typecheck/build, Node 24.21.0 | PASS |
| Drizzle check and local migrations 0000–0099 | PASS |
| git diff --check | PASS |

Local PostgreSQL: exclusively task-created `127.0.0.1:55439/leilei_branch_test`, removed at closeout. SDK live tests used unique temporary directories and newly created sessions, then deleted only those test sessions. No real provider session was resumed, forked, deleted or compacted.

The live SDK test performed new → exact resume → exact /compact → exact resume with identical provider identity; forkSession(upToMessageId=pre-compact UUID) still excluded the later marker after real compact. Earlier attempts hit test budget/prompt limits; a passing compact assertion run exposed a store-only fork cleanup issue. The final exact-addressed live run fully passed, including cleanup. Test costs were bounded per query; no secrets or existing transcript bodies were printed.

## Canonical-suite baseline delta

Same Node 26.5.0, dependencies, Web tsconfig and CSS loader for branch/base:

- Branch: 2263 tests; 2110 pass / 22 fail / 131 skip.
- Exact latest main: 2255 tests; 2107 pass / 23 fail / 125 skip.
- New failure titles: **0**.
- Base-only HTTP failure: `web owner can create and list foreground mid-turn and interrupt controls` failed with `UND_ERR_SOCKET` during the full run; unmodified baseline file rerun passed 10/10. No improvement is claimed from this patch.
- Remaining failures are pre-existing canonical-suite failures (JSON parser/CI governance, iOS source-conservation and UI boundary assertions, Murmur, voice/source interaction assertions and WebKit/media fixtures). They were not repaired in this task.
- DB cases normally skip in the full suite; the separate opt-in isolated integration run passed them. iOS simulator-render gates were not enabled; no UI production files changed.

## Reproducible commands

```sh
node --test tools/claude-bridge/test/*.test.mjs
RUN_SDK_BRANCH_CHECKPOINT_LIVE=1 node --test tools/claude-bridge/test/sdk-live-branch-checkpoint.test.mjs
# Use ONLY an explicitly isolated localhost DATABASE_URL for the following:
RUN_NATIVE_LIVE_TURN_DATABASE_TEST=1 RUN_NATIVE_LIVE_MIND_FOLLOWUP_DATABASE_TEST=1 RUN_NATIVE_LIVE_SILENCE_WAKE_DATABASE_TEST=1 RUN_NATIVE_LIVE_PROVIDER_SESSION_STORE_DATABASE_TEST=1 node --import tsx --test --test-concurrency=1 tests/native-live-branch-session.integration.test.ts tests/native-live-backend-turn-repository.integration.test.ts tests/native-live-mind-followup.integration.test.ts tests/native-live-silence-wake.integration.test.ts tests/native-live-provider-session-store.integration.test.ts tests/native-live-stale-replacement.integration.test.ts
TSX_TSCONFIG_PATH=./web/tsconfig.app.json node --import tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 tests/**/*.test.ts
pnpm test:production-runtime-gate
pnpm typecheck
pnpm build
# Node 24 in web:
npm run typecheck
npm run build
pnpm db:check
git diff --check
```

## Not executed / operational boundary

No production migration, deployment, daemon restart or real LeileiOS production turn acceptance. After approval/merge, apply 0099 through the normal authorized server deployment path and refresh the canonical Mac daemon; verify deployed v4 and real foreground five-send/Retry/Edit/compact behavior. No iOS rebuild required for this change.

GitHub CI at pushed implementation head had `checks: failure, steps=[]`; `postgres-regressions: skipped, steps=[]`; failed logs unavailable. This is not a CI PASS, and local gates are reported separately.

## Changed files

- `docs/superpowers/plans/2026-10-06-native-live-branch-session.md`
- `docs/superpowers/specs/2026-10-06-native-live-branch-session.md`
- `drizzle/0099_native_live_branch_session.sql`
- `drizzle/meta/_journal.json`
- `src/database/schema/native-live-turn.ts`
- `src/domains/bridge/mac/native-live-mac-claude-transport.ts`
- `src/domains/bridge/mac/native-live-mac-daemon-loop.ts`
- `src/domains/bridge/mac/native-live-mac-http-relay-client.ts`
- `src/domains/bridge/mac/native-live-mac-runtime-executor.ts`
- `src/domains/bridge/mac/native-live-mac-workspace-runtime.ts`
- `src/domains/bridge/protocol/runtime-protocol/command.ts`
- `src/domains/bridge/protocol/runtime-protocol/parsing.ts`
- `src/domains/bridge/protocol/runtime-protocol/result.ts`
- `src/domains/bridge/protocol/runtime-protocol/types.ts`
- `src/domains/bridge/provider-session/native-live-provider-session-cleanup.ts`
- `src/domains/bridge/provider-session/native-live-provider-session-references.ts`
- `src/domains/bridge/relay/native-live-backend-relay.ts`
- `src/domains/bridge/turn/native-live-backend-turn-coordinator.ts`
- `src/domains/bridge/turn/native-live-manual-compact.ts`
- `src/domains/bridge/turn/native-live-silence-wake.ts`
- `src/domains/bridge/turn/turn-repository/cleanup.ts`
- `src/domains/bridge/turn/turn-repository/finalize-success.ts`
- `src/domains/bridge/turn/turn-repository/prepare.ts`
- `src/domains/bridge/turn/turn-repository/reads.ts`
- `src/domains/bridge/turn/turn-repository/records.ts`
- `src/domains/bridge/turn/turn-repository/repository.ts`
- `src/domains/bridge/turn/turn-repository/types.ts`
- `src/domains/conversation/native-live-conversation-orchestrator.ts`
- `src/domains/conversation/native-live-conversation-repository.ts`
- `src/domains/conversation/native-live-conversation-types.ts`
- `src/web-api/native-live-internal/sessions.ts`
- `tests/native-live-backend-turn-coordinator.test.ts`
- `tests/native-live-branch-session.integration.test.ts`
- `tests/native-live-mind-followup.integration.test.ts`
- `tests/native-live-runtime-protocol-boundaries.test.ts`
- `tests/native-live-runtime-protocol.test.ts`
- `tests/native-live-stale-replacement.integration.test.ts`
- `tools/claude-bridge/src/agent-sdk-claude-transport.mjs`
- `tools/claude-bridge/src/agent-sdk-turn-handle.mjs`
- `tools/claude-bridge/test/provider-checkpoint.test.mjs`
- `tools/claude-bridge/test/sdk-live-branch-checkpoint.test.mjs`
