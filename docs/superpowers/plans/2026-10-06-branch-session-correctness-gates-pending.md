# PR #908 additional correctness gates — verification ledger

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
