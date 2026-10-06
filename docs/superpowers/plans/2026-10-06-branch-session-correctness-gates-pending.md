# PR #908 additional correctness gates — pending live verification

PR head remains `f8339c69772eab13b3c9ee1af496f7c6b6d1bd57`. Do not merge or deploy.
SDK remains exactly `@anthropic-ai/claude-agent-sdk@0.3.286`.

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
- Actual production fork path: new A, resume A, real compact A, append a later
  marker, then use query resume/resumeSessionAt/forkSession for both pre-compact
  and post-compact checkpoints. Assert new branch identity, excluded later
  markers, unchanged source transcript and subsequent same-ID branch resume.

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
