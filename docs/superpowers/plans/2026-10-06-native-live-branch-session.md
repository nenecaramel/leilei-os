# Native Live Branch Session Implementation Plan

> Historical task plan. Its checkboxes and closeout evidence reflect the state when this
> plan was written. PR [#908](https://github.com/nenecaramel/leilei-os/pull/908)
> was **merged on 2026-10-06**; do not treat the Draft/no-merge closeout below as
> current PR status. Production/physical acceptance must still be verified separately.

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task in this session. No delegation unless the user chooses it. Steps use checkbox syntax for tracking.

**Goal:** Each new canonical foreground branch uses one Claude session; Retry/Edit fork the precise historical provider point.

**Architecture:** Carry a persisted provider chain UUID from SDK completion through the runtime protocol into the existing canonical checkpoint. Ordinary sends resume only checkpoint-addressable sessions; legacy sessions fork once before becoming mutable. Cleanup considers all surviving references, while speculative wake execution stays isolated.

**Tech Stack:** TypeScript, Drizzle/Postgres, Node ESM, installed Claude Agent SDK 0.3.286.

**Spec:** ../specs/2026-10-06-native-live-branch-session.md (user task plus approved legacy exception).

## Global Constraints

- Base 41bf880f24a5d42dd48fb39603c47080b3ec75bd; fetch again before final PR.
- No UI changes, production operations, automatic merge/deploy, or unrelated refactor.
- Reuse providerCheckpointId. A missing new-format checkpoint cannot silently become a whole-session fork.
- Never trust an SDK result UUID as a transcript address unless it exists in the persisted main transcript.
- Mind lineage remains canonical; preserve SessionStore mirror/incomplete/complete behavior.
- Record RED before each production change; explicitly report unavailable gates.

## Review Focus

1. Failed/interrupted resume appends noncanonical tail: next attempt must start from the canonical provider point, not contaminated tail (Tasks 1/3).
2. Final SDK response can be a tool-result/structured-output carrier: checkpoint must identify the last persisted main-chain entry, not blindly the last assistant event (Task 1).
3. Cleanup queued earlier can become unsafe after references appear: recheck canonical, bootstrap and active preparation references at reservation (Task 4).
4. Server and daemon may differ during rollout: old commands/results remain explicitly legacy; new resume/checkpoint requirements must fail closed on incompatible clients (Task 2).
5. Compact can change the live transcript chain: old checkpoint fork must be tested with actual SDK transcript operations, including preserved segment metadata, and missing addresses must fail (Task 5).

## Task 1: SDK message checkpoints and exact fork

**Files:** tools/claude-bridge/src/agent-sdk-claude-transport.mjs; tools/claude-bridge/src/agent-sdk-turn-handle.mjs; tools/claude-bridge/test/agent-sdk-claude-transport.test.mjs; new tools/claude-bridge/test/provider-checkpoint.test.mjs.

**Interfaces:** `executeTurn(prompt, { mode, parentProviderSessionId, parentProviderCheckpointId, ... })` returns `providerCheckpointId` alongside providerSessionId. Exact fork uses `resumeSessionAt` + `forkSession: true` on the same SDK query; validates the requested UUID against durable/restored main-chain entries before consuming a prompt. `resume` keeps the parent session ID. Complete session data is the source of checkpoint identity; local-only sessions use existing transcript import/read support before mutation.

- [ ] RED: real SDK forkSession on isolated in-memory transcripts must exclude turn3 when keeping cp1; cover UUID remapping, invalid point, compaction entries and disconnected noncanonical tail. Transport tests assert exact query options and final persisted checkpoint, including tool-result/structured output endings.
- [ ] RED: resume returns B for parent A => PROVIDER_SESSION_CONFLICT; fork returns A => same failure. No successful new-format result without an addressable checkpoint. Mirror failure must keep incomplete status.
- [ ] Run `node --test test/provider-checkpoint.test.mjs test/agent-sdk-claude-transport.test.mjs` from tools/claude-bridge; capture intended failures.
- [ ] Implement checkpoint selection/validation in the existing transport; preserve mutable-session markIncomplete before query and markComplete only after successful mirror.
- [ ] GREEN: same tests, including complete→incomplete→complete and failed/interrupted resume recovery at canonical parent UUID; commit.

## Task 2: Typed protocol and local schema compatibility

**Files:** src/domains/bridge/protocol/runtime-protocol/{types,command,result}.ts; native-live-runtime-protocol.ts exports; src/database/schema/native-live-turn.ts; turn-repository/{types,records,reads,repository}.ts; new numbered drizzle migration and journal/snapshot per repo conventions; tests/native-live-runtime-protocol.test.ts; tests/native-live-runtime-protocol-boundaries.test.ts.

**Interfaces:** new protocol version 4 carries `parent_provider_checkpoint_id` on commands and `provider_checkpoint_id` on successful results; typed mode is new|resume|fork. Parent ID null only for new; resume needs an exact parent checkpoint; fork permits null only for explicit immutable legacy/bootstrap. Protocol 1–3 remain accepted as legacy. Preparation stores the frozen parent checkpoint alongside the frozen parent session.

- [ ] RED: version4 resume parsing; parent/checkpoint invariants; new-result checkpoint requirement; both session identity conflicts; legacy versions remain accepted. Add local DB CHECK assertions for resume and parent consistency.
- [ ] Run protocol tests with `node --import tsx --test tests/native-live-runtime-protocol*.test.ts`.
- [ ] Implement types/parser plus additive migration widening runtime CHECK and adding nullable parent checkpoint to preparations. Do not edit historical SQL.
- [ ] GREEN protocol tests + isolated local migration check; commit. No production migration.

## Task 3: Send, Retry/Edit and canonical finalize

**Files:** turn-repository/prepare.ts; turn-repository/finalize-success.ts; native-live-backend-turn-coordinator.ts; mac/native-live-mac-runtime-executor.ts; mac/native-live-mac-claude-transport.ts; conversation/native-live-conversation-{types,orchestrator}.ts; tests/native-live-backend-turn-{repository.integration,coordinator}.test.ts; tests/native-live-mac-runtime-executor.test.ts; tests/native-live-mac-claude-transport.test.ts.

**Interfaces:** resolveRuntimeParent distinguishes send from replacement. Send: empty=>new; exact parent=>resume; legacy/bootstrap=>fork. Retry/Edit use target user's canonical parent checkpoint, never current head's provider tail; root replacement=>new unless external bootstrap exists. Finalize binds both provider IDs atomically with the assistant and head update.

- [ ] RED integration: new first send; five A→A turns with distinct cp1…cp5; Retry/Edit turn2 passes cp1 and creates B; continuation resumes B; legacy first continuation forks once; missing checkpoint on marked new data rejects; external X remains unchanged.
- [ ] RED executor/coordinator: exact checkpoint survives dispatch/results; resume conflict is rejected at both runtime and backend boundaries; zero-event retry uses the frozen parent point and never duplicates user history.
- [ ] Run named backend/executor/transport tests against an explicitly isolated local DB; do not reuse production DATABASE_URL.
- [ ] Implement minimal plumbing, atomic persistence and operation split; preserve replacement purge/canonical parent behavior.
- [ ] GREEN same tests; commit.

## Task 4: Shared provider cleanup protection

**Files:** provider-session/native-live-provider-session-cleanup.ts; turn/turn-repository/cleanup.ts; turn/native-live-replacement-purge.ts; conversation/native-live-conversation-repository.ts; tests/native-live-replacement-purge.test.ts; tests/native-live-provider-session-store.integration.test.ts; tests/native-live-stale-replacement.integration.test.ts.

**Interfaces:** queue only unreferenced sessions and guard reserveNext against surviving references scoped to user/provider/session. Include all canonical checkpoints across conversations, unconsumed bootstraps, and live preparations/compactions; exclude the rows actually being purged. Keep workspace identity checks and existing listener reservation protocol.

- [ ] RED: cp1/cp2/cp3 share A, purging cp2/cp3 never queues/deletes A; cross-conversation/bootstrap/live-turn references protect A; wholly purged B queues once and can be deleted; newly referenced queued session cannot be reserved.
- [ ] Run replacement/provider integration tests in isolated DB.
- [ ] Implement shared-reference guards without changing canonical purge semantics or Mind state repair.
- [ ] GREEN same tests + conversation hard-delete regression; commit.

## Task 5: Compact, speculative wake, routines and Mind

**Files:** turn/native-live-manual-compact.ts; turn/native-live-silence-wake.ts; associated mac compact result plumbing; tests/native-live-mind-followup.integration.test.ts; tests/native-live-silence-wake{,.integration}.test.ts; tools/claude-bridge/test/agent-sdk-claude-transport.test.mjs.

**Interfaces:** compact remains resume of the same provider session; successful compact updates current provider checkpoint to the actual persisted compact tail and preserves canonical compact epoch. Earlier canonical checkpoints retain their original UUIDs. Wake retains fork because stale wake can be discarded without contaminating the live branch; accepted wake becomes a checkpoint-addressable branch. Routines/schedule on an ordinary foreground turn follow send rules; independent background sessions retain isolation.

- [ ] RED: compact keeps A; next send resumes A at updated cp; old cp1 still forks without post-cp history; actual SDK fork operations handle preserved compact segments. Legacy compact must not make ambiguous whole-session checkpoints unsafe; reject any unprovable historical address rather than guess.
- [ ] RED: stale wake does not mutate foreground A; successful wake W subsequently resumes W; schedule/routine context bypass still carries canonical lineage.
- [ ] RED: repeated session A checkpoints keep distinct canonical lineage, cumulative seen IDs/thought aliases; Retry/Edit rolls back lineage; compact epoch resets as before.
- [ ] Run SDK, Mind, compact and silence-wake tests; implement only required checkpoint/mode plumbing.
- [ ] GREEN same gates; commit. A real Claude compact/resume smoke is a separate local provider validation; if credentials or scope prevent execution, label unexecuted rather than claim real transcript proof.

## Task 6: Whole-branch verification and Draft PR

- [ ] Run `pnpm agent:status`, `pnpm agent:verify --plan` on actual diff, then deduplicated applicable gates. If pinned pnpm startup fails, report it and run script-equivalent Node commands with installed dependencies.
- [ ] Run full Claude bridge suite, targeted protocol/backend/cleanup/purge/Mind/compact/wake suites, production-runtime-gate, root typecheck/build and diff check. Compare full canonical suite against exact fetched main; identify new vs pre-existing failures by title, not only totals.
- [ ] Review all runtime mode call sites; no UI or unrelated production diff. Verify SDK resume/fork session invariants, exact checkpoint requirements and old immutable-session protection.
- [ ] Fetch latest main, align isolated branch and re-run affected gates. Commit/push and create one Draft PR; attach it to this task. No merge/deploy.
- [ ] Report user-requested 12 delivery items with concrete RED/GREEN, full-suite delta and unexecuted tests. Document migration ordering and Mac daemon fresh requirement without performing either production action.
- [ ] Run hygiene:finish, preserve evidence in PR, remove this task's worktree/cache and prune; keep owner main/signing settings untouched.

## Closeout status

Tasks 1–6 implemented and verified; see [verification and full changed-file list](2026-10-06-native-live-branch-session-verification.md). Real SDK compact evidence is complete. Production acceptance remains deliberately unexecuted. At this plan's closeout PR #908 was still Draft; it subsequently merged on 2026-10-06. No production deployment or device acceptance was established by the plan itself. Temporary task resources are removed at closeout.
