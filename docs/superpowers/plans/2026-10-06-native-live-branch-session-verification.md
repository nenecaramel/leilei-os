# Native Live branch-session verification

Base: `origin/main@7be4401ac6d10d26fc97c9a37a44e9b3c740227c`.
Branch: `feat/native-live-branch-session-resume`. PR: #908 (Draft).

## Authorized single-path live verification — 2026-10-06

**PASS** on tested PR head `983e716b7335d9941d215f3eb9cdb7d33d8d9201`,
installed SDK **0.3.286**. Exactly **one live test path / five query() calls**:
new turn 1, exact resume turn 2, real `/compact` from cp2, production historical
query fork from pre-compact cp1, then normal exact resume B. No retries, additional
forks/compacts, delivery-unknown case, same-U rerun or SDK comparison/upgrade.

- A: `740e6981-8206-464c-8943-367dcaf54030`.
- B: `531c73ba-fd1e-4fa6-971b-c43fc8598b53`; B != A.
- Turn 2 and compact kept A. Real compact boundary and a new persisted valid
  compact checkpoint were required and found; cp1 remained persisted.
- Fork directly used production `AgentSdkClaudeTransport.executeTurn()` with
  `query({ options: { resume: A, resumeSessionAt: cp1, forkSession: true } })`
  and the candidate query-local canonical-prefix SessionStore view. No exported
  `forkSession()` helper. The inherited user/assistant UUID prefix through cp1
  matched exactly; turn-2 marker, later UUIDs and compact boundary were absent B.
- Source A's complete raw SessionStore entries and local provider message readback
  matched their pre-fork snapshots after both fork and B resume.
- Normal B resume returned B; its SessionStore finished complete.
- Test result: **1 pass / 0 fail**, 28.209 seconds, **5 query calls**. No transcript
 content, credentials or prompts containing user data are included here.

```sh
RUN_SDK_BRANCH_CORRECTNESS_LIVE=1 node --test --test-concurrency=1 \
  --test-name-pattern='^live production query historical fork after compact is isolated and resumes B$' \
  tools/claude-bridge/test/sdk-live-branch-correctness.test.mjs
```

The selected case enforces a maximum of five query calls; fixture SDK retries are
set to zero (`CLAUDE_CODE_MAX_RETRIES=0`). Other live cases were not executed.
Only this live-test scope and verification documents changed in this follow-up;
no production source, SDK dependency, database/config or deployment changed.
Task-owned temporary sessions were removed by fixture cleanup without more queries.
PR remains **Draft**; no merge or deploy is authorized.

## Previous local-only follow-up (historical evidence)

Candidate `dabda76d` was pushed by explicit authorization. That earlier follow-up
made zero Claude live calls; the gate was then UNVERIFIED. The single-path evidence
above supersedes that pending status. Same-U interrupted resume was not rerun.

Fresh Node 22.23.3 results: bridge **155 pass / 0 fail / 4 opt-in live skips**;
runtime gate **539 pass / 0 fail**; isolated Postgres regression **66 pass / 0 fail** (now includes the six branch-session cases);
additional branch-session/bootstrap DB cases **7 pass / 0 fail**; relay unit
regressions **10 pass / 0 fail**; root typecheck/build and diff checks **PASS**.

The full isolated DB gate first exposed two PR-related RED witnesses, then passed
after minimal fixes: reserve was stripping modern commands to v3, and a nested
`checkpoint` alias shadowed the outer session identity during true-delete cleanup.
Modern preparation reserves now keep v4/null-or-exact parent checkpoint while
unaddressed legacy fixtures retain configured v2/v3. Cleanup's surviving-checkpoint
alias stays correlated with the outer source. Shared-session protection was kept,
not weakened. Three added relay regressions were RED then GREEN.

Postgres was exclusively task-created `127.0.0.1:55448/leilei_908_regression`, with
TLS enabled locally to honor the existing bootstrap test's SSL requirement.
Migrations 0000–0099 and ledger checks ran only there. The pnpm launcher refused
to reinstall symlinked dependencies; direct Node/Drizzle/tsx equivalents ran the
same isolated gate flags and file list. No canonical dependencies were reinstalled.

See [the detailed additional-gate ledger](2026-10-06-branch-session-correctness-gates-pending.md)
for the prior genuine fork RED, candidate mitigation, interrupted-U evidence and
quota-blocked live attempt. Those older attempts remain historical records; the
single authorized path above supplies the final gate evidence. Do not merge or deploy.


### Final local canonical delta (Node 22.23.3)

Against exact pre-follow-up PR head f8339c69, with identical dependencies/JSX/CSS
flags: candidate **2106 tests, 1923 pass / 53 fail / 130 skip**; base **2103 tests,
1920 pass / 53 fail / 130 skip**. **0 new failure titles**, 0 base-only. The three
added relay unit cases account for the additional passes. The 53 shared failures
include pre-existing source/governance/render assertions and missing Web React
dependencies in both disposable worktrees. This is not a green full canonical
suite claim, and is not directly comparable with the older fully installed Web
run. All failure names are recorded in the additional-gate ledger.

The standard isolated Postgres regression script now includes
`native-live-branch-session.integration.test.ts` so these six branch/cleanup/compact
DB cases cannot silently skip from that gate. The full script passed **66/66**;
the separate branch/bootstrap run passed **7/7**, overlapping those six branch
cases and adding one TLS bootstrap case (67 distinct DB cases total).

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
