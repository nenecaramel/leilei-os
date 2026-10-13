# Local test execution

Root/daemon tooling uses Node 22. The complete mixed server/Web suite and Web
build use Node 24, matching Web's declared engine and CI. Install the locked
root and Web dependencies before running component tests.

- `pnpm test`: discover every regular `tests/**/*.test.ts` file, sorted, with
  Node's default process isolation and at most two file processes.
- `pnpm test:serial`: run the exact same files with one file process.
- `pnpm test:profile`: run the complete suite and additionally write
  `test-results/timings.jsonl` (ignored by Git).
- `pnpm test -- --profile=/absolute/path/timings.jsonl`: choose a timing output
  path. Ordinary Node test options, such as `--test-name-pattern`, are forwarded;
  concurrency/isolation overrides are rejected so opt-in serialization cannot
  be accidentally defeated.

Timing rows contain only relative file paths, top-level test durations in
milliseconds, skipped status and failed status. They do not store test names,
stdout, diagnostics or request data. Top-level durations can rank costly files;
they are not exact process wall times and do not sum to total suite wall time.
Normal test output still goes to the terminal and failures remain nonzero.

Any nonempty `RUN_*`, `UI_*`, simulator selection, `DATABASE_URL`,
`SAFARI_WEBDRIVER_URL` or `LIFECYCLE_BOUNDARY_FIXTURES` setting forces serial
execution. This is conservative even for values such as `0` or `false`. It does
not grant permission to use those resources or prove the database is isolated.
An ordinary local run should unset opt-ins and production connection variables.
The production runtime gate and existing dedicated integration gates retain
their existing scheduling.

Each file has its own process; tests within one file still follow their existing
ordering. No tests are discarded for speed. Shared persistent fixtures need an
explicit serial opt-in or temporary per-test isolation. New external-resource
settings must be added to the runner's serial policy and behavior tests.

## Behavior instead of source matching

Login regressions compile and mount the actual Web components. Only network SDK
and build configuration boundaries are mocked. Platform detection, action
handlers, fallback and theme effects execute unchanged. Negative controls cover
ordinary browser versus standalone behavior. Architectural registration, CSS
and source declaration constraints remain useful and are retained.

Relay tests use an explicit deferred finalize barrier and assert observable
state/finalize/wake sequencing. Existing Hook tests use held HTTP responses for
prompt/reset races. These tests prove their boundaries; they do not establish
SQL isolation, real device scheduling or live model behavior.

## Measured verification — 2026-10-14

On this Mac, Node 24.19.0 and pnpm 11.9.0 ran the same final 539 files:

| Command | Wall time | Pass / fail / skip |
| --- | --- | --- |
| `pnpm test:serial` | 337.0 s | 2514 / 0 / 200 |
| `pnpm test:profile` | 170.3 s | 2514 / 0 / 200 |
| `pnpm test` (parallel repeat) | 178.8 s | 2514 / 0 / 200 |

The two parallel runs were 47–49% shorter; these are local measurements, not a
portable timing guarantee. Database, simulator and Safari opt-ins were disabled;
200 skips are not passes. Node 22.23.3 targeted regressions (90/90), typecheck,
build and the 447-server + 204-bridge runtime gate also passed. Web typecheck,
build and the selected agent gates passed under Node 24. Application code and
CI scheduling/configuration were unchanged. GitHub CI remains a separate result.
