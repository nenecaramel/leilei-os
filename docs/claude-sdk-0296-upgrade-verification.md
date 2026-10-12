# Claude Agent SDK 0.3.296 upgrade preparation

Base: `6d39a039a27091ee56d9823a9f344dbf32daffb7`.

## Scope

Pin the standalone Claude bridge SDK and its platform packages from 0.3.286 to 0.3.296. Other locked dependencies remain unchanged. Update the existing output provenance version and exact expectations. Update the opt-in live test report version; this is not evidence that its live gates ran on 0.3.296. No transport, session, permission, attachment, UI, backend or migration behavior is intentionally changed. Keep the local send_file implementation.

## Evidence (Node 22.23.3, pnpm 11.9.0)

- Old SDK full offline Bridge baseline: 385 pass, 0 fail, 4 skip.
- Upgraded full offline Bridge: 385 pass, 0 fail, 4 skip.
- Production runtime gate: root 413 pass + Bridge 204 pass = 617 pass, 0 fail, 0 skip.
- Session history/picker/sync digest and runtime observability: 19 pass, 0 fail, 0 skip.
- Root typecheck and build: exit 0.
- Bridge frozen offline install: exit 0.
- Diff check: pass.
- Existing installed-SDK inventory regression initially failed because output provenance still advertised 0.3.286; it passes after updating the version. Existing exact UUID fork tests use the actual SDK forkSession with a synthetic SessionStore and passed offline; query resume/fork/compact paths are mocked.
- One intermediate switch-CLI test encountered NATIVE_SESSION_RECOVERY_REQUIRED from the real user's transient pending recovery state. No recovery data was changed. The final full suite and the same test on unchanged main both passed. An initial sandbox run also rejected four loopback mock listeners; the permitted loopback run passed.

## Not verified / activation gate

Both RUN_SDK_BRANCH_CORRECTNESS_LIVE and RUN_SDK_BRANCH_CHECKPOINT_LIVE were explicitly 0. All four live tests stayed skipped. Claude model queries: 0. Prior 0.3.286 live evidence is not carried forward as 0.3.296 acceptance.

The canonical daemon, installed SDK, Claude CLI, user sessions, Mind settings and Chrome pairing were not changed. No merge, deployment, production DB operation or daemon restart was performed. The upgrade stays a candidate until separately authorized controlled acceptance of send/resume, exact Retry/Edit fork, compact historical fork, interruption/redelivery and attachment delivery. The official CLI installed globally is separate from the SDK's bundled runtime and is not upgraded here.

## References

- [Official SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md): 0.3.287/290 fix partial-message termination and same-UUID replay; newer releases change permission handling, MCP metadata bounds and task events. Passing mocks does not establish live behavior or lower response latency.
