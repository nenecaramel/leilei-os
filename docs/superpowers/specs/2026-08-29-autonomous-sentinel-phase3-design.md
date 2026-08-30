# Autonomous Sentinel Phase 3 Design

Date: 2026-08-29
Status: written spec approved by user; implementation gated on Phase 2 production acceptance
Planning branch: `plan/autonomous-sentinel-phase3`
Planning parent: `plan/mcp-app-message-bridge-phase2@5fbbd20400d4aa4f77f9a60f35193bf44baa25bc`
Fresh code baseline: `main@ce6f881f51c4fe0345e563f236a2227028c59096`
Depends on: MCP App Message Bridge Phase 2 production acceptance
Supersedes for implementation: the prior Phase 3 backend-wake/outbound-PWA design and the prior Phase 4 native-chat design. Those remain historical planning records only.

## 1. Product target

Phase 3 is the first version that must be usable as the real long-running autonomous wake product.

The target is one durable Sentinel per authenticated LeileiOS user:

```text
one durable Sentinel
        |
        | next_wake_at
        v
PostgreSQL-backed scheduler
        |
        v
one Wake Run
        |
        v
Phase 1 Bridge event
        |
        v
current active ChatGPT App listener
        |
        v
official ChatGPT conversation
        |
        v
Phase 2 model claim
        |
        v
fresh Sentinel read + autonomous judgment
        |
        +--> contact -> normal natural assistant message
        |
        +--> quiet   -> minimal heartbeat, no substantive content
        |
        `--> superseded -> old wake cannot act on newer control state
        |
        v
atomic Sentinel finalization
(outcome + next wake + capsule + processing completion)
        |
        v
sleep until the new next_wake_at
```

The scheduler does not decide whether the model should contact the user and does not choose normal next-wake timing. It only executes the model's last durable `next_wake_at`.

Phase 3 is complete only when this loop works repeatedly in production. Todo, Diary, Day Space, Current State, richer presence inference, push notifications, and a native LeileiOS chat transcript are optional later capabilities, not Phase 3 prerequisites.

## 2. Inherited lower-layer contracts

Phase 3 builds on, rather than replaces, Phase 1 and Phase 2.

Phase 1 remains the conservative transport into the currently active official ChatGPT App listener:

```text
pending -> reserved -> host_sent
                  \-> pending              definite host rejection/release
                  \-> delivery_unknown     ambiguous ui/message outcome
```

Its existing contracts remain authoritative:

- stable event correlation;
- one active listener lease per user;
- one in-flight host dispatch per user;
- `dispatch_started_at` persisted before `ui/message`;
- definite host rejection may release safely;
- ambiguous `ui/message` becomes `delivery_unknown`;
- no blind replay of an ambiguous host insertion;
- PostgreSQL is the durable authority.

Phase 2 remains the independent model-processing proof layer:

```text
unclaimed -> claimed -> completed
```

A valid Phase 2 claim proves that the correlated Bridge event reached an authenticated model-visible turn. Phase 3 reuses that proof and does not replace it with scheduler state or iframe state.

## 3. Scope

Phase 3 will:

- add exactly one durable autonomous Sentinel per user;
- add model-selected dynamic `next_wake_at` scheduling;
- add a PostgreSQL-backed scheduler/reconciliation loop without adding a second queue or database;
- add durable per-wake execution records;
- create Sentinel wake events through the existing Bridge domain;
- keep existing human Bridge submissions ahead of Sentinel wakes at reservation time;
- use the existing active listener as the current official ChatGPT destination;
- add model-visible Sentinel state/finalization tools;
- support substantive `contact`, successful `quiet`, and stale/superseded execution;
- guarantee that successful wake finalization and the next wake schedule commit atomically;
- support initial setup, Pause, Resume/Resume now, Wake now, and explicit recovery from ambiguous/stalled exceptional states;
- cancel/suppress a superseded Sentinel Bridge event only when host dispatch definitely has not started;
- add a minimal `/sentinel` control surface and bounded Wake Activity readback;
- preserve truthful behavior across backend restart, listener absence, duplicate scheduler ticks, stale control state, and Phase 1 ambiguous delivery;
- run full production acceptance across the real backend, Web/PWA, and official ChatGPT host.

Phase 3 will not:

- add Todo/Diary/Day Space as required wake triggers or required context sources;
- add automatic presence/idle inference or authoritative ordinary-ChatGPT `USER_RETURN` tracking;
- build a general cron expression engine or arbitrary condition DSL;
- create multiple Sentinels per user;
- create multiple durable ChatGPT conversation bindings;
- force a closed/suspended/unavailable ChatGPT host to execute;
- create a LeileiOS-native chat transcript;
- send assistant replies back to a LeileiOS chat sink;
- add Web Push/APNs/email/SMS/Telegram/Discord;
- mirror ChatGPT conversation history;
- permit the model to edit its own policy, enable a paused Sentinel, choose a user, or choose a transport destination;
- weaken Phase 1 no-blind-retry semantics.

## 4. Core design principles

1. **One Sentinel, many wakes.** The long-lived control object is stable; each execution gets a separate Wake Run.
2. **Database time is authority.** `next_wake_at` in PostgreSQL is canonical; process-memory timers are not.
3. **Wake does not mean contact.** A valid wake may end as `contact` or `quiet`.
4. **Quiet is a successful outcome.** It leaves at most one minimal assistant heartbeat; Phase 3 does not require zero visible host output.
5. **Stale control state cannot act.** A monotonic control revision prevents a paused/recovered/replaced wake from mutating newer Sentinel state.
6. **No observation fiction.** LeileiOS does not claim it receives every ordinary user message in the official ChatGPT conversation. The model may use its current visible conversation context when it wakes.
7. **The current active listener defines destination.** Phase 3 does not pretend to own a durable named ChatGPT conversation binding.
8. **Finalize atomically.** A successful valid wake cannot be marked complete without also durably establishing the next normal wake.
9. **Exceptional recovery is conservative.** Ambiguous host delivery is never blindly replayed.
10. **Policy is user-owned.** The model may read policy and update only its bounded wake capsule and next wake time.
11. **Pause is the hard stop.** Optional future Together/Away inference is unnecessary for Phase 3 correctness because quiet wake output is intentionally non-intrusive.
12. **Transport truth is preserved.** Pre-dispatch work may be safely cancelled; once dispatch may have happened, Phase 3 suppresses semantic action instead of rewriting or replaying host truth.

## 5. Long-lived Sentinel model

Expected logical shape:

```text
sentinels
  id
  user_id                 unique; one Sentinel per user
  enabled
  timezone
  policy_prompt
  next_wake_at            nullable while paused or while an active wake owns execution
  last_valid_wake_at      nullable
  wake_context_capsule    nullable
  wake_context_updated_at nullable
  control_revision        monotonic integer
  active_wake_run_id      nullable
  created_at
  updated_at
```

Fixed semantics:

- one row per authenticated owner;
- a newly created Sentinel starts disabled until the owner explicitly schedules/resumes it;
- `enabled=false` means no new scheduled wake may be produced;
- `next_wake_at` is the model-selected normal wake time except during explicit owner bootstrap/resume or exceptional recovery;
- `last_valid_wake_at` changes only after a valid `contact` or `quiet` wake finalizes;
- `control_revision` changes when an explicit control action invalidates older execution, including Pause, Resume, Wake now, and Recovery;
- `active_wake_run_id` prevents overlapping Sentinel execution;
- the model cannot write `enabled`, `policy_prompt`, `control_revision`, ownership, or active-run fields.

### Policy prompt

`policy_prompt` is user-authored long-lived behavior guidance. It may contain preferred autonomous-chat style, allowed low-risk activities, sleep/availability background, or other bounded rules.

It must not be copied into normal logs. The product applies a bounded size limit; implementation should follow repository validation conventions, with an expected order of magnitude of a few thousand Unicode code points rather than unbounded prompt storage.

Policy edits do not by themselves cancel an already active Wake Run. A wake that calls `sentinel_get_state` after the edit sees the new policy. A wake that already read the old policy may finish under that prior snapshot; the user uses Pause when an immediate hard stop is required. This small race is accepted rather than creating hidden schedule loss during ordinary policy editing.

### Wake context capsule

The capsule is model-maintained short working context, not a transcript or memory database.

Fixed rules:

- replace, never append indefinitely;
- factual/minimal rather than speculative;
- no requirement to duplicate Todo/Diary/domain records;
- maximum 1,024 Unicode code points;
- capsule text is not emitted to normal operational logs.

## 6. Wake Run model

Expected logical shape:

```text
sentinel_wake_runs
  id
  sentinel_id
  user_id
  control_revision
  cause                    scheduled | wake_now | recovery
  scheduled_for
  triggered_at
  bridge_event_id
  state                     bridge_enqueued | claimed | finalized | superseded | recovery_required
  decision                  nullable | contact | quiet
  next_wake_at              nullable
  claimed_at                nullable
  finalized_at              nullable
  failure_code              nullable safe code
  created_at
  updated_at
```

The Wake Run does not duplicate Phase 1 transport state or Phase 2 processing state. Those remain in Bridge records.

`superseded` is a terminal Wake Run state, not a normal model social decision. A model-visible turn for a run that has already become superseded must not produce substantive autonomous content.

Enforce at most one non-terminal active Wake Run per Sentinel using database constraints/locking rather than UI assumptions.

Wake Run history is operational metadata rather than conversation history. Terminal Wake Runs have a target retention of 30 days.

### Claim synchronization

For a Sentinel-origin Bridge event, the Phase 2 claim transaction gets one additive Phase 3 hook:

```text
bridge processing: unclaimed -> claimed
+
Wake Run: bridge_enqueued -> claimed
Wake Run.claimed_at = authoritative model_claimed_at
```

These updates commit in the same PostgreSQL unit of work. Duplicate Phase 2 claims remain idempotent and do not move timestamps.

This gives the Sentinel an exact durable claim timestamp for the 15-minute stalled-processing rule without treating a later state-read call as proof of claim.

## 7. No authoritative automatic USER_RETURN timestamp

The previous Scheduled Task prompt carried fields such as `LAST_USER_RETURN_AT` because the task had to emulate cross-run state inside one giant prompt.

Phase 3 deliberately does not pretend the LeileiOS backend receives an event for every normal user message written directly in ChatGPT. Therefore:

- no server field is treated as authoritative proof of ordinary ChatGPT user return unless LeileiOS genuinely observed it;
- a wake model turn may use current visible conversation context to notice that the user has recently been active and choose `quiet`;
- no backend idle-duration arithmetic is required to decide whether a scheduled wake is eligible;
- future host capabilities may add richer observation signals without changing the core Sentinel loop.

This removes the fragile `LAST_USER_RETURN_AT` / idle-delay state machine from the old Scheduled Task design.

## 8. Scheduler architecture

Run one lightweight scheduler loop inside the existing backend deployment. Do not create a second scheduler product, queue, database, or authentication surface.

PostgreSQL provides concurrency control. Expected polling cadence is approximately 30 seconds in production, with bounded jitter allowed. Correctness must not depend on exact polling frequency.

A scheduled Wake Run is created only when:

```text
sentinel.enabled = true
AND sentinel.next_wake_at <= now()
AND sentinel.active_wake_run_id IS NULL
```

The due-wake transaction must:

1. lock/claim the due Sentinel using repository-safe PostgreSQL concurrency primitives such as `FOR UPDATE SKIP LOCKED` or an equivalent conditional update;
2. re-check due/enabled/active-run predicates inside the transaction;
3. create exactly one Wake Run with the current control revision;
4. create exactly one Sentinel Bridge event with an idempotency identity derived from that Wake Run;
5. set `active_wake_run_id`;
6. clear/consume the due `next_wake_at` so another scheduler tick cannot create a duplicate;
7. commit atomically.

If this transaction fails, neither the Wake Run nor the consumed schedule may partially survive. The next scheduler scan may retry safely.

Multiple backend instances are allowed; database locking must still yield at most one active Wake Run per Sentinel.

## 9. Listener unavailable and delayed wakes

Phase 3 does not claim to wake a ChatGPT host that has no active listener.

If a Sentinel Wake Run is durably enqueued while the listener is unavailable:

- the Bridge event remains pending under inherited Phase 1 semantics;
- the scheduler creates no second Wake Run because `active_wake_run_id` remains occupied;
- when a valid listener becomes active again, the pending wake may dispatch;
- hidden context includes both `scheduled_for` and actual dispatch timing so the model can recognize a late wake and choose a sensible `quiet`/next schedule;
- the product surfaces truthful `Waiting for ChatGPT` state rather than pretending the wake occurred on time.

A long-delayed but definitely pending wake is not duplicated merely because its scheduled time is old.

## 10. Bridge producer, reservation, and pre-dispatch cancellation

Add one trusted Bridge origin/producer identity for Sentinel execution, using existing Phase 1 source/kind conventions where possible rather than creating an unnecessary generic automation framework.

Conceptually:

```text
source/producer = leileios_sentinel
kind            = wake
```

The visible user-role wake text is deliberately short and unmistakably automated:

```text
[LeileiOS Sentinel wake]
```

Do not put full policy, capsule, or mutable LeileiOS state in visible text.

Hidden model context carries bounded routing/execution metadata:

```text
eventId
wakeId
sentinelId
controlRevision
scheduledFor
dispatch timing when available
instruction to claim first
instruction to read fresh Sentinel state
instruction that quiet is valid
instruction that successful valid completion must choose a next wake
```

The model fetches current policy/capsule through an authenticated tool after claim, preventing dispatch-time policy snapshots from becoming the long-lived authority.

### Reservation priority

The only two dispatch classes needed in Phase 3 are:

```text
human
sentinel_wake
```

Reservation order is:

```text
human > sentinel_wake
```

Existing human PWA events retain their current no-expiry/no-coalescing behavior. Sentinel wakes do not preempt pending human intent. FIFO/stable ID order applies within a class.

### Safe cancellation before dispatch

Phase 3 may add one orthogonal cancellation/suppression marker for Sentinel Bridge events, such as `cancelled_at`, only for server-owned pre-dispatch cancellation.

A superseding control action may mark the old Sentinel event ineligible only when host dispatch definitely has not started:

```text
pending
or
reserved with dispatch_started_at IS NULL
```

Reservation/dispatch selection must exclude cancelled Sentinel events.

If `dispatch_started_at IS NOT NULL`, `host_sent`, or `delivery_unknown`, Phase 3 must not claim cancellation or rewrite transport truth. The old Wake Run becomes superseded, and any late model turn is semantically suppressed by control revision checks.

## 11. MCP App resource contract

Because Phase 3 changes model-visible wake instructions and adds Sentinel tools, use:

```text
ui://leileios/message-bridge/v3
```

The earlier planning-only Phase 3 also reserved `v3`, but that design was never implemented or production accepted. There is no deployed v3 compatibility contract to preserve. The new Autonomous Sentinel Phase 3 owns the actual v3 contract.

Old cached v1/v2 listener cards are not Phase 3 acceptance evidence. Production acceptance requires a freshly opened v3 listener card.

Phase 3 does not depend on a permanent named ChatGPT conversation ID. The currently accepted active listener is the destination authority.

## 12. Model-visible Sentinel tools

### 12.1 `sentinel_get_state`

Conceptual input:

```text
sentinel_get_state(wakeId)
```

The server derives the authenticated user from the existing MCP session.

Requirements:

- Wake Run must belong to the authenticated owner;
- correlated Bridge event must have a valid Phase 2 claim;
- Wake Run must still be the Sentinel's active run;
- Wake Run control revision must still match current Sentinel control revision;
- Sentinel must remain enabled;
- invalid/superseded state returns owner-safe bounded metadata and no mutable authority;
- return only state needed for judgment: policy, capsule, schedule metadata, last valid wake time, current time/timezone, and scheduling limits.

The model never supplies user ID, policy, control revision, or authorization state.

### 12.2 `complete_sentinel_wake`

Conceptual input:

```text
complete_sentinel_wake({
  wakeId,
  decision: "contact" | "quiet",
  nextWakeAt,
  contextCapsule
})
```

This is the core Phase 3 transaction.

For a valid active wake it must atomically:

1. re-check owner, active Wake Run, Sentinel enabled state, and matching control revision;
2. require the correlated Bridge processing state to be `claimed`;
3. validate `decision`;
4. validate `nextWakeAt` against server scheduling bounds;
5. validate/normalize the capsule;
6. write Wake Run decision, next wake, and finalization timestamp;
7. update Sentinel `last_valid_wake_at`;
8. replace Sentinel capsule and timestamp;
9. write Sentinel `next_wake_at`;
10. clear `active_wake_run_id`;
11. advance Sentinel control revision;
12. mark the correlated Phase 2 Bridge processing state completed using the same database unit of work;
13. commit all changes together.

For Sentinel events, this tool subsumes the ordinary `bridge_event_complete` step so Sentinel finalization and processing completion cannot split into two successful-but-inconsistent commits.

The tool is idempotent for the same finalized Wake Run and same normalized payload. A conflicting second completion is rejected safely.

## 13. Wake response contract

A valid model wake has two user-facing decisions.

### Contact

`contact` means the model genuinely has substantive content it wants to communicate under current policy/context.

After successful `complete_sentinel_wake(decision=contact, ...)`, the assistant emits a natural response in the official ChatGPT conversation. It should not explain the scheduler mechanism unless that is itself relevant.

### Quiet

`quiet` means the model woke, inspected state/context, and found no substantive reason to initiate a conversation.

After successful `complete_sentinel_wake(decision=quiet, ...)`, emit only one minimal heartbeat. The Phase 3 default is:

```text
醒了一下，没事。
```

The purpose is observability, not conversation generation. Quiet must not expand into fabricated topics merely because a visible assistant turn exists.

Phase 3 does not require true zero-output host behavior.

## 14. Superseded wakes and Pause

A Wake Run becomes superseded when explicit persisted control state makes its captured control revision invalid or an owner recovery replaces the run.

Pause is the hard-stop owner action. It must atomically:

- set `enabled=false`;
- clear normal `next_wake_at`;
- advance control revision;
- if an active Wake Run exists, mark that run superseded and clear `active_wake_run_id`;
- if its Bridge event is definitely pre-dispatch, mark that event cancelled/ineligible and release any pre-dispatch reservation safely;
- if dispatch may already have started, preserve Bridge transport/processing evidence unchanged and rely on stale control revision to suppress semantic action.

If an already-superseded Bridge turn later reaches the model, `sentinel_get_state` refuses normal autonomous execution. The model must not call `complete_sentinel_wake`. It should close the correlated Phase 2 processing lifecycle with ordinary `bridge_event_complete(eventId)` after it has recognized the superseded event, then emit only a minimal non-substantive acknowledgement.

A superseded run:

- does not update `last_valid_wake_at`;
- cannot overwrite a newer `next_wake_at` or capsule;
- cannot re-enable the Sentinel;
- cannot successfully call normal `complete_sentinel_wake`.

Ordinary recent user conversation activity that LeileiOS did not directly observe is not represented as a fake server revision. The model handles that socially by choosing `quiet` from current conversation context.

## 15. Scheduling bounds

Phase 3 needs guardrails against accidental self-wake loops while preserving dynamic timing.

Default production bounds:

```text
minimum normal next wake interval: 5 minutes
maximum normal next wake horizon: 7 days
```

These are server-enforced against authoritative server time.

Acceptance/test environments may use a separately configured shorter minimum so multi-wake tests do not take hours. Test-only timing overrides must not silently change production limits.

The model cannot set a wake in the past, bypass the minimum, or use an unbounded far-future timestamp.

## 16. Initial setup, Pause, Resume, Resume now, Wake now

### Initial setup

The owner creates/updates the single Sentinel policy/timezone through the product API. The first row is disabled by default.

Enabling begins through Resume. The UI defaults to a disclosed 15-minute first/resume delay, while allowing a different valid future time within server bounds.

For immediate first use from a paused/disabled state, use `Resume now`: it atomically enables the Sentinel and creates one immediate Wake Run instead of pretending an ordinary future schedule already existed.

### Pause

Pause follows the hard-stop transaction in Section 14. A stale in-flight wake cannot re-enable itself or schedule around Pause.

### Resume

Resume requires the Sentinel to be idle/paused and establishes one fresh future `next_wake_at`. It:

- sets `enabled=true`;
- advances control revision;
- writes a validated fresh schedule;
- leaves no active Wake Run.

Resume never silently reuses an already-missed pre-pause due time.

### Resume now

Resume now requires a disabled Sentinel and no active Wake Run. In one transaction it:

- sets `enabled=true`;
- advances control revision;
- creates exactly one immediate Wake Run + Sentinel Bridge event;
- sets it active;
- leaves normal `next_wake_at` null until that wake finalizes.

### Wake now

Wake now requires an enabled Sentinel.

- if no active Wake Run exists, invalidate the old normal schedule, advance control revision, and create one immediate Wake Run through the same transactional Bridge producer path;
- if an active Wake Run already exists, do not create a second overlapping run; return the existing active state / safe conflict;
- after the immediate wake finalizes, the model chooses the new normal `next_wake_at`.

## 17. Failure and recovery semantics

### Definite local/database failure before enqueue commit

If the due-wake transaction fails before commit, no schedule is consumed. The next scheduler scan may retry safely.

### Listener absent

Leave the single active wake pending. Do not create a successor wake merely because delivery is delayed.

### Phase 1 definite host rejection

Use inherited Phase 1 safe release/retry behavior. Do not create another Wake Run while the same run remains active.

### `delivery_unknown` + unclaimed

This is ambiguous host delivery. Preserve Phase 1 quarantine and do not blind replay automatically.

The Sentinel UI exposes `Recovery required`. An explicit owner recovery action must atomically:

1. advance Sentinel control revision;
2. mark the old Wake Run superseded;
3. clear it as active;
4. preserve the old ambiguous Bridge transport evidence unchanged;
5. create exactly one new `recovery` Wake Run and Bridge event;
6. make that new run active.

If the old ambiguous turn later reaches the model, its control revision is stale. It cannot produce substantive autonomous action or overwrite the new schedule; after recognizing supersession it closes only its own Phase 2 processing lifecycle and emits the minimal acknowledgement.

### Claimed but not finalized

If the model has claimed the wake but no Sentinel finalization arrives within a bounded operational timeout, expose `Recovery required` rather than inventing a successful next wake.

The initial Phase 3 timeout is 15 minutes after authoritative Phase 2 claim/Wake Run `claimed_at`. No automatic successor Wake Run is created. Owner-initiated Recovery uses the same supersede-before-successor rule.

### Finalization retry

`complete_sentinel_wake` is idempotent. A model/tool retry with the same normalized finalization payload returns the already-committed result. Conflicting payloads fail rather than rewriting the schedule.

### Backend restart

On restart:

- scheduler resumes scanning PostgreSQL due state;
- active Wake Runs remain active because they are durable;
- no in-memory timer is required to reconstruct correctness;
- reconciliation derives exceptional UI state from durable Sentinel/Wake/Bridge facts.

## 18. Minimal product UI

Add one small authenticated `/sentinel` surface inside the existing shared LeileiOS shell. It is a control/status page, not a chat product.

Expected first version:

```text
Autonomous Wake      ON

Next wake            04:30
Last valid wake      02:15 · Quiet
Current state         Sleeping / Waiting for ChatGPT / Processing / Recovery required

Wake policy
[ editable long-lived policy ]

[Wake now] [Pause]
```

When paused, show Resume and Resume now controls. Before Resume confirms, show the planned first wake time/delay.

Show only a bounded recent Wake Activity list, for example:

```text
02:15  Quiet     next 04:30
00:51  Contact   next 02:15
23:10  Superseded
```

The main control card does not expose Bridge implementation enums. Technical drill-down may reuse System Activity for safe operational detail.

No `/chat` route, native transcript, Todo contextual chat, or Chat unread badge is required by Phase 3.

## 19. Web/API surface

Expected owner-scoped product operations:

```text
GET    /api/sentinel
PUT    /api/sentinel               create/update policy + timezone; one row per user
POST   /api/sentinel/pause
POST   /api/sentinel/resume        explicit validated future first/next schedule
POST   /api/sentinel/resume-now    enable + immediate first wake
POST   /api/sentinel/wake-now      enabled Sentinel only
POST   /api/sentinel/recover       only when recovery is legitimately required
GET    /api/sentinel/wakes         bounded recent activity
```

Exact routing may follow current repository conventions during implementation.

Requirements:

- authenticated owner derived server-side;
- strict request schemas;
- one Sentinel row per owner;
- control mutations use idempotency where repeated network submission could duplicate effects;
- cross-user lookup/mutation returns owner-safe not-found behavior;
- mutations return authoritative persisted readback;
- browser/local storage is not the canonical schedule;
- policy updates are allowed while enabled, but Pause is the only immediate hard-stop control.

## 20. Security and authority

The model may:

- read current Sentinel policy/state for a claimed wake;
- choose `contact` or `quiet`;
- choose a bounded future next wake;
- replace the bounded wake capsule;
- use other currently authorized low-risk MCP tools under their existing contracts.

The model may not:

- change `policy_prompt`;
- set `enabled=true` after the user paused it;
- change owner/user ID;
- create a second Sentinel;
- create arbitrary Bridge destinations;
- bypass next-wake time bounds;
- mutate stale/superseded Wake Runs;
- invoke owner recovery;
- override Phase 1 transport ambiguity.

IDs are correlation, never authentication.

## 21. Observability and privacy

Safe operational observability may include:

```text
sentinel id
wake run id
bridge event id
control revision
cause
wake state
decision
scheduled/triggered/claimed/finalized timestamps
next wake timestamp
safe failure code
transport/processing enums via System Activity
```

Do not place in normal logs:

- policy prompt text;
- wake context capsule text;
- hidden model context;
- auth tokens or session secrets;
- raw database errors/stack traces containing sensitive values.

Wake Activity is metadata, not a second ChatGPT transcript.

## 22. Data lifecycle

- Sentinel row: long-lived until a separately reviewed product reset/delete operation.
- Policy/capsule: user-owned Sentinel state, replaced/edited in place according to product actions.
- Terminal Wake Runs: bounded operational retention, target 30 days.
- Bridge records: retain inherited Phase 1/2 retention semantics; Phase 3 does not make them permanent.
- No assistant message bodies are persisted by Sentinel.

No lifecycle action may create a fictional claim that an already-visible ChatGPT turn has been retracted.

## 23. Product status projection

The Sentinel page derives a small product state without persisting a giant `overall_status` enum.

Priority:

1. `enabled=false` -> `Paused`
2. active wake with recovery-required evidence -> `Recovery required`
3. active wake processing claimed -> `Processing`
4. active wake pending/transporting -> `Waiting for ChatGPT`
5. enabled with future `next_wake_at` -> `Sleeping`
6. enabled with due schedule awaiting the next scheduler scan -> `Waking`

System Activity remains the place for raw transport/processing truth.

## 24. Production acceptance

Phase 3 cannot be called production accepted from unit tests alone.

A fresh same-release acceptance must prove the real loop across production backend, LeileiOS Web/PWA, and a freshly opened official ChatGPT v3 listener.

### Core autonomous loop

Demonstrate at least three consecutive real wake generations:

```text
Wake #1
-> model claim
-> quiet
-> next wake chosen and durably committed

Wake #2
-> model claim
-> contact
-> natural assistant message appears in official ChatGPT
-> next wake chosen and durably committed

Wake #3
-> model claim
-> quiet
-> next wake chosen and durably committed
```

After each wake, production readback must show one finalized Wake Run and one authoritative future `next_wake_at`.

### Required failure/control cases

Production or production-equivalent exact-runtime acceptance must also prove:

- initial create is disabled until explicit Resume/Resume now;
- duplicate scheduler scans create only one Wake Run;
- concurrent backend instances still create only one active Wake Run;
- human Bridge work is reserved before Sentinel wake work;
- backend restart does not lose `next_wake_at` or duplicate an active wake;
- listener absence leaves one pending active wake and truthful UI state;
- listener return dispatches the pending wake without creating a second run;
- Pause cancels/suppresses definitely pre-dispatch wake work and supersedes any wake that may already have entered host dispatch;
- a superseded late model turn cannot contact substantively or alter the newer schedule, and can close only its own Phase 2 processing lifecycle;
- Resume establishes one fresh future wake schedule;
- Resume now creates one immediate first wake from paused state;
- Wake now creates no overlap with an already active wake;
- stale/superseded control revision cannot overwrite newer Sentinel state;
- Phase 2 claim and Wake Run `claimed_at` synchronize idempotently;
- `complete_sentinel_wake` retry is idempotent;
- conflicting finalization is rejected;
- invalid too-soon/too-far next wake is rejected;
- `delivery_unknown + unclaimed` does not blind replay and exposes recovery-required state;
- claimed-but-unfinalized wake becomes recovery-required after 15 minutes;
- explicit recovery retires the old run before creating one successor;
- cross-user Sentinel/Wake access is not observable;
- normal logs do not contain policy/capsule/auth secrets.

### Host behavior acceptance

The official host must demonstrate both:

```text
contact -> substantive natural assistant message
quiet   -> only the minimal heartbeat, no fabricated substantive topic
```

True zero-output quiet behavior is not required.

### Acceptance meaning

When all Phase 3 gates pass, the old Scheduled Task Sentinel may be retired for normal use. The resulting product is the durable LeileiOS autonomous wake loop:

```text
sleep -> wake -> judge -> contact/quiet -> choose next wake -> sleep again
```

Future Todo/Diary/Current State integrations are enhancements to what the awakened model can inspect, not prerequisites for using Sentinel.

## 25. Migration and rollout safety

Phase 3 adds new durable Sentinel tables/fields, additive Sentinel-specific Bridge eligibility/correlation fields where necessary, and a new v3 App/tool contract. Implementation must use the repository's established migration safety process:

- fresh production preflight;
- backup before production schema change;
- disposable restore/migration rehearsal;
- exact migration readback;
- canonical test/typecheck/build gates;
- exact-head deploy verification;
- production database/API readback;
- freshly opened v3 host acceptance.

No migration rewrites existing Phase 1/2 message bodies or fabricates Sentinel history from old Bridge events.

## 26. Dependency and implementation gate

This document is planning-only.

Phase 3 implementation planning and code begin only after Phase 2 is production accepted, unless the user explicitly relaxes the planning dependency. Phase 3 must never merge/deploy on an unaccepted Phase 2 runtime contract.

The previous Phase 3 and Phase 4 planning branches remain historical references and must not be used as active implementation requirements after this spec is approved.
