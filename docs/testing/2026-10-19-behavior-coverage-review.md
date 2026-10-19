# Behavior coverage review — 2026-10-19

Baseline: `ae750bb732025f10aa61a165005cf8e2dd98c06b` (#1169).

## Scope and method

Inventory: 576 root JS/TS test files and 50 Claude bridge test files at baseline; the Go wake-broker package was checked separately. Source-read/import/process signals narrowed review candidates; these signals are not a coverage percentage or a verdict. A file may contain both declaration and behavior checks, or execute production code through a helper. Reviewed high-risk candidates against their behavioral counterparts instead of assuming all source assertions are inadequate. No tests were removed or weakened.

This is a test-coverage review, not a proof that every product path is bug-free. UI rendering, host SDK behavior and PostgreSQL locking have different evidence boundaries.

## Six areas

| Area | Existing useful evidence to retain | Finding / action |
| --- | --- | --- |
| Claude / Mac runtime | `native-live-mac-persistent-runtime`, `native-live-mac-persistent-turn-router`, `native-live-durable-recovery.integration`, `native-live-background-result.integration`; real production orchestration with deferred network/lease/commit responses | Do not rebuild this coverage. Restart/outbox replay, handoff/branch fencing and canonical background attachments already execute real logic. Real SDK/host opt-ins remain separate acceptance; simulated SDK success does not establish current upstream SDK compatibility. |
| API / PostgreSQL | `active-user-mutation-atomicity.integration`, `mind-memory-api.integration`, `global-search-repository.integration`, `mcp-write-idempotency.integration` | Visibility, content-version conflicts, Stop concurrency, user-row locks and idempotency already have DB tests. Explicitly run them in a verified isolated DB; default skips are not passes. Found a reproducible Unicode locale dependence (below), not an extraction regression. |
| Web | Real mounted Diary, Mind, auth and Universe paper tests; pure search cursor/group/snapshot tests | Missing mounted Global Search request-lifecycle evidence. Added stale filter success/failure, page failure/retry, mixed-module overlap, stale page rejection and Memory detail-return snapshot/focus/scroll tests. Remaining: Universe root-level load/mutation/navigation orchestration is mostly source wiring plus lower-level paper/service tests; those pieces do not prove the complete page flow. |
| iOS | Existing production Swift compilation for Mind/Diary refresh and mutations, runtime controllers, message projection; opt-in hosted ChatView smoke | Added execution of actual Global Search task methods with held service continuations. Remaining: Universe dirty-draft/save/discard presentation and Settings backup preview/restore state are largely source assertions; they need focused production-method/hosted UI tests. Actual Menu/sheet presentation and navigation retention still require device/simulator acceptance. |
| MCP / external tools | Production factory exercised via in-memory MCP client; typed tool schema/error/idempotency tests; image/file result routing uses real collector/router logic | Keep declaration checks alongside these real protocol tests. Do not repeat the Notion profile test just because another file checks its source. External account writes/browser integration and upstream service behavior are not proven by mocks; keep explicit opt-ins and synthetic data, never call real tools merely to remove a skip. |
| Build / deploy / local scripts | Real disposable Git/process fixtures for daemon fresh, lock/stop protection and test runner; Docker COPY/dependency contracts | Source checks are appropriate for packaging declarations but not a full image build. A fresh image gate is separate evidence; this audit did not build a local Docker image, deploy, or restart the owner daemon. No new runtime control system is warranted. |

## Changes in this PR

- `tests/global-search-page-behavior.test.ts`: mounts the unchanged production page, keeps effects/handlers real, fakes only API results and browser host primitives. Five tests; success/failure and navigation use explicit response barriers rather than arbitrary paint sleeps.
- `tests/ios-global-search-lifecycle.test.ts` + `tests/fixtures/global-search/lifecycle.swift`: compile parser-selected `scheduleSearch`, `loadMore` and `uniqueResults` declarations unchanged, with actual DTOs and a controlled service. Exercises stale success/failure, pagination retry/single-flight/cross-module identity, cancellation, empty/oversized input and failure states. Does not claim to exercise SwiftUI wrappers, currentRequest construction, native navigation or rendering.
- Negative controls: temporarily removing the Web sequence fence and Swift cancellation guards each made the corresponding new test fail. Restored production source immediately; no product source changes are included.

## Database locale observation

A newly initialized PostgreSQL 18 database using libc `C` locale returned `cafÉ preference` for `lower('CAFÉ preference')`. The existing Memory test expecting Unicode case-insensitive search failed (one leaf failure plus its parent: 75 pass / 2 fail). The same unchanged code, schema and eight test files on a separate verified `en_US.UTF-8` test database returned `café preference` and passed 77/77, zero skips.

Thus search case folding currently depends on the database locale. This audit does not claim production's locale, change historical data, alter matching semantics, or silently relax the assertion. For reproducible local tests, verify Unicode case folding as well as the DB host/name. Supporting libc C with equivalent Unicode folding would be a separate product change.

## Execution evidence

- Baseline full ordinary suite (Node 24.19.0 / pnpm 11.9.0): 2860 pass, 0 fail, 297 skip (3157 total). Opt-ins and DATABASE_URL were removed from the ordinary suite environment.
- Claude bridge (Node 22.23.3): 607 pass, 0 fail, 8 skip (615 total). Real host/SDK opt-ins were disabled.
- Eight real DB suites: active-user atomicity, native background result, branch/session, durable recovery, backend turn repository, Memory API, global search, MCP idempotency. Dedicated PostgreSQL 18 instance at loopback port 55479; targets `leileios_coverage_audit_test` / `leileios_coverage_utf8_test`, verified by the repository read-only target verifier before migration. C-locale and UTF-8 results above. No inherited production connection.
- Final ordinary suite after adding six Node test cases: **2866 pass, 0 fail, 297 skip**, 3163 total. Same opt-in policy as baseline; delta +6 passes, no new failure/skip.
- New Web tests: 5/5. New Swift harness: 1/1, all four printed scenario groups reached. Independent read-only review found no blockers.
- Node 22 typecheck/build: PASS. Production runtime gate: 701 + 385 pass, zero failures/skips.
- Node 24 Web typecheck/build: PASS. iOS targeted gate including new lifecycle test: 14/14. Script/runner/Docker-contract regressions: 40/40. After the two domain-map path additions, agent-workflow repeated: 19/19. Go wake broker: `go test ./...` PASS.
- No production source, dependency, schema or application settings changed. The domain map only assigns the new test and fixture to their existing Web/iOS surfaces.

### Actual commands

Node 24: `pnpm test` (baseline and final), `npm ci` / `npm run typecheck` / `npm run build` in `web/`.

Node 22: `pnpm typecheck`; `pnpm build`; `pnpm test:production-runtime-gate`; `pnpm --dir tools/claude-bridge test`; `pnpm exec tsx --test tests/ios-native-live-current-path-idle.test.ts tests/ios-settings-export-restore-v4.test.ts tests/ios-chat-selection-persistence.test.ts tests/ios-global-search-lifecycle.test.ts`; `pnpm exec tsx --test tests/agent-workflow.test.ts tests/native-live-mac-daemon-fresh.test.ts tests/docker-browser-build-scripts.test.ts tests/test-runner.test.ts`.

New Web test directly: Node 24, `TSX_TSCONFIG_PATH=web/tsconfig.app.json node --import tsx --import ./tests/register-css-loader.mjs --test tests/global-search-page-behavior.test.ts`.

DB: after verifier + test-only `pnpm db:migrate`, set `RUN_ACTIVE_USER_DATABASE_INTEGRATION_TEST=1 RUN_NATIVE_LIVE_RELAY_DATABASE_TEST=1 RUN_NATIVE_LIVE_TURN_DATABASE_TEST=1 RUN_RUNTIME_MIND_PRODUCT_DATABASE_TEST=1 RUN_GLOBAL_SEARCH_DATABASE_TEST=1 RUN_MCP_WRITE_IDEMPOTENCY_DATABASE_TEST=1` and run `pnpm exec tsx --test --test-concurrency=1` with the eight suite files listed above. Connection URL was explicitly set to each disposable loopback test DB. Never substitute an ambient production URL.

Go: `go test ./...` in `cmd/native-live-wake-broker`.

## Follow-up priority

1. Preserve and actually run the existing runtime/DB tests; avoid another parallel lifecycle framework.
2. Universe Web root behavior, then iOS Universe mutation/discard and Settings backup task lifecycles.
3. Host/UI/live-provider acceptance stays explicitly separate from local unit results. No blanket replacement of layout/schema/declaration tests and no guessed test-coverage percentage.
