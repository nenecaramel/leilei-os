# Native Session switching: state audit (2026-10-20)

Read-only audit. No code was changed. It maps the state that decides whether a
native turn may run or a Desktop ⇄ LeileiOS switch may happen, and the places
where several owners hold the same fact. Line numbers are for `main` at
`b79518d2` (#1184). A PR number means the PR's description or diff; an
unnumbered SHA is a commit pushed directly to `main`.

Short names used below:

| Short name | File |
| --- | --- |
| `admission` | `src/domains/bridge/relay/native-live-execution-admission.ts` |
| `exec-lease` | `src/domains/bridge/relay/native-live-execution-lease.ts` |
| `input-binding` | `src/domains/bridge/relay/native-live-input-binding.ts` |
| `bg-repo` | `src/domains/bridge/relay/native-live-background-result-repository.ts` |
| `bg-message` | `src/domains/bridge/relay/native-live-background-message.ts` |
| `prepare` | `src/domains/bridge/turn/turn-repository/prepare.ts` |
| `finalize` | `src/domains/bridge/turn/turn-repository/finalize-success.ts` |
| `resume-cp` | `src/domains/bridge/turn/native-live-resume-checkpoint.ts` |
| `wake-cursor` | `src/domains/bridge/turn/turn-repository/wake-resume-cursor.ts` |
| `silence-wake` | `src/domains/bridge/turn/native-live-silence-wake.ts` |
| `cont-repo` | `src/domains/conversation/native-session-continuation-repository.ts` |
| `history-repo` | `src/domains/conversation/native-session-history-repository.ts` |
| `lifecycle` | `src/domains/conversation/native-live-conversation-lifecycle.ts` |
| `conv-repo` | `src/domains/conversation/native-live-conversation-repository.ts` |
| `executor` | `src/domains/bridge/mac/native-live-mac-persistent-executor.ts` |
| `p-runtime` | `src/domains/bridge/mac/native-live-mac-persistent-runtime.ts` |
| `router` | `src/domains/bridge/mac/native-live-mac-persistent-turn-router.ts` |
| `loop` | `src/domains/bridge/mac/native-live-mac-daemon-loop.ts` |
| `mac-admission` | `src/domains/bridge/mac/native-live-mac-execution-admission.ts` |
| `bg-sink` | `src/domains/bridge/mac/native-live-mac-background-result-sink.ts` |
| `protocol` | `src/domains/bridge/protocol/native-live-execution-admission.ts` |
| `switch` | `tools/claude-bridge/src/native-session-continuation.mjs` |
| `drain-sock` | `tools/claude-bridge/src/native-session-daemon-drain.mjs` |
| `preflight` | `tools/claude-bridge/src/native-session-switch-preflight.mjs` |
| `restore` | `tools/claude-bridge/src/native-session-switch-restore.mjs` |

## Summary

- There is no single "who owns this native Session" record. Ownership is
  spread over at least six stores that are written at different moments:
  - the server `nativeSessionSource.owner` flag;
  - the server `native_live_presentation_owner` JSON;
  - the listener lease row;
  - the Mac executor's in-memory `suspended` map;
  - the local recovery directories;
  - the native peer files under `~/.claude/sessions`.
- The "where does the next native turn resume from" cursor is derived again
  in six places, each with its own rules. Five ledger failures were two of
  these derivations disagreeing.
- `native_live_presentation_owner` does three jobs: it is the UI's visible-turn
  slot, the admission token for one preparation, and the generation identity
  that background results and the resume tail bind to. Every foreground
  prepare rotates it (`prepare:711-718`), including one that is later rejected.
  This rotation caused the Wake/Cron HTTP 409 incidents.
- Whether a command may run on the persistent writer is decided in five places:
  - `executor.canRoute`;
  - the `loop` routing;
  - `mac-admission`;
  - the `protocol` parser;
  - the server `admission` SQL.

  Eight ledger failures were these places disagreeing, or a fallback to the
  one-shot executor dropping native Cron.

## 1. State owner inventory

### 1.1 Server (Postgres)

| # | State | Where it lives | Writers | Readers | Duplicates / must agree with |
| --- | --- | --- | --- | --- | --- |
| S1 | **Conversation head** | `conversations.current_head_message_id` | finalize (commit of F/Wake); `bg-message` (canonical background B append); edit/retry purge | `prepare:94-102` (STALE_HEAD CAS); `admission:33-34,63`; `input-binding:78,97`; `cont-repo:60,101` (switch CAS); `bg-repo:226,412`; `wake-cursor:51` | S2's `anchorHeadMessageId` must equal it (`presentation-owner.ts:9-16`). During preparation the head deliberately stays at the user message's **parent** (#1118). |
| S2 | **Presentation owner** `{prepareId, anchorHeadMessageId}` | `conversations.provider_metadata.native_live_presentation_owner` (JSON) | rotated by every prepare: `prepare:711-718`; anchor advanced on F/Wake commit: `finalize:396-421`; anchor advanced on background commit: `bg-message.ts:71-74`; owner **reclaimed** after a rejected send: `bg-repo:121-150` (#1143/#1146) | `admission:35-41,52-53`; `input-binding:33-34,61-62`; `resume-cp:21`; `bg-repo:227-228` (generation match); `wake-cursor:47`; `presentation-owner.ts` (purge/commit) | It doubles as the **writer generation id**. The checkpoint `runtime_metadata.native_live_generation.presentation_owner_id` must equal it (`bg-repo:227`). It also duplicates S1 through its anchor. |
| S3 | **Native source binding** (`nativeSessionSource`: `mode`, `sessionId`, `checkpointId`, `revision` = ownership generation, `nativeRevision`, `previousRevision`, `headMessageId` = handoff anchor, `owner`, `lineage`) | `conversations.provider_metadata.nativeSessionSource` | continuation attach/release: `cont-repo:76-121` (rotates `revision` at `:113`); legacy complete-history path flips `owner` **without rotating `revision`**: `history-repo:369-370,494-495` | owner predicate, copied 15×: `admission:28`; `input-binding:32,60`; `resume-cp:20`; `wake-cursor:52`; `bg-repo:144,234,288`; `native-live-task-control-repository.ts:46`; `conv-repo:27-32` → `prepare:78,211,337`; `native-live-manual-compact.ts:181`; `native-session-asset-repository.ts:28`; `silence-wake:749`. `revision`: `admission:54-55,132`; `input-binding:30,71`; `resume-cp:19`; `bg-repo:230`. Anchor/cursor: `prepare:570-602`; `admission:78-96`; `input-binding:118-124`; `cont-repo:66-71` | `owner` duplicates the Mac handoff fence (M1). `checkpointId` at the anchor is one of the six cursor sources (see 1.4). A missing binding means `owner='leileios'` through `coalesce` in every predicate, so there is no explicit "none" owner. |
| S4 | **Turn preparation** (`status`, `dispatch_status` ∈ staged/pending/reserved/executing/delivery_unknown/completed, `operation`, `runtime_mode`, parent session/checkpoint, `reserved_by`, `reservation_expires_at`) | `native_live_turn_preparations` | `prepare` (insert), relay reserve/start/finalize, Wake deferral reject (#1180) | `admission:12-27`; `exec-lease:16-23`; `lifecycle:335-343` (in-flight); `cont-repo:89-94` (switch BUSY); wake-admission user-wide foreground check `admission:57-62`; `bg-repo:236-241` | `parent_provider_checkpoint_id` is rewritten at native start by S6 (`input-binding:164-166`). `prepareSend` itself has no in-flight check (`prepare:70-119`). A second send supersedes the first only through the S2 rotation. |
| S5 | **Execution lease** | `native_live_turn_preparations.reservation_expires_at` (60s) | `exec-lease:11-37`, which also extends S7 at `:25-27` | `admission:26`; `input-binding:26,54` | Renewal re-runs the full admission predicate (`exec-lease:20`). Every admission bug therefore also shows up as "Execution lease was not renewed." (#1118, #1176). |
| S6 | **Input binding marker** `{identity, sourceRevision, started, parentProviderCheckpointId}` | `native_live_turn_preparations.runtime_metadata.native_live_input_binding` | `input-binding:42-169` (queued, then started) | `admission:111-113`; `input-binding:20-36`; `bg-repo:217-218,240-241` | It re-derives the cursor (`input-binding:108-160`). This must agree with `prepare`'s `resolveRuntimeParent` and with `admission` (#1174). |
| S7 | **Listener lease** | `native_live_runtime_listener_leases` (one row per user + `claude_code`, 60s) | acquire/renew: `native-live-backend-relay.ts:~290-352`; extended by `exec-lease:25` and `renewNativeLiveSessionLease` (`exec-lease:40-55`) | `admission:14-15,26`; `input-binding:24-27,65-67`; `bg-repo:204-206,422-425` | It is renewed from four Mac call sites (M6). The Mac daemon process lock (`native-live-mac-daemon-lock.ts`) is a separate per-Mac single-instance owner. |
| S8 | **Canonical provider checkpoint + resume tail** | `conversation_provider_session_checkpoints` (`provider_checkpoint_id`, `runtime_metadata.native_live_generation`, `.native_live_resume_tail`, `.native_live_background_receipt`) | finalize; background commit; quiet Wake tail: `bg-repo:586`, `wake-cursor:129` | `resume-cp:8-37` (tail wins only when the generation and owner still match); `prepare:640-661`; `admission:83-138`; `input-binding:99-114`; `cont-repo:58-60` | Two cursors in one row: the base checkpoint and the hidden tail (introduced by 1e6c7669). |
| S9 | **Background receipts** (phase prepared → queued → committed/stale/failed; `executionStart`, `deferred`, `expiresAt` 10 min) | `native_live_runtime_events` (`kind=persistent_background_receipt_v1`) | `bg-repo:382-458` (prepare); `bg-repo:460-595` (submit) | `admission:116-135` (deferred producer cursor); `input-binding:129-160`; `bg-repo:443-449` (execution-start busy) | A third kind of "busy" that `cont-repo:89-94` does **not** check. Release relies only on the Mac drain settle (M2) and the local directory gate (L2). |
| S10 | **Wake schedule, epochs, receipts, concerns** | silence-wake schedule/receipts; `native_live_concerns` (#1179) | `silence-wake`; concern MCP tool | Wake admission `admission:49-70` (user-wide foreground check and "latest user message across all native surfaces"); `handedOff` `silence-wake:293,503,749` | Owner check through S3. The Mac local on/off switch (L4) is a separate gate. |
| S11 | **Manual compaction** | `native_live_manual_compactions` (pending/reserved) | compact route | `cont-repo:90-94`; `history-repo:255-260` | Part of the switch BUSY check only. |
| S12 | **Provider session store mirror** (SDK SessionStore entries + `complete/incomplete` status) | `native_live_provider_session*` tables | Mac `native-live-mac-provider-session-store.ts` appends; `preserveExternalSession` (`cont-repo:109`) | Legacy release requires `complete` (`history-repo:490-492`). The continuation release does not read it. | Duplicated by the local append-receipt directory (L2). |

### 1.2 Mac daemon (memory, rebuilt or lost on restart)

| # | State | Where | Writers | Readers | Duplicates / must agree with |
| --- | --- | --- | --- | --- | --- |
| M1 | **Executor fence** `suspended: Map<conv, Set<"handoff"\|"recovery">>` | `executor:35-49` | `handoff`: drain (`p-runtime:144,151`); lifted only by `resumeHandoff` (`executor:44-47`) through the socket `resume` (#1114). `recovery`: `p-runtime:47-48,116,120,124-126,146,154`; `loop:489` | `executor.assertAccepting:49` (throws **"fenced for handoff" for either reason**); `canRoute:72`; `shouldDeferWake:92` | `handoff` duplicates S3 `owner` and is lost on restart. `recovery` duplicates L2 and M3. |
| M2 | **Drain receipt** `{ready, tasks, writer}` | `native-live-mac-session-drain.ts:3-34`; `p-runtime:139-162`; socket `drain-sock:17-80` | `switch:22` (Desktop direction only) | `switch:23` | It overlaps the peer-release check (L3): both answer "nobody is writing the native file". The daemon's own SDK child also counts as a peer, which is why #1112 added a settle loop. |
| M3 | **Result recovery set** | `loop.resultRecoveryConversations` `loop:43,487-503` | terminal-result quarantine | `loop:189,394,420` | A third per-conversation fence beside M1 `recovery` and the router flag (M5). |
| M4 | **Writer registry / generation** | `native-live-mac-session-registry.ts:16-22,89,106-112` (`generationId`, `retired`, session state) | router startup, retire, close | `router.matches:298-309`; `p-runtime:103,140-141` | The Mac generation is a fresh `randomUUID()`. It is not the server generation (S2/S3). |
| M5 | **Router state** (`suspended`, `active`, `providerCheckpointId`) | `router:298-318` | router | `executor.canRoute:73-83` | `providerCheckpointId` is the Mac-side cursor copy. `send` skips its equality check when `bindInput` exists (`router:306-307`). |
| M6 | **Listener lease renewers** | `loop:81-95` (dispatch, #1184); `native-live-mac-background-lease.ts:11-28` (periodic replay, `p-runtime:51-69,136`); router execution lease (`router:142-144` → `native-live-mac-execution-lease.ts`, 20s); session-lease watchdog (`p-runtime:95-108`) | | | Four renewers of one 60s row (S7). The ordering bugs were #1147, #1156 and #1184. |
| M7 | **Routing capability** | `executor.canRoute:61-84`; `loop:284-318`; `mac-admission:54-57`; `router.matches:298-309` | code | | Must agree with `protocol:22-24` and `admission:29-139` (#1133, #1176, #1180). |

### 1.3 Mac local files and native peers

| # | State | Where | Writers | Readers | Duplicates / must agree with |
| --- | --- | --- | --- | --- | --- |
| L1 | **Background result outbox and quarantine** | `~/.leileios/background-results/<scope>/[blocked/]` | `bg-sink.commit` (saved before HTTP), quarantine on stale | M1 rebuild at startup (`p-runtime:42,125-126`); `bg-sink.hasPendingRecovery:269`; L2 | Server S9 |
| L2 | **Switch recovery gate** | `restore:193-218` scans `terminal-results`, `background-results` and `session-store-append-receipts` | — | `switch:25,40,51` | It blocks **globally**: any conversation's receipt stops every switch. The Mac fence (M1) is per conversation. Archive was given a per-session exception (#1151). |
| L3 | **Peer release** | `~/.claude/sessions/*.json` plus a process-start probe (`native-session-activity.mjs:45`) | Claude Desktop / CLI processes | `preflight:26,32-33` | Overlaps M2. Desktop honors no lease (`docs/native-session/continuation.md:63-64`). |
| L4 | **Native file and index revision pin** | JSONL and Desktop index snapshots | — | `preflight:24-31`; drain settle (#1112) | Pinned before the drain, then re-pinned after the settle (#1112). |
| L5 | **Native end-of-turn grammar** | `tools/claude-bridge/src/native-session-inspection.mjs:195` (allowed trailing records) | — | `preflight:25`; picker | It must track every CLI version (#1112, #1182). |
| L6 | **Local Wake switch** | `~/.leileios/wake/` (#1163) | `pnpm wake on/off` | Mac silence-wake scheduler | Separate from the server S10 and the backend global flag. |

### 1.4 The six cursor derivations

"Which native checkpoint does the next turn resume from" is computed by:

1. `prepare:570-602` (handoff binding vs canonical checkpoint vs resume tail) and
   `prepare:640-661` (ordinary branch).
2. `admission:72-138`, which uses five alternative OR branches.
3. `input-binding:108-160` (handoff anchor vs canonical checkpoint vs deferred-B
   producer tail).
4. `cont-repo:52-72` (`readNativeContinuationState`, used by the switch).
5. `bg-repo:200-245,420-442` (background snapshot and deferred producer chain),
   plus `wake-cursor:40-60`.
6. Mac `router.providerCheckpointId` (`router:306`).

## 2. Failure ledger (since #1109, 2026-10-16 01:18 +0800)

Source: `git log --first-parent main a477f10d^..b79518d2`, the PR descriptions, and
`docs/native-session/*.md` / `docs/testing/2026-10-20-*.md`. Features (#1109, #1124,
#1129, #1179) and diagnostics-only PRs (#1117, #1181) are not counted as fixes.

Category key:

- **R**: execution route or capability.
- **P**: presentation owner or turn token.
- **K**: native cursor or native-file validity.
- **H**: handoff fence or recovery gate.
- **L**: listener lease or transport.

| ID | Visible failure / code | Root cause (one line) | Owners that disagreed / missing transition | Fixed by | Cat |
| --- | --- | --- | --- | --- | --- |
| F1 | `NATIVE_INSPECTION_CHANGED` on LeileiOS → Desktop | The CLI pinned the native revision before the drain. The SDK child flushed `last-prompt`/`cost-state` after the drain receipt. | L4 file pin vs M2 drain receipt (and L3 peer) | #1112 | H |
| F2 | `NATIVE_TURN_UNFINISHED` after Desktop fork + compact | A `prompt_snapshot` / Stop-hook record sat between the final reply and its Stop receipt. | L5 inspection grammar vs actual CLI records | #1112 | K |
| F3 | Every send "Failed", `Persistent session is fenced for handoff` after switching back | Nothing ever lifted the drain's `handoff` reason. | S3 owner = leileios vs M1 still `handoff`; **missing transition** attach → unfence | #1114 | H |
| F4 | First send in a new or ordinary conversation: `RUNTIME_UNAVAILABLE` / "Execution lease was not renewed." | `prepare` leaves the head at the parent. Admission required head = user message, except for continuations. | `prepare` (S1/S2) vs `admission` (S5 renewal) | #1118 (diagnosed via #1117; #1113 was reverted by #1115, maybe needlessly) | P |
| F5 | Autonomous input rejected at background completion; next foreground picked a closed writer | Optional `UserPromptSubmit.source` was treated as a capability, and closed registry bindings were still selectable. | hook provenance vs scheduler admission; M4 closed binding vs router selection | #1125 | R |
| F6 | `CronCreate` blocked before execution | The bridge gated scheduling on `source`, which CLI 2.1.296 omits. | scheduling gate vs actual CLI hook input | #1126 | R |
| F7 | Native Cron lost after an **edited** message | edit → `runtime_mode: fork`. `canRoute` refused it, so the writer was retired and the turn ran in a one-shot process whose timers die. | M7 routing vs native scheduler lifetime; **missing transition** edit → persistent fork | #1133 | R |
| F8 | Wake forked or fell back to legacy and evicted native schedules; `session_cron_carry` dropped on checkpoint fork | Wake was not pinned to the same session; the fallback retired the writer. | M7 routing vs writer holding Cron | 2c453b95 | R |
| F9 | Next chat resumed a stale native checkpoint after a superseded or quiet Wake | A quiet Wake advanced the JSONL invisibly; the canonical checkpoint did not move. | S8 base checkpoint vs hidden native tail (cursor #1 vs native file) | 1e6c7669 (adds `native_live_resume_tail`) | K |
| F10 | Native Cron background result HTTP 409 and a permanently suspended SDK writer | A visible Wake advanced the head but not the presentation-owner anchor. | S1 head vs S2 anchor | 1f0cb906 (`finalize:396-421`) | P |
| F11 | Duplicate assistant row and scroll jump during canonical handoff (iOS) | The canonical message arrived before `activity.prepareId` attribution. | canonical prepare attribution vs runtime preparation (client view of S2/S4) | #1138 | P |
| F12 | Historical Wake receipt `/background-results/prepare` 409 after restart | A **rejected** foreground prepare rotated S2. The receipt renewal needs an identical snapshot. | S2 (rotated by a rejected turn) vs S9 receipt context / writer generation; the send was refused by M1 `recovery` with the text "fenced for handoff" | #1143 (`bg-repo:56-150`) | P |
| F13 | Same 409, `wakeSourceMatches=false` | The owner's assistant was not the Wake's immediate parent (earlier Cron or Wake hops). | S2 owner vs S1 chain | #1146 | P |
| F14 | Same receipt still 409 after #1146 | The background flush ran **before** listener-lease renewal, and an idle broker outlived the 60s lease. | M6 replay ordering vs S7 expiry | #1147 (#1148, #1149 are fixtures and gate wiring) | L |
| F15 | `leileios-archive.command`: `NATIVE_SESSION_RECOVERY_REQUIRED` | One quarantined background receipt blocked all archival. | L2 global gate vs per-conversation recovery (M1) | #1151 | H |
| F16 | `send_file is only available to the turn that owns the current reply.` (tool used first) | Tool ownership came from the latest *stamped* stream, not the native started command. | "current reply owner" from the stream vs S6 started binding | #1153 | P |
| F17 | Same `send_file` error, recurring | Relay omits `output_attachments_enabled` by default. The router checked `=== true`; the executor checked `!== false`. | router vs executor default (`executor:138`) | #1155 | R |
| F18 | Terminal delivery stuck; replay staled a valid receipt; handoff "ready" with quarantined receipts | Replay ran before lease reacquire; drain readiness ignored quarantine. | M6 vs S7; M2 readiness vs L1 quarantine | #1156 | L/H |
| F19 | Native Cron retired after a Wake rejected pre-submit; Cron denied while a foreground was queued; handoff blocked by empty quarantine dirs, complete-history resume, and strict post-drain metadata | The executor retired on any Wake failure. Scheduled tools were authorized against the queued foreground reservation instead of the native command. | `executor:186-190` vs writer holding Cron; S2/S6 token vs native command; L2 vs empty dir | #1159 | R/P/H |
| F20 | First send after Desktop → LeileiOS: input binding HTTP 409 | Admission used the handoff cursor; input binding used an older canonical checkpoint at the anchor. | cursor #2 (`admission:91-96`) vs cursor #3 (`input-binding:118-124`) | #1174 | K |
| F21 | After an SDK auth failure plus re-login, the next send was rejected as unsynchronized history | The native JSONL kept a synthetic error-assistant tail. | native file tail vs server cursor; **missing transition** "failed input, no output" | #1175 | K |
| F22 | Edit/retry: "Execution lease was not renewed." before any SDK event | The persistent route accepted edit/fork, but `mac-admission`, `protocol` and server admission allowed only send/wake. | M7 (`canRoute`) vs `mac-admission` vs `admission` | #1176 (one-shot fallback), then #1180 (persistent admission) | R |
| F23 | Wake deferral violated the pending-row DB constraint; edit/retry had no persistent admission | The deferral reject left lease fields set on a pending row. | Mac Wake deferral (`loop:193-199`) vs S4 constraint; M7 vs `admission` | #1180 | R |
| F24 | Both Desktop sessions missing from the switch menu: `NATIVE_TURN_UNFINISHED` | A nonblocking Stop-hook error record followed the completed reply. | L5 grammar vs CLI records (same as F2) | #1182 | K |
| F25 | Admission denied or 39 events dropped on HTTP 200 with a lost body | A wrapped `RELAY_RESPONSE_BODY_UNAVAILABLE` was treated as permanent. | transport vs admission retry policy | #1183 | L |
| F26 | Slow start before provider (two serial lease renewals per dispatch) | The background-replay helper and the dispatcher each renewed the lease. | M6 duplicate renewers | #1184 | L |
| F27 | Unexplained `RUNTIME_UNAVAILABLE` / "Persistent session admission denied" | Not established; only diagnostics were added. | unknown | #1117, #1181 (open) | — |

Counts:

| Category | Failures | Count |
| --- | --- | --- |
| R | F5, F6, F7, F8, F17, F19, F22, F23 | 8 |
| P | F4, F10, F11, F12, F13, F16, F19 | 7 |
| K | F2, F9, F20, F21, F24 | 5 |
| H | F1, F3, F15, F18, F19 | 5 |
| L | F14, F18, F25, F26 | 4 |

## 3. Draft state machine

Per native Session (= one LeileiOS conversation with one current provider
Session). Owner and turn are tracked separately; in the code these are spread
over S2–S9 and M1–M5.

**Owner states:**

- **L**: LeileiOS owns it (S3 `owner` is `leileios`, or the binding is missing).
- **L→D**: draining. M1 has `handoff`, but S3 is still `leileios`.
- **D**: Desktop owns it (S3 `owner = desktop`).
- **D→L**: attached but not resumed. S3 is `leileios`, but M1 still has
  `handoff` (`switch:55`).

There is no real "none" owner: `coalesce(owner,'leileios')` makes an unbound
conversation **L**.

**Turn states:**

- **idle**.
- **prep**: S4 is `prepared`, and the dispatch status is staged, pending or reserved.
- **run**: the dispatch status is `executing` and the S6 binding is `started`.
- **commit**: the Mac has submitted a result (`executor:171`, delivery `unknown`).
- **dunk**: the dispatch status is `delivery_unknown`.
- **rec**: a recovery fence is set (M1 `recovery`, M3, or L1 pending or quarantined).

**Transitions:**

| State | send | edit/retry | switch-out (→D) | switch-in (→L) | wake/cron | background result | daemon crash/restart |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **L/idle** | → L/prep. Fences: S3 owner (`prepare:78`), head CAS (`prepare:94-102`); rotates S2 (`prepare:711-718`). | → L/prep. Fences: owner (`prepare:211,337`), handoff floor (`prepare:573-583`); rotates S2. | → L→D → D. Fences: L4 pin, M2 drain (`switch:21-24`), L2 (`switch:25`), L3 peer (`preflight:32`), S4/S11 busy (`cont-repo:89-94`), head/revision CAS (`cont-repo:101`), completed checkpoint (`cont-repo:107`); rotates S3 `revision` (`cont-repo:113`). | `already_current` (`cont-repo:97-100,118`), then resume (no-op). | Silence Wake → L/prep (`admission:49-70`; `silence-wake:749`). A native Cron fires only inside a live writer (M4). | B commits as a canonical assistant; head and S2 anchor advance (`bg-message.ts:71`). | The in-memory M1–M5 are lost. M1 `recovery` is rebuilt from L1 (`p-runtime:42,125`). **Native Cron in the dead SDK process: re-arm not verified** (#1133; #1129 "not yet proven"). |
| **L/prep** | A second prepare passes (no in-flight check, `prepare:70-119`). It rotates S2, so the first prep fails `admission:35` on its next renewal (**implicit supersede**). | Same as send. | Refused `NATIVE_CONVERSATION_BUSY` (`cont-repo:94`; `lifecycle:339-341`). | n/a | Wake admission refuses while any foreground non-wake prep exists **user-wide** (`admission:57-62`). The Mac defers if the writer is busy (`executor:88-97`; `loop:193-199`; F23). | Execution-start B is allowed only for an unstarted pending owner (`bg-repo:209-218,236-241`). | The reservation expires (S5); the turn fails or is re-dispatched by the relay. |
| **L/run** | As above (supersede). | The Mac retires the writer first (`loop:288-292`), then a persistent fork or one-shot (`loop:293-300`). | BUSY. | n/a | Wake deferred (above). Cron inside the writer → deferred B queued (`bg-repo:420-442`). | Deferred B is queued, then published after F covers it (`bg-sink:231-262`). | The SDK child dies, the lease lapses, admission fails; the result is lost unless already in the L1 or terminal outbox. |
| **L/commit** | Allowed (head CAS on the new head). | Allowed. | BUSY until finalized. | n/a | Blocked as for prep. | Covered B publishes after F (`p-runtime:118-121`). | The terminal outbox replays after the lease (`loop:96-108`); a conflict → quarantine → M3. |
| **L/dunk** | Not blocked by `prepare`. | Not blocked. | BUSY (`lifecycle:340`). | n/a | Blocks Wake **user-wide** (`admission:61`). | Blocks B in this conversation (`bg-repo:236-241`). | Replay from the outbox. |
| **L/rec** | Mac throws "fenced for handoff" (`executor:49`); the server prep succeeds and is later rejected (`loop:189`). **The server does not know about the fence.** | Same. | The drain returns `ready:false` (`p-runtime:145-147,153-159`) → `NATIVE_DAEMON_DRAIN_UNCONFIRMED`; L2 → `NATIVE_SESSION_RECOVERY_REQUIRED`. | n/a | `canRoute` false (`executor:72`). | Replay or quarantine (`bg-sink:189-225`). | Rebuilt from L1 (`p-runtime:125`). |
| **L→D** | Mac refuses (M1). The server still accepts the prep (S3 = L). | Same. | In progress. **If release fails after the drain (BUSY, STALE, network), M1 `handoff` is never lifted. Not handled.** Workaround: run `leileios` (attach), or restart the daemon. | **Not designed.** Attach to the same Session goes through `changeOwner` and then the resume. | Server Wake can be prepared (S3 = L); the Mac cannot route it, so the Wake fails or is deferred. | Drain settle flushes (`p-runtime:152-160`). | M1 is lost, so the daemon accepts the turns again while S3 = L. This is consistent but unintended. |
| **D/idle** | `SESSION_OWNED_BY_DESKTOP` (`prepare:78`). | Same (`prepare:211,337,586`). | `already_current`. | → D→L → L. Fences: L3, L4, L2, CAS, `cont-repo:97-107`; S3 `revision` rotated; then socket resume (`switch:55`; `executor:44-47`). | Silent (`silence-wake:749`); admission owner check (`admission:28`). | Refused (owner checks `bg-repo:144,234,288`). With no live writer, no B should exist; a stale receipt is quarantined. | No M1 after restart. **Protection rests only on the S3 predicate copies (15×).** |
| **D→L** | Server prep OK; Mac refuses (M1 `handoff`) → "Failed" (this was F3 before #1114). If the resume failed: `NATIVE_DAEMON_RESUME_UNCONFIRMED` after the server already committed (#1114). | Same. | Allowed by the server; the Mac drain re-fences (idempotent). | Rerun gives `already_current`, then resume retried (#1114). | Mac refuses. | n/a | Restart clears M1, so the state becomes L. |

### 3.1 Fence → cell map, duplicates and contradictions

| Fence | Cells it guards | Duplicate of / contradicts |
| --- | --- | --- |
| S3 `owner` predicate (15 copies, listed in S3) | D/* for send, wake, background, task control, compact | Duplicated by M1 `handoff`. Copy-pasted SQL; any new path must remember it (task controls added it separately). |
| S3 `revision` rotation (`cont-repo:113`) | Stale retries across switches (ABA) | **Contradicted** by the legacy path flipping `owner` without rotation (`history-repo:369-370,494-495`). |
| M1 `handoff` (`executor:36-49`) | L→D, D→L | Redundant with S3 except during the drain window. Not durable. Leaks on a failed release (L→D row). |
| M1 `recovery`, M3, router `suspended`, L2 | L/rec | Four fences for one fact. L2 is global while the others are per conversation (F15). The error text says "handoff" for `recovery` (`executor:49`; this misled the F12 triage). |
| M2 drain vs L3 peer vs L4 pin | L→D | Three checks of "native file quiescent". They disagree when the daemon's own child flushes after the drain (F1). |
| S2 rotation (`prepare:711-718`) | L/prep supersede; the S2 generation is bound by S8/S9 | Doubles as the writer generation, so a **rejected** turn orphans the writer's background output (F12, F13). |
| Head-at-parent rule | L/prep, L/run | `admission:33-34` accepts head ∈ {u, parent}. `input-binding:78` rejects head = u. `prepare` sets head = parent. Three different statements of one invariant (F4). |
| "Busy" definitions | prep, run, dunk vs switch/wake/B | `cont-repo:89-94` (per conversation, includes dunk, **excludes S9 receipts**); `admission:57-62` (**user-wide**, non-wake); `bg-repo:236-241` (per conversation, with started/unstarted exceptions); `prepare` (none). |
| Routing (M7, `protocol`, `admission`) | edit/retry and wake columns | Five predicates over operation × runtime_mode; they diverged in F7, F17, F22 and F23. |
| Listener lease renewers (M6) | Every cell's dispatch and replay | Four call sites; their ordering mattered in F14, F18 and F26. |

### 3.2 Transitions the current code does not handle

1. **Release fails after the drain** (L→D, switch-out): M1 `handoff` stays set
   while S3 is still `leileios`. The only lift is a later attach or a daemon
   restart (`switch:21-24,41`; resume only at `switch:55`).
2. **Server prep while Mac is fenced** (L/rec, L→D, D→L × send): the server
   accepts, then the Mac rejects. Nothing tells iOS beforehand, because M1 is
   invisible to the server.
3. **Native Cron across a daemon restart or a switch-out**: the drain stops the
   tasks (`native-live-mac-session-drain.ts:21`). No durable re-arm was found,
   and #1129 lists handoff and restart as unproven.
4. **Second foreground while one is in flight**: no explicit refusal. It
   supersedes through S2 rotation (`prepare:711-718`), and the loser learns this
   on its next 20s lease renewal (`native-live-mac-execution-lease.ts:39`).
5. **Server-side queued or prepared background receipts at release**:
   `cont-repo:89-94` does not check S9. The only guards are Mac-local (M2
   settle, L2). If no daemon socket exists, the drain returns `null` and passes
   (`drain-sock:98`; `switch:23`).
6. **Edit/retry while deferred B segments are queued**: the writer is retired
   (`loop:290`). Whether uncovered deferred B are fenced or lost was not
   verified in this audit.
7. **Legacy complete-history switch**: it changes `owner` without rotating
   `revision`, so the ABA guarantee in `continuation.md` does not hold on that
   path.

## 4. Top 3 consolidation candidates

Ranked by how many ledger failures they would have prevented.

1. **One execution-route and capability table (R: 8 failures; F5, F6, F7,
   F8, F17, F19, F22, F23).** Merge `executor.canRoute`, the `loop` routing,
   `mac-admission`, the `protocol` parser and the server `admission`
   operation × mode branches into one shared operation × runtime_mode ×
   writer-state table, imported by Mac and server alike. Delete the
   silent one-shot fallback for exact-checkpoint commands. Every remaining
   one-shot path is a native Cron loss waiting to happen (F7, F8, F19).
2. **Split `native_live_presentation_owner` into a turn token and a durable
   writer-generation row (P: 7; F4, F10, F11, F12, F13, F16, F19).**
   - Keep the per-preparation UI slot.
   - Move "which SDK writer generation owns this Session" into one server row:
     generation, owner L/D/draining, head anchor and cursor.
   - Bind S8/S9/S6 to that row instead of `prepareId`, so a rejected or
     superseded prepare can no longer orphan background output.
   - Repair code such as `bg-repo:56-150` becomes unnecessary.
   - The row's owner and draining field would also replace M1 `handoff` and
     the L→D / D→L gaps (H: F3, plus unhandled items 1, 2 and 5).
3. **One server cursor function (K: 5; F2, F9, F20, F21, F24).** Compute the
   resume cursor once, from the binding, the canonical checkpoint, the resume
   tail and the deferred producer. Have `prepare`, `admission`,
   `input-binding`, `cont-repo` and `bg-repo` call that function instead of
   re-deriving it. Put the native end-of-turn grammar (L5) behind one versioned
   module with fixtures per CLI version.

Runner-up: fold the four Mac recovery fences (M1 `recovery`, M3, router
`suspended`, L2) into one per-conversation recovery state, and the four lease
renewers into the dispatcher (H/L: F14, F15, F18, F26).
