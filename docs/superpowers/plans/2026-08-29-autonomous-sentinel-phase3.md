# Autonomous Sentinel Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one durable per-user Autonomous Sentinel that repeatedly wakes through the existing Message Bridge, lets the model choose `contact | quiet`, atomically commits the next wake, and remains truthful under pause, restart, concurrency, listener absence, ambiguity, and recovery.

**Architecture:** PostgreSQL owns Sentinel control state, Wake Run execution state, and `next_wake_at`. A lightweight backend scheduler creates exactly one Wake Run plus one existing Bridge event transactionally; Phase 2 claim is synchronized into that Wake Run; model-visible v3 tools read fresh state and atomically finalize the wake, including the next schedule and Phase 2 completion. The existing active Message Bridge listener remains the official ChatGPT destination; no second queue, transcript, durable conversation binding, or separate scheduler product is introduced.

**Tech Stack:** TypeScript, Node.js >=20, Express 5, PostgreSQL 18, Drizzle ORM/Kit, MCP SDK + MCP Apps, React/Vite Web PWA, Node test runner via `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-29-autonomous-sentinel-phase3-design.md` on `plan/autonomous-sentinel-phase3`, approved at `9100d9e465bcc624f17af5fedcce78389bb78183`.

**Fresh implementation baseline:** `main@3c25a84adceb5235dc6d7a50eb527d04c1929648` (fresh-read 2026-08-29). Implementation must start from a fresh `main`, not from the planning branch. Copy only this approved spec and this plan into the implementation branch before code changes.

## Global Constraints

- Phase 1 transport and Phase 2 processing contracts remain authoritative; do not rewrite or weaken `delivery_unknown`, no-blind-replay, owner scope, or processing idempotency semantics.
- Exactly one durable Sentinel per authenticated user; exactly one non-terminal active Wake Run per Sentinel.
- PostgreSQL `next_wake_at` is authoritative; process-memory timers are never durable truth.
- Production normal next-wake bounds are 5 minutes minimum and 7 days maximum, validated against server time. Tests may inject shorter bounds without weakening production defaults.
- Claimed-but-unfinalized becomes recovery-required after 15 minutes; no automatic successor is created.
- `complete_sentinel_wake` must atomically commit decision, next wake, capsule, Wake Run finalization, Sentinel state, and correlated Phase 2 completion.
- `wake_context_capsule` is replace-only and at most 1,024 Unicode code points; policy is bounded and user-owned; neither may appear in normal operational logs.
- Human Bridge work reserves before Sentinel wake work. Sentinel cancellation is permitted only when host dispatch definitely has not started.
- No Todo/Diary/Day Space dependency, idle/presence fiction, cron DSL, native `/chat`, assistant transcript persistence, push/email/SMS, or durable named ChatGPT conversation binding in Phase 3.
- Wake Activity is bounded operational metadata only; the 30-day cleanup job is not a Phase 3 implementation blocker and is intentionally deferred unless existing retention integration makes it trivial without expanding scope.
- Keep `Resume now` because it is part of the approved owner-control contract, but implement it through the same immediate-wake transaction as `Wake now`; do not create a parallel orchestration path.
- Production database migration runs only through the reviewed Railway predeploy compiled migration path. Never manually migrate production from a developer machine.
- Production acceptance must use a freshly opened `ui://leileios/message-bridge/v3` card; cached v1/v2 cards are not acceptance evidence.
- Official-host acceptance covers host-dependent behavior only. Concurrency, owner isolation, time bounds, conflicting finalization, duplicate scans, and similar database invariants belong in deterministic PostgreSQL integration tests rather than repeated manual ChatGPT testing.

## Implementation kickoff

At execution time, create an isolated worktree from fresh `main`, then bring in the two planning documents without inheriting planning-branch code history:

```bash
git fetch origin
git worktree add ../leilei-os-phase3 -b feat/autonomous-sentinel-phase3 origin/main
cd ../leilei-os-phase3
git checkout origin/plan/autonomous-sentinel-phase3 -- \
  docs/superpowers/specs/2026-08-29-autonomous-sentinel-phase3-design.md \
  docs/superpowers/plans/2026-08-29-autonomous-sentinel-phase3.md
git add docs/superpowers/specs/2026-08-29-autonomous-sentinel-phase3-design.md \
        docs/superpowers/plans/2026-08-29-autonomous-sentinel-phase3.md
git commit -m "docs: add autonomous sentinel phase 3 contract"
```

Before Task 1, verify `git rev-parse origin/main` is still the intended fresh base and review any intervening `main` changes. If `main` moved, rebase the implementation worktree before writing Phase 3 code; do not silently execute against a stale baseline.

---

### Task 1: Add the durable Sentinel and Wake Run schema

**Files:**
- Modify: `src/database/schema.ts`
- Create: `drizzle/0030_autonomous_sentinel.sql` (generated/canonical migration name)
- Create/update: `drizzle/meta/0030_snapshot.json`, `drizzle/meta/_journal.json`
- Create: `tests/sentinel-schema-migration.test.ts`

**Interfaces:**
- Produces `sentinels` and `sentinel_wake_runs` Drizzle tables plus widened Bridge producer/kind support and a nullable pre-dispatch cancellation timestamp.
- Later tasks consume the exact enum/value sets and column names defined here.

- [ ] **Step 1: Write the failing schema/migration contract test.** Assert one Sentinel per `user_id`, Wake Run cause/state/decision checks, partial uniqueness for one non-terminal run, owner/correlation indexes, Bridge `kind`/`source` support for `wake`/`leileios_sentinel`, and nullable `cancelled_at`. The test must also assert migration `0030` is present in the custom migration ledger ordering contract and does not mutate old message bodies.

```ts
assert.match(migrationSql, /CREATE TABLE .*sentinels/i);
assert.match(migrationSql, /CREATE TABLE .*sentinel_wake_runs/i);
assert.match(migrationSql, /leileios_sentinel/);
assert.match(migrationSql, /cancelled_at/);
assert.match(migrationSql, /WHERE .*state.*bridge_enqueued.*claimed.*recovery_required/is);
```

- [ ] **Step 2: Run only the new migration contract and verify RED.**

```bash
pnpm exec tsx --test tests/sentinel-schema-migration.test.ts
```

Expected: FAIL because the tables/enum widening/cancellation column and migration do not exist.

- [ ] **Step 3: Implement the schema and generate the canonical migration.** Add `sentinels` with `userId`, `enabled`, `timezone`, bounded state columns, `nextWakeAt`, `lastValidWakeAt`, `wakeContextCapsule`, `wakeContextUpdatedAt`, monotonic `controlRevision`, nullable `activeWakeRunId`, timestamps; add `sentinelWakeRuns` with the approved cause/state/decision fields and `bridgeEventId`; widen Bridge event `kind` to `chat | wake`, `source` to `leileios_pwa | leileios_sentinel`, and add nullable `cancelledAt`. Generate with:

```bash
pnpm exec drizzle-kit generate --name autonomous_sentinel
pnpm db:check
```

Use a partial unique index on `sentinel_wake_runs.sentinel_id` for states `bridge_enqueued`, `claimed`, `recovery_required`, plus uniqueness on `sentinels.user_id` and `sentinel_wake_runs.bridge_event_id`.

- [ ] **Step 4: Run schema checks and focused tests GREEN.**

```bash
pnpm db:check
pnpm exec tsx --test tests/sentinel-schema-migration.test.ts tests/bridge-schema-migration.test.ts tests/bridge-model-processing-schema.test.ts
pnpm typecheck
```

Expected: PASS with no Phase 1/2 constraint regression.

- [ ] **Step 5: Commit the durable schema slice.**

```bash
git add src/database/schema.ts drizzle tests/sentinel-schema-migration.test.ts
git diff --check
git commit -m "feat: add autonomous sentinel schema"
```

---

### Task 2: Implement Sentinel owner state and repository semantics

**Files:**
- Create: `src/domains/sentinel/sentinel-types.ts`
- Create: `src/domains/sentinel/sentinel-repository.ts`
- Create: `src/domains/sentinel/sentinel-service.ts`
- Create: `tests/sentinel-service.test.ts`
- Create: `tests/sentinel-repository.integration.test.ts`

**Interfaces:**
- Produces `SentinelService` owner-scoped reads/updates and shared scheduling validation.
- Exposes repository transactions needed by scheduler, owner controls, MCP tools, and recovery without allowing callers to provide an authoritative user identity.

- [ ] **Step 1: Write RED unit tests for the long-lived Sentinel contract.** Cover disabled-on-create, one row per owner, policy/timezone update without implicit enable, 5-minute/7-day production schedule bounds, 1,024-code-point capsule normalization, monotonic control revision, owner-safe not-found, and the product-status projection priority `Paused > Recovery required > Processing > Waiting for ChatGPT > Sleeping > Waking`.

```ts
assert.equal(created.enabled, false);
assert.equal(created.nextWakeAt, null);
assert.equal(projectSentinelStatus(pausedFixture), "paused");
assert.throws(() => validateNextWake(now, plusMinutes(now, 4)), /NEXT_WAKE_TOO_SOON/);
```

- [ ] **Step 2: Run the Sentinel service test RED.**

```bash
pnpm exec tsx --test tests/sentinel-service.test.ts
```

Expected: FAIL because Sentinel types/service/repository do not exist.

- [ ] **Step 3: Implement the minimal domain and Drizzle repository.** Keep policy authority in owner APIs, keep model-writable capsule separate, use server-derived `userId`, and expose discriminated repository outcomes (`applied | idempotent | conflict | not_found`) for mutation paths. Do not persist a giant overall-status enum; derive it from durable facts.

```ts
export type SentinelWakeDecision = "contact" | "quiet";
export type SentinelWakeCause = "scheduled" | "wake_now" | "recovery";
export type SentinelWakeRunState =
  | "bridge_enqueued"
  | "claimed"
  | "finalized"
  | "superseded"
  | "recovery_required";
```

- [ ] **Step 4: Run unit + real PostgreSQL repository integration GREEN.** The integration test must prove one-Sentinel uniqueness, owner isolation, control-revision compare/update behavior, one-active-run constraint, and exact JS `Date` decoding on readback.

```bash
RUN_SENTINEL_DATABASE_TEST=1 pnpm exec tsx --test --test-concurrency=1 tests/sentinel-repository.integration.test.ts
pnpm exec tsx --test tests/sentinel-service.test.ts
pnpm typecheck
```

- [ ] **Step 5: Commit the owner-state slice.**

```bash
git add src/domains/sentinel tests/sentinel-service.test.ts tests/sentinel-repository.integration.test.ts
git diff --check
git commit -m "feat: add sentinel state domain"
```

---

### Task 3: Create Wake Runs through Bridge and synchronize Phase 2 claim

**Files:**
- Modify: `src/domains/bridge/bridge-event-types.ts`
- Modify: `src/domains/bridge/bridge-event-repository.ts`
- Modify: `src/domains/bridge/bridge-service.ts`
- Modify: `src/domains/sentinel/sentinel-repository.ts`
- Modify: `src/domains/sentinel/sentinel-service.ts`
- Create: `tests/sentinel-wake-orchestration.test.ts`
- Modify: `tests/bridge-repository.integration.test.ts`
- Create: `tests/sentinel-wake-bridge.integration.test.ts`

**Interfaces:**
- Produces one transactional Wake Run + Sentinel Bridge event path used by scheduler, Resume now, Wake now, and Recovery.
- Extends Phase 2 claim so a Sentinel-origin event atomically moves its Wake Run `bridge_enqueued -> claimed` with the same authoritative claim timestamp.

- [ ] **Step 1: Write RED orchestration tests.** Require one immediate transaction to create a Wake Run and `[LeileiOS Sentinel wake]` Bridge event, set `active_wake_run_id`, consume/clear the old normal schedule, and use a deterministic Bridge idempotency identity derived from `wakeId`. Add tests proving human reservation priority, cancelled pre-dispatch Sentinel events are ineligible, and `dispatch_started_at != NULL` cannot be rewritten as cancelled.

```ts
assert.equal(result.wake.state, "bridge_enqueued");
assert.equal(result.bridge.kind, "wake");
assert.equal(result.bridge.source, "leileios_sentinel");
assert.equal(result.bridge.visibleText, "[LeileiOS Sentinel wake]");
```

- [ ] **Step 2: Run the orchestration/Bridge tests RED.**

```bash
pnpm exec tsx --test tests/sentinel-wake-orchestration.test.ts
RUN_BRIDGE_DATABASE_TEST=1 pnpm exec tsx --test --test-concurrency=1 tests/bridge-repository.integration.test.ts tests/sentinel-wake-bridge.integration.test.ts
```

Expected: FAIL on missing Sentinel producer/priority/cancellation/claim synchronization.

- [ ] **Step 3: Implement the shared transactional wake producer and additive claim hook.** Reservation ordering must be `human > sentinel_wake` and stable FIFO/ID order inside each class. `claimEvent(userId,eventId)` must retain existing Phase 2 semantics while, in the same PostgreSQL transaction, looking up a Wake Run by `bridge_event_id` and applying `claimed_at = model_claimed_at` exactly once. Duplicate claim must preserve both timestamps.

```ts
// conceptual transaction outcome
{
  bridge: { processingState: "claimed", modelClaimedAt: claimedAt },
  wake: { state: "claimed", claimedAt }
}
```

- [ ] **Step 4: Run focused unit + PostgreSQL integration GREEN.** Include concurrent claim calls, duplicate reservation scans, pre-dispatch cancellation, and a regression proving normal PWA chat still reserves/dispatches exactly as Phase 2 did.

```bash
pnpm exec tsx --test tests/sentinel-wake-orchestration.test.ts tests/bridge-processing-tools.test.ts tests/bridge-listener.test.ts
RUN_BRIDGE_DATABASE_TEST=1 pnpm exec tsx --test --test-concurrency=1 tests/bridge-repository.integration.test.ts tests/sentinel-wake-bridge.integration.test.ts
pnpm typecheck
```

- [ ] **Step 5: Commit the Bridge integration slice.**

```bash
git add src/domains/bridge src/domains/sentinel tests
git diff --check
git commit -m "feat: route sentinel wakes through bridge"
```

---

### Task 4: Add the PostgreSQL-backed scheduler and recovery projection

**Files:**
- Create: `src/domains/sentinel/sentinel-scheduler.ts`
- Modify: `src/domains/sentinel/sentinel-repository.ts`
- Modify: `src/domains/sentinel/sentinel-service.ts`
- Modify: `src/app/process-runtime.ts`
- Modify: `src/config/env.ts` only if cadence configuration is required; keep production correctness independent of cadence.
- Create: `tests/sentinel-scheduler.test.ts`
- Create: `tests/sentinel-scheduler.integration.test.ts`
- Modify: `tests/process-runtime.test.ts`

**Interfaces:**
- Produces a start/stop/drain scheduler participant for the existing process runtime.
- Consumes Task 3's transactional wake producer; never creates a second queue or in-memory durable schedule.

- [ ] **Step 1: Write RED scheduler tests.** Cover due+enabled+idle eligibility, ~30s polling as an operational default only, duplicate scans, two concurrent backend workers, restart with due state already in PostgreSQL, listener absence leaving one pending active wake, and claimed-but-unfinalized projection to `recovery_required` after 15 minutes without creating a successor.

```ts
assert.equal(await countActiveWakeRuns(sentinelId), 1);
assert.equal(await countBridgeEventsForWake(wakeId), 1);
assert.equal(afterRestart.nextWakeAt, persistedBeforeRestart.nextWakeAt);
```

- [ ] **Step 2: Run scheduler tests RED.**

```bash
pnpm exec tsx --test tests/sentinel-scheduler.test.ts tests/process-runtime.test.ts
RUN_SENTINEL_DATABASE_TEST=1 pnpm exec tsx --test --test-concurrency=1 tests/sentinel-scheduler.integration.test.ts
```

Expected: FAIL because no scheduler coordinator/due-row lock path exists.

- [ ] **Step 3: Implement the scheduler with database locking.** Use `FOR UPDATE SKIP LOCKED` or an equivalent conditional-update transaction to re-check `enabled`, `next_wake_at <= now()`, and `active_wake_run_id IS NULL`; create one Wake Run + one Bridge event; set active run; consume `next_wake_at`; commit atomically. Integrate scheduler lifecycle with `startBackgroundWork`, `stopBackgroundWork`, and `drainBackgroundWork` beside existing retention work. Tests inject short cadence/timeouts; production normal wake bounds remain unchanged.

```ts
export interface SentinelScheduler {
  start(): void;
  stopScheduling(): void;
  drain(): Promise<void>;
  runOnce(now?: Date): Promise<number>;
}
```

- [ ] **Step 4: Run scheduler/runtime tests GREEN.** Include a real PG18 concurrency test with two scheduler instances racing the same due Sentinel and verify one Wake Run/Bridge event only.

```bash
pnpm exec tsx --test tests/sentinel-scheduler.test.ts tests/process-runtime.test.ts
RUN_SENTINEL_DATABASE_TEST=1 pnpm exec tsx --test --test-concurrency=1 tests/sentinel-scheduler.integration.test.ts
pnpm typecheck
pnpm build
```

- [ ] **Step 5: Commit the scheduler slice.**

```bash
git add src/domains/sentinel src/app/process-runtime.ts src/config/env.ts tests
git diff --check
git commit -m "feat: add durable sentinel scheduler"
```

---

### Task 5: Ship Message Bridge v3 and model-visible Sentinel tools

**Files:**
- Modify: `src/mcp/tools/bridge-listener/listener-resource.ts`
- Modify: `src/mcp/tools/bridge-listener/register.ts`
- Create: `src/mcp/tools/sentinel/register.ts`
- Modify: `src/mcp/server/production-server-factory.ts`
- Modify: `src/app/process-runtime.ts`
- Create: `tests/sentinel-mcp-tools.test.ts`
- Create: `tests/bridge-listener-v3.test.ts`
- Modify: `tests/mcp-production-server-factory.test.ts`

**Interfaces:**
- Produces `ui://leileios/message-bridge/v3`, `sentinel_get_state(wakeId)`, and `complete_sentinel_wake({wakeId,decision,nextWakeAt,contextCapsule})`.
- `complete_sentinel_wake` is the only normal Sentinel finalizer and subsumes ordinary `bridge_event_complete` for Sentinel events.

- [ ] **Step 1: Write RED MCP/v3 tests.** Assert the v3 resource emits bounded hidden wake metadata (`eventId`, `wakeId`, `sentinelId`, `controlRevision`, `scheduledFor`, dispatch timing) without embedding policy/capsule; instructs claim first, then fresh state read; permits quiet; and requires one next wake on valid completion. Tool tests must reject unclaimed, cross-user, paused, stale-revision, non-active, too-soon, too-far, oversized-capsule, and conflicting-finalization inputs.

```ts
assert.equal(resourceUri, "ui://leileios/message-bridge/v3");
assert.equal(toolNames.has("sentinel_get_state"), true);
assert.equal(toolNames.has("complete_sentinel_wake"), true);
```

- [ ] **Step 2: Run focused MCP tests RED.**

```bash
pnpm exec tsx --test tests/sentinel-mcp-tools.test.ts tests/bridge-listener-v3.test.ts tests/mcp-production-server-factory.test.ts
```

Expected: FAIL because v3/Sentinel tools are absent.

- [ ] **Step 3: Implement v3 and the two tools.** `sentinel_get_state` derives owner from the authenticated MCP session and returns only judgment data. `complete_sentinel_wake` must perform one DB transaction that re-checks owner/active/enabled/revision/claimed state, validates decision/time/capsule, finalizes the Wake Run, updates `last_valid_wake_at`, replaces capsule, writes next wake, clears active run, advances revision, and marks correlated Bridge processing completed. Same normalized payload is idempotent; different payload conflicts safely.

```ts
const completeInput = z.object({
  wakeId: z.string().uuid(),
  decision: z.enum(["contact", "quiet"]),
  nextWakeAt: z.string().datetime(),
  contextCapsule: z.string().max(1024),
}).strict();
```

The v3 model contract uses natural substantive output after `contact`, and exactly the minimal default heartbeat `醒了一下，没事。` after `quiet`.

- [ ] **Step 4: Run MCP + Bridge regressions GREEN.** Verify ordinary Phase 2 claim/complete tools still work for non-Sentinel events and no assistant message body is stored by Sentinel.

```bash
pnpm exec tsx --test tests/sentinel-mcp-tools.test.ts tests/bridge-listener-v3.test.ts tests/bridge-processing-tools.test.ts tests/bridge-listener.test.ts tests/mcp-production-server-factory.test.ts
pnpm typecheck
pnpm build
```

- [ ] **Step 5: Commit the model contract slice.**

```bash
git add src/mcp src/app/process-runtime.ts tests
git diff --check
git commit -m "feat: add sentinel model tools and bridge v3"
```

---

### Task 6: Add owner-scoped Sentinel API controls

**Files:**
- Create: `src/web-api/sentinel-router.ts`
- Modify: `src/web-api/router.ts`
- Modify: `src/app/create-app.ts`
- Modify: `src/app/process-runtime.ts`
- Create: `tests/sentinel-api.test.ts`
- Create: `tests/sentinel-controls.integration.test.ts`

**Interfaces:**
- Under the existing `/api/v1` mount, exposes `GET/PUT /sentinel`, `POST /sentinel/pause`, `/resume`, `/resume-now`, `/wake-now`, `/recover`, and `GET /sentinel/wakes`.
- Uses Task 3's shared immediate-wake transaction for both `Resume now` and `Wake now`; no duplicate orchestration implementation.

- [ ] **Step 1: Write RED API contract tests.** Require server-derived owner identity, strict Zod bodies, disabled first creation, authoritative persisted readback, bounded Wake Activity, policy update while enabled, Pause hard-stop, Resume fresh future schedule, Resume now from disabled state, Wake now only when enabled/no overlap, Recovery only for legitimate recovery state, and owner-safe 404 semantics.

```ts
await request.put("/api/v1/sentinel").send({ timezone: "Asia/Beijing", policyPrompt: "..." }).expect(200);
await request.post("/api/v1/sentinel/pause").send({}).expect(200);
await request.post("/api/v1/sentinel/wake-now").send({}).expect(409);
```

- [ ] **Step 2: Run API tests RED.**

```bash
pnpm exec tsx --test tests/sentinel-api.test.ts
RUN_SENTINEL_DATABASE_TEST=1 pnpm exec tsx --test --test-concurrency=1 tests/sentinel-controls.integration.test.ts
```

Expected: FAIL because the router/dependency wiring does not exist.

- [ ] **Step 3: Implement the router and owner-control transactions.** Pause must advance revision, clear normal schedule, supersede active run, clear active pointer, and only cancel/release Bridge work that is definitely pre-dispatch. Recovery must preserve old ambiguous/claimed evidence, supersede old run first, then create exactly one `cause=recovery` successor. Network-repeat-sensitive mutations must use the repository's existing idempotent/discriminated-outcome conventions.

```ts
router.post("/sentinel/recover", async (req, res) => {
  const userId = requireAuthenticatedWebUser(req);
  const result = await sentinelService.recover(userId);
  // map applied/idempotent/conflict/not_found to existing API error contract
});
```

- [ ] **Step 4: Run API + PostgreSQL control tests GREEN.** Include stale late wake suppression after Pause/Recovery, Resume not reusing a missed pre-pause due time, Resume-now/Wake-now no overlap, and cross-user invisibility.

```bash
pnpm exec tsx --test tests/sentinel-api.test.ts
RUN_SENTINEL_DATABASE_TEST=1 pnpm exec tsx --test --test-concurrency=1 tests/sentinel-controls.integration.test.ts
pnpm typecheck
pnpm build
```

- [ ] **Step 5: Commit the owner-control API slice.**

```bash
git add src/web-api src/app tests/sentinel-api.test.ts tests/sentinel-controls.integration.test.ts
git diff --check
git commit -m "feat: add sentinel owner controls"
```

---

### Task 7: Add the minimal `/sentinel` Web/PWA control surface

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/layout/AppShell.tsx`
- Create: `web/src/pages/SentinelPage.tsx`
- Create: `web/src/pages/SentinelPageContainer.tsx`
- Use/modify: `web/src/api/useWebApiClient.ts` only as needed for the existing authenticated client pattern.
- Modify: `web/src/styles.css` only for scoped Sentinel UI rules consistent with the existing shell.
- Create: `tests/sentinel-page.test.ts`
- Modify: `tests/app-shell-mobile.test.ts`

**Interfaces:**
- Produces the owner control/status page only; it is not a chat surface.
- Consumes `/api/v1/sentinel*` and displays projected product state rather than raw Bridge enums on the primary card.

- [ ] **Step 1: Write RED component/route tests.** Require route `/sentinel`, navigation entry, ON/Paused state, Next wake, Last valid wake + decision, projected current state, editable policy, Wake now, Pause/Resume/Resume now, Recovery control only when required, and a bounded recent Wake Activity list. Ensure mobile shell remains usable and no native transcript/chat composer is introduced.

```ts
assert.match(rendered, /Autonomous Wake/);
assert.match(rendered, /Next wake/);
assert.doesNotMatch(rendered, /processing_state|delivery_unknown|bridge_event_id/);
```

- [ ] **Step 2: Run Web tests RED.**

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test tests/sentinel-page.test.ts tests/app-shell-mobile.test.ts
```

Expected: FAIL because the route/page/navigation do not exist.

- [ ] **Step 3: Implement the minimal control page.** Keep API state authoritative; browser storage must not own schedule state. Confirm mutating controls with disabled/loading feedback sufficient to prevent accidental double submits. Keep Wake Activity metadata compact (time, decision/state, next wake) and route technical drill-down to existing System Activity rather than exposing implementation enums in the main card.

```tsx
<Route path="sentinel" element={<SentinelPage />} />
```

- [ ] **Step 4: Run Web regression gates GREEN.**

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test tests/sentinel-page.test.ts tests/app-shell-mobile.test.ts
cd web && npm run typecheck && npm run build
```

Also run the existing UI regression subset that covers AppShell/routing if those files are touched.

- [ ] **Step 5: Commit the Web/PWA slice.**

```bash
git add web/src tests/sentinel-page.test.ts tests/app-shell-mobile.test.ts
git diff --check
git commit -m "feat: add sentinel control surface"
```

---

### Task 8: Prove failure semantics, security, idempotency, and full deterministic regression

**Files:**
- Create: `tests/sentinel-exact-runtime.integration.test.ts`
- Create: `tests/sentinel-privacy.test.ts`
- Modify focused Sentinel/Bridge tests from Tasks 2-7 only when a gap is found.
- Modify observability files only if a failing privacy test proves policy/capsule/hidden context can leak.

**Interfaces:**
- Produces the deterministic acceptance evidence that must exist before merge/deploy.
- Does not add new product behavior except fixes required by a demonstrated failing test.

- [ ] **Step 1: Write the exact-runtime failure matrix test before final hardening.** In disposable PG18, cover: duplicate scheduler scans; two scheduler instances; human-before-Sentinel reservation; restart durability; listener absent then return; Pause pre-dispatch cancel and post-dispatch semantic supersede; late stale wake cannot alter new schedule; Resume/Resume now/Wake now constraints; claim timestamp synchronization/idempotency; same-payload finalization idempotency; conflicting finalization rejection; time bounds; `delivery_unknown + unclaimed` no replay + recovery-required; 15-minute claimed timeout; recovery supersede-before-successor; cross-user non-observability.

```ts
assert.equal(oldWake.state, "superseded");
assert.equal(newWake.cause, "recovery");
assert.equal(await countSuccessors(oldWake.id), 1);
assert.equal(await countBlindReplays(oldBridge.id), 0);
```

- [ ] **Step 2: Run the exact-runtime matrix and privacy tests to expose any remaining RED cases.**

```bash
RUN_SENTINEL_DATABASE_TEST=1 pnpm exec tsx --test --test-concurrency=1 tests/sentinel-exact-runtime.integration.test.ts
pnpm exec tsx --test tests/sentinel-privacy.test.ts
```

The privacy test captures safe logger output and asserts absence of policy text, capsule text, hidden model context, auth tokens, raw DB errors, and assistant response bodies.

- [ ] **Step 3: Fix only demonstrated gaps, preserving the approved architecture.** Do not add a second queue, transcript, presence engine, cron DSL, extra retention subsystem, or host-retry mechanism. If a gap is caused by OpenAI host policy rather than local semantics, document it for Task 9 instead of falsifying transport/model state.

```ts
assert.equal(logText.includes(secretPolicyFixture), false);
assert.equal(logText.includes(capsuleFixture), false);
```

- [ ] **Step 4: Run the complete deterministic gate suite GREEN.**

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm db:check
cd web && npm run typecheck && npm run build
```

Then run PG18 Sentinel/Bridge integrations explicitly with their environment gates. Record total pass/skip/fail counts and distinguish infrastructure-only CI failures from code failures.

- [ ] **Step 5: Commit the final deterministic hardening slice.**

```bash
git add src web/src tests
git diff --check
git status --short
git commit -m "test: harden autonomous sentinel runtime"
```

---

### Task 9: Rehearse migration, deploy exact head, and production-accept the real autonomous loop

**Files:**
- No feature code should be added during this task unless a new production defect is reproduced with a failing test first.
- Update after acceptance: `docs/superpowers/plans/2026-08-29-autonomous-sentinel-phase3.md` only if actual evidence requires a factual correction.
- Update project control state in Notion after acceptance; secrets and raw credentials never go into Notion/GitHub/chat.

**Interfaces:**
- Produces the production-accepted Phase 3 release.
- Uses existing Railway predeploy migration runner, Vercel/Railway deployments, LeileiOS PWA, and a freshly opened official ChatGPT v3 listener.

- [ ] **Step 1: Freeze an exact reviewed implementation head.** Review diff from fresh Phase 2 accepted base, verify only approved Phase 3 scope, run `git diff --check`, canonical suites, root/Web typecheck/build, and record exact head SHA. No merge while review findings remain.

- [ ] **Step 2: Perform production read-only preflight and fresh encrypted backup.** Use PostgreSQL 18 client, `-P pager=off`, transaction/rollback for preflight reads, repository canonical backup script, encrypted backup + SHA-256 sidecar, and no secret echoing. Confirm pre-Phase3 production lacks `0030` Sentinel schema before deploy.

- [ ] **Step 3: Restore the fresh backup into a disposable PostgreSQL 18 TLS target and rehearse the exact compiled migration twice.** First run must apply `0030`; second must be no-op. Read back Sentinel tables/checks/indexes/Bridge widening/custom ledger, run Sentinel+Bridge PG integrations against the restored target, verify durable-table parity, then destroy disposable runtime/plaintext artifacts while retaining encrypted backup evidence.

```bash
pnpm build
node dist/database/migrate.js
node dist/database/migrate.js
pnpm db:check
```

Do not point the migration runner at production from the developer machine.

- [ ] **Step 4: Merge with expected-head protection and verify exact deployment source.** Merge only the reviewed head, then require Vercel and Railway success for the merge SHA. Railway production migration must occur through predeploy `node dist/database/migrate.js`; app startup must not become a second implicit migration path.

- [ ] **Step 5: Perform production schema/API/runtime readback before host testing.** Confirm `0030` ledger entry, Sentinel/Wake tables and indexes, `/health`, `/ready`, owner Sentinel API behavior, initial create disabled, and the temporary state needed for acceptance. Do not manually edit production rows.

- [ ] **Step 6: Open one fresh official ChatGPT Message Bridge v3 card and prove the three-generation real loop.** With the production Sentinel enabled, require three consecutive genuine wake generations from the same durable Sentinel: Wake #1 model claim -> `quiet` -> `complete_sentinel_wake` -> future `next_wake_at`; Wake #2 claim -> `contact` -> natural substantive assistant message -> future `next_wake_at`; Wake #3 claim -> `quiet` -> future `next_wake_at`. After each, owner/API or read-only DB evidence must show exactly one Wake Run and the authoritative future schedule. Do not create duplicate listeners or resend ambiguous events.

- [ ] **Step 7: Prove only the host-dependent control/failure cases manually.** Verify listener absence yields one pending active wake and truthful `Waiting for ChatGPT`; listener return dispatches that same run; Pause suppresses a wake that may already have entered dispatch; a superseded late turn cannot substantively contact or rewrite schedule; one controlled `delivery_unknown + unclaimed` path remains quarantined/no-replay and exposes owner Recovery; explicit Recovery creates one successor. Reuse deterministic integration evidence for concurrency, cross-user, time-bound, and conflicting-finalization cases instead of repeating them in ChatGPT.

- [ ] **Step 8: Close all acceptance-only switches/state and confirm normal production mode.** If any bounded acceptance-only timing/configuration was introduced, remove/disable it and wait for healthy redeploy. Confirm Sentinel remains usable under production 5-minute/7-day bounds, no sensitive logs were emitted, no assistant transcript is stored, and Phase 1/2 normal Bridge behavior still works.

- [ ] **Step 9: Record production acceptance and retire the old Scheduled Task Sentinel for normal use.** Update Notion with exact merge/deploy SHA, migration/backup/rehearsal evidence, three-wake host evidence, failure/control evidence, any explicit host-policy limitation, and the statement that Phase 3 is production accepted. Only after this closeout may the previous Scheduled Task Sentinel be retired; future Todo/Diary/Current State work is enhancement, not a blocker.

---

## Self-review

### 1. Spec coverage

- Durable one-Sentinel/one-active-run model: Tasks 1-3.
- PostgreSQL scheduling, restart, multi-instance concurrency, listener absence: Task 4 + Task 8.
- Human priority, Sentinel producer, pre-dispatch cancellation, stale semantic suppression: Task 3 + Task 6 + Task 8.
- Phase 2 claim synchronization: Task 3.
- v3 resource, fresh-state tool, atomic finalizer, contact/quiet: Task 5.
- Initial disabled state, Pause, Resume, Resume now, Wake now, Recovery: Task 6.
- Minimal `/sentinel` UI and bounded Wake Activity: Task 7.
- No blind replay, 15-minute stalled processing, idempotency/conflict/isolation/privacy: Task 8.
- Migration safety and real official-host repeated autonomous loop: Task 9.
- Deferred 30-day cleanup is explicitly non-blocking; bounded Wake Activity prevents unbounded product reads while leaving cleanup as a later maintenance enhancement.

### 2. Placeholder scan

This plan contains no implementation `TODO`, `TBD`, “similar to Task N”, or unspecified error-handling steps. Every implementation slice has a named file set, RED command, concrete behavior, GREEN command, and commit gate.

### 3. Type/interface consistency

Canonical values used throughout this plan:

```ts
type BridgeEventKind = "chat" | "wake";
type BridgeEventSource = "leileios_pwa" | "leileios_sentinel";
type SentinelWakeCause = "scheduled" | "wake_now" | "recovery";
type SentinelWakeRunState =
  | "bridge_enqueued"
  | "claimed"
  | "finalized"
  | "superseded"
  | "recovery_required";
type SentinelWakeDecision = "contact" | "quiet";
```

`Resume now`, `Wake now`, scheduler due-wake creation, and Recovery all converge on the same transactional Wake Run + Bridge producer. Phase 2 claim synchronization is additive in the existing Bridge claim transaction. Sentinel model finalization is performed only through `complete_sentinel_wake`; ordinary `bridge_event_complete` remains available for non-Sentinel processing and superseded cleanup where the approved spec requires it.

## Execution handoff

Plan is intentionally reduced to **9 independently reviewable tasks / 49 checkbox steps**. Implementation should use **subagent-driven development** task-by-task, with a fresh reviewer gate after each task. Do not begin Task 1 from the planning branch; begin from fresh `main` using the kickoff sequence above.
