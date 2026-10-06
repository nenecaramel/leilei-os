# PR #908 additional correctness gates — verification ledger

## Latest rebase verification — 2026-10-06 (local only)

Rebased the eleven #908 commits onto latest `origin/main@4b908b3bca68d56dce31cddd38eb8b3d38d6d8ad`
(which contains the requested `5f461fd6` plus #911). History was not squashed.
**Claude live query calls in this follow-up: 0**. Both opt-in SDK switches were
forced to 0. The earlier authorized production-query compact historical fork PASS
remains recorded against its actual tested head; it was not rerun after rebase.
No SDK upgrade, merge, deployment, daemon restart or production mutation.

### Conflict resolution and semantics

- `native-live-silence-wake.ts`: retain main's stale staged predicate/source-path
  query and ignore reasons; additionally select the canonical checkpoint UUID
  and persist it on an isolated `fork` wake preparation. DB assertion pins fork
  mode and the exact foreground checkpoint. Quiet/stale wake discard still works.
- `native-live-backend-relay.ts`: retain main's output attachment capability,
  discarded-wake receipts/recovery and working-directory selection. Reserve also
  preserves modern checkpoint fields and resume/fork modes.
- `native-live-mac-http-relay-client.ts`: keep main's 503 retry/recovery/ignore-reason
  behavior; carry checkpoint in compact reservation/result without replacing
  working-directory identity. Missing optional legacy fields stay absent.
- Main removed `native-live-mac-workspace-runtime.ts`; keep it deleted and forward
  the compact checkpoint through `native-live-mac-working-directory-runtime.ts`.
  Its regression was RED against main (lost compact args) then GREEN here.
- Turn schema, protocol, daemon/executor, prepare/finalize/read records and compact
  conflicts retain main's `expected/effective_working_directory`, v4-only protocol
  and output capability. Add exact transcript UUIDs and resume identity validation.
  Existing pre-checkpoint v4 shapes remain readable; checkpoint-aware preparations
  still reject success missing its checkpoint, before any canonical write. Retry/
  Edit use exact historical parent; ordinary send resumes; legacy/bootstrap forks
  once. No workspace columns/types or v1-v3 protocol acceptance were resurrected.
- Migration journal keeps main's `0099_retire_product_workspace`; #908's branch
  migration is now `0100_native_live_branch_session`, with matching idx 100. No
  production migration ran. Fresh exported schema vs full ledger parity passes.
- Shared-session cleanup retains main's user/provider namespace and protects all
  surviving checkpoint/bootstrap/preparation/compact references. Fixtures now use
  same-session resume results, exact UUIDs and expect A to remain protected after
  Retry/Edit while exclusive replacement sessions can be cleaned.

### Fresh local gates

Server/Mac: Node **22.23.3**; Web: Node **24.21.0**; SDK unchanged **0.3.286**.

| Gate | Result |
| --- | --- |
| Claude bridge complete local suite | 156 PASS / 0 FAIL / 4 live skips |
| Production runtime gate | 519 PASS / 0 FAIL (402 root + 117 bridge) |
| Isolated Postgres full regression | 67 PASS / 0 FAIL / 0 skips |
| Silence wake / relay / protocol / turn / replacement / directory compact targeted | 101 PASS / 0 FAIL |
| Root typecheck / build | PASS |
| Web typecheck / build | PASS |
| Migration 0000–0100 / Drizzle check / schema-ledger parity | PASS |
| git diff --check | PASS |

The DB runner retained its complete standard file list and safety checks. A
throwaway launcher mapped pnpm commands to identical Node/Drizzle/tsx commands to
avoid reinstalling canonical symlinked dependencies. DB was exclusively this
task's localhost `127.0.0.1:55448/leilei_908_rebase_test_regression`.
First sandboxed HTTP/full-suite runs could not bind local servers; those were
excluded from final evidence. Final paired suites used the same localhost-enabled
permissions, Node22, root/bridge dependencies, installed Web dependencies, JSX/CSS
settings and disabled DB/live flags. No unrelated historical failures were fixed.

Full canonical main: **2241 tests; 2092 PASS / 22 FAIL / 127 skips**.
Full canonical PR: **2253 tests; 2098 PASS / 22 FAIL / 133 skips**.
**New failure titles: 0; resolved failure titles: 0.** Six extra local passes and
six opt-in branch DB cases account for the delta. This is not a full-suite GREEN claim.

Commands (direct equivalents where the local pnpm launcher requires reinstall):
```sh
RUN_SDK_BRANCH_CHECKPOINT_LIVE=0 RUN_SDK_BRANCH_CORRECTNESS_LIVE=0 node --test tools/claude-bridge/test/*.test.mjs
# package.json test:production-runtime-gate: tsx mapped to node --import tsx, same full file list
# isolated DB runner: migrations/check/full file list, only task-owned localhost DB
node --import tsx --test --test-concurrency=1 tests/native-live-silence-wake.test.ts tests/native-live-mac-silence-wake-scheduler.test.ts tests/native-live-backend-relay.test.ts tests/native-live-mac-http-relay-client.test.ts tests/native-live-runtime-protocol.test.ts tests/native-live-mac-working-directory-runtime.test.ts tests/native-live-backend-turn-coordinator.test.ts tests/native-live-replacement-purge.test.ts tests/native-live-runtime-protocol-boundaries.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.json
node scripts/build-mcp-browser.mjs
# in web/, Node24: tsc -b; vite build
TSX_TSCONFIG_PATH=./web/tsconfig.app.json node --import tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 tests/**/*.test.ts
# identical full-suite command in latest-main baseline worktree
git diff --check
```

Shared failure titles on latest main and PR:
- `AudioSession fix leaves VoiceInputController and every other production file unchanged from PR head`
- `CI checks after a failed gate still run once their setup succeeds`
- `CI reports all verification surfaces independently for PR and push`
- `CI scopes database access to Postgres gates and preserves every verification command`
- `G keeps a single registry and consumes C verified SVG without another downloader`
- `G production loader accepts only local assets and the minimal data bridge`
- `User row and history/divider moves retain complete presentation and interaction blocks`
- `actual Swift media descriptors, layers, layout, integrity/cache/retry and preview lifecycle`
- `authenticated Native Live internal JSON can exceed the public 1mb limit`
- `canonical murmur is projected separately and raw streaming tags are fail-closed`
- `composer keeps mic placeholder and arbitrates trailing tap versus hold in one native control`
- `iOS Runtime UI prefers SDK tool display names and surfaces API retry state`
- `murmur is a separate activity-row bubble that opens a sheet`
- `partial murmur tag suffixes are fail-closed`
- `real WebKit G loads offline production engines and denies navigation/network`
- `source panels match assistant copy interaction without growing the button`
- `tests/ios-native-live-message-surface-boundaries.test.ts`
- `the app JSON parser accepts a 100k CJK Diary body`
- `the app JSON parser remains bounded above 1mb`
- `turn read targets only exact detached prepared user without a conversation scan`
- `unauthenticated Native Live internal JSON does not get the larger parser budget`
- `voice controller waits for final text, fails on timeout, and ignores cancelled session callbacks`

Initial PR head was `f8339c69772eab13b3c9ee1af496f7c6b6d1bd57`. The user later
authorized pushing candidate `dabda76d`, which is now on #908. Do not merge or deploy.
SDK remains exactly `@anthropic-ai/claude-agent-sdk@0.3.286`.

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

## Previous local-only follow-up

The earlier local-only follow-up made zero live calls and left this gate
UNVERIFIED. Its local evidence remains recorded below; the authorized single-path
PASS above supersedes only the historical-fork pending status. Older failures and
quota-blocked attempts are retained as history, not current results.

## Added opt-in real SDK cases

`tools/claude-bridge/test/sdk-live-branch-correctness.test.mjs` calls the actual
production `AgentSdkClaudeTransport.executeTurn()` with the installed SDK query.
Only the isolated fixture's settings/tools/model and in-memory workspace-scoped
SessionStore are substituted. SDK responses and transcript writes are not mocked.

- Same fixed canonical user UUID: interrupt only after the actual SDK mirrors U,
  withhold canonical completion, then resume the identical session at the same
  parent checkpoint and resend U. Assertions require a single successful turn,
  matching U, an acyclic persisted checkpoint chain containing U once, unchanged
  provider identity, and durable SessionStore completion.
- Current bounded production fork path: new A, resume A, real compact A, then
  query resume/resumeSessionAt/forkSession at pre-compact cp1, followed by resume B.
  Exactly five calls; no extra post-compact turn or second fork. The earlier
  expanded case below is a historical record only.
- Delivery unknown: complete a real provider U without canonical finalize, then
  resend U from the same parent. Assert the correct U/answer occurs once on the
  returned checkpoint chain and U descends directly from the canonical parent.
  Reusing an already completed, correctly correlated result is valid idempotency;
  requiring a different assistant/checkpoint UUID would overconstrain the contract.

Each fixture owns only newly created SDK sessions in a unique temporary directory
and deletes them at closeout. No existing user session or production data is read
or modified. These short prompts do not exercise automatic large-context compact.

## Attempt on 2026-10-06

```sh
RUN_SDK_BRANCH_CORRECTNESS_LIVE=1 node --test --test-concurrency=1 tools/claude-bridge/test/sdk-live-branch-correctness.test.mjs
```

Both cases stopped at their initial new-session prompt, before the correctness
steps: provider HTTP **429**, `You've hit your session limit`, reset reported as
**18:50 Asia/Shanghai**. They are **BLOCKED / NOT VERIFIED**, not a replay/fork
failure witness. No SDK upgrade is justified by this result. Do not reinterpret
the earlier exported-fork compact test as passing these new gates.

Local syntax and checkpoint regression checks: 10 pass / 0 fail / 2 opt-in skips.
Full local Claude bridge regression: 153 pass / 0 fail / 3 opt-in live skips.
The skips do not prove either live gate. Rerun the exact command after quota reset,
record the installed version and live evidence, and only then update the PR head.
If 0.3.286 exhibits a correctness failure, preserve that RED witness before testing
a narrowly scoped SDK upgrade or recovery mitigation.

## Continuation: quota temporarily allowed real calls

- **0.3.286 interrupted same-U exact resume: PASS**, one live case, approximately
  29 seconds. U was actually mirrored before abort, both attempts addressed the
  same canonical parent, resumed identity stayed A, the result had one turn/U,
  and the persisted checkpoint chain was acyclic with U once and store complete.
- **0.3.286 production query historical fork: RED.** New/resume/real compact/
  post-compact resume succeeded. The first pre-compact query fork then failed
  with `No message found with message.uuid of: <historical checkpoint>` despite
  transport having verified the UUID in the raw store. This is not an exported
  fork helper test; it used production executeTurn + resume/resumeSessionAt/fork.
- The initial delivery-unknown test required a fresh checkpoint UUID and failed
  because the SDK reused the completed result. That assertion was subsequently
  corrected: safe idempotent reuse is acceptable if exact lineage and one U/answer
  hold. Do not label that overly strict assertion as a proven replay bug. The
  corrected, stronger lineage assertions still need a live run.

An isolated 0.3.290 install was compared without changing the repository manifest
or canonical dependencies. Interrupted-U passed; the same overly strict fresh-ID
assertion failed; the fork case stopped at compact with no compact boundary, so
it did not reach the fork assertion. **No evidence supports declaring an SDK
upgrade sufficient.** The [official 0.3.290 release](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.290)
addresses replay while an initial user copy is still queued, a narrower scenario.
The application remains pinned to **0.3.286**.

## Candidate mitigation — not live verified

The transport now supplies a query-local SessionStore read view only for exact
forks. Loading source A returns the original ordered raw prefix through the
canonical checkpoint, so a later compact cannot hide that earlier UUID from the
CLI loader. The production query still uses resume A, exact resumeSessionAt, and
forkSession true. No exported fork, rewritten UUID, durable truncation, source
append, or canonical mutation is introduced. Append/subpath/other-session methods
delegate to the original store. Ordinary resume keeps its original store and SDK
idempotency behavior. Missing checkpoints fail closed.

The read-view regression was observed RED before implementation, then GREEN.
Checkpoint tests: **12 pass / 0 fail**. Full Claude bridge: **155 pass / 0 fail /
4 opt-in live skips**. Runtime gate: **536 pass / 0 fail**, Node 26.5.0, using the
package script with `node --import tsx` in place of the unavailable pinned pnpm
launcher. Typecheck, syntax and diff checks passed.

The final mitigated live attempt stopped all three cases at their initial prompt:
HTTP **429**, new reset time **20:10 Asia/Shanghai**. Thus **the mitigation and
the final versions of both requested gates remain NOT VERIFIED**. PR remote head
is unchanged. Do not merge, deploy, or publish this candidate as a passing fix.

## Matched canonical-suite delta

Compared candidate against exact pre-follow-up PR head f8339c69 with identical Node
26.5.0, root dependencies, JSX/CSS flags and opt-in settings. Both runs: **2103
tests; 1920 pass / 53 fail / 130 skip**. **0 new failure titles**, 0 base-only.
This is a follow-up delta, not a new comparison against origin/main. The Web
dependencies are absent in both disposable worktrees (React import file-not-found);
those environment failures are included below and are not product regressions.
These totals cannot be compared directly with the older fully installed Web run.
No unrelated tests were repaired.

Commands:
```sh
node --test tools/claude-bridge/test/*.test.mjs
node --import tsx --test --test-concurrency=1 <files from package.json test:production-runtime-gate>
node --test <bridge files from package.json test:production-runtime-gate>
node node_modules/typescript/bin/tsc --noEmit
TSX_TSCONFIG_PATH=./web/tsconfig.app.json node --import tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 tests/**/*.test.ts
git diff --check
```

Failures present in both exact-head and candidate runs:

- `the app JSON parser accepts a 100k CJK Diary body`
- `the app JSON parser remains bounded above 1mb`
- `authenticated Native Live internal JSON can exceed the public 1mb limit`
- `unauthenticated Native Live internal JSON does not get the larger parser budget`
- `tests/app-shell-mobile.test.ts`
- `CI reports all verification surfaces independently for PR and push`
- `CI scopes database access to Postgres gates and preserves every verification command`
- `CI checks after a failed gate still run once their setup succeeds`
- `iOS Runtime UI prefers SDK tool display names and surfaces API retry state`
- `tests/dashboard-page.test.ts`
- `tests/day-space-real-data.test.ts`
- `tests/diary-mobile-page.test.ts`
- `tests/diary-page-header.test.ts`
- `tests/diary-page.test.ts`
- `tests/diary-paper-editor.test.ts`
- `AudioSession fix leaves VoiceInputController and every other production file unchanged from PR head`
- `User row and history/divider moves retain complete presentation and interaction blocks`
- `actual Swift media descriptors, layers, layout, integrity/cache/retry and preview lifecycle`
- `tests/ios-native-live-message-surface-boundaries.test.ts`
- `murmur is a separate activity-row bubble that opens a sheet`
- `canonical murmur is projected separately and raw streaming tags are fail-closed`
- `source panels match assistant copy interaction without growing the button`
- `G production loader accepts only local assets and the minimal data bridge`
- `G keeps a single registry and consumes C verified SVG without another downloader`
- `real WebKit G loads offline production engines and denies navigation/network`
- `tests/mobile-home-shell.test.ts`
- `tests/mobile-ui-polish-2026-08-10.test.ts`
- `tests/native-date-layout.test.ts`
- `partial murmur tag suffixes are fail-closed`
- `turn read targets only exact detached prepared user without a conversation scan`
- `voice controller waits for final text, fails on timeout, and ignores cancelled session callbacks`
- `composer keeps mic placeholder and arbitrates trailing tap versus hold in one native control`
- `tests/paper-author-signature.test.ts`
- `tests/paper-detail-author-layout.test.ts`
- `tests/paper-editor-autosize.test.ts`
- `tests/pwa-status.test.ts`
- `tests/quick-search.test.ts`
- `tests/route-scroll.test.ts`
- `tests/system-about-ui.test.ts`
- `tests/system-account-connections-ui.test.ts`
- `tests/system-data-activity-ui.test.ts`
- `tests/system-data-export-ui.test.ts`
- `tests/system-data-import-ui.test.ts`
- `tests/system-navigation.test.ts`
- `tests/todo-home-date-rollover.test.ts`
- `tests/todo-paper-dialog-server.test.ts`
- `tests/todo-paper-dialog.test.ts`
- `tests/universe-import-ui.test.ts`
- `tests/universe-mobile-interaction.integration.test.ts`
- `tests/universe-paper-interaction.integration.test.ts`
- `tests/universe-paper-ui.test.ts`
- `Web component tests use the same automatic JSX runtime as the Web build`
- `tests/web-unsaved-changes.test.ts`

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
