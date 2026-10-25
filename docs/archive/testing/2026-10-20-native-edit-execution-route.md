# Native edit execution route recovery

## Failure and scope

The real edit preparation `168f58f0-15f7-4153-8a12-f2616cff0f74`
failed before any SDK event with `Execution lease was not renewed.`
The persistent route accepted edit/retry forks, but the execution admission
parser, admission construction and server contract support send/wake only.
No execution-lease request reached the server for the rejected fork.

Edit/retry now await retirement of the persistent writer, then use the existing
one-shot branch executor and its result outbox. Persistent executor/router
guards accept only supported send/wake operations. No admission, authorization,
history, authentication or server contract is broadened.

## Verification

All server/Mac commands used Node 22.23.3. The complete ordinary suite used
Node 24.19.0 with the Web dependencies installed in the disposable worktree.

- Focused route regressions: RED 0 passed / 5 failed on the original source;
  GREEN 5 passed / 0 failed after the fix.
- `pnpm exec tsx --test tests/native-live-mac-daemon-loop.test.ts tests/native-live-mac-persistent-executor.test.ts tests/native-live-mac-persistent-turn-router.test.ts tests/native-live-mac-persistent-runtime.test.ts tests/native-live-mac-http-relay-client.test.ts tests/native-live-mac-execution-admission.test.ts`: 186 passed, 0 failed, 0 skipped.
- `pnpm typecheck`: PASS.
- `pnpm build`: PASS.
- `pnpm test`: 2911 passed, 0 failed, 300 skipped (3211 total).
- `pnpm --dir tools/claude-bridge test`: 623 passed, 0 failed, 8 skipped.
- `pnpm test:production-runtime-gate`: root 706 passed; selected bridge 401 passed; no failures or skips.
- `git diff --check`: PASS.
- Independent code review: no blocker found; reviewer did not independently rerun tests.

Tests verify edit/retry with both new/fork runtime modes, exact command
preservation, single result submission and persistent writer retirement before
branch execution. Deferred retirement tests prove execution does not start
while closing is pending and does not proceed if closing fails.

## Limits and acceptance

Edit/retry itself uses one-shot execution; native background jobs created in
that turn are not guaranteed to remain alive. A subsequent ordinary send can
resume the committed child session through the existing persistent path.
This fixes edit dispatch, not a complete persistent-fork lifecycle.

No real Claude request was replayed, no production database was accessed, and
no transcript content or credentials were printed. Device edit acceptance is
separate from these local regressions. GitHub checks that cannot start because
of account billing are not considered passed.
