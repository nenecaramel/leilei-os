# Local test baseline — 2026-10-13

This is a dated investigation record, not an allowed-failure list. `pnpm test` keeps its nonzero exit status, all existing tests remain enabled, and a green scoped gate does not mean the full suite is green.

## Reproduction

Baseline: `d3f95eac0a6b8ae43dab7daa4ce908bd732cb267` (latest main at task start). Node 22.23.3, pnpm 11.9.0; locked root/bridge dependencies and Web dependencies installed under Node 24.19.0. Both comparisons use disposable worktrees. No private `.env`, live model opt-ins or production database.

```sh
env -u DATABASE_URL -u ANTHROPIC_API_KEY -u OPENAI_API_KEY \
  NODE_ENV=test RAILWAY_ENVIRONMENT_NAME=local-test pnpm test
```

Main: **2650 total / 2421 pass / 31 fail / 198 skip**. Skip counts are not passes. Database and authenticated/model/runtime acceptance require their own explicitly enabled isolated tests.

Final branch: **2656 total / 2434 pass / 24 fail / 198 skip**. An earlier branch run was **2654 total / 2430 pass / 26 fail / 198 skip**; two additional workflow tests were then added. Both branch failure sets are subsets of main. The two Home cases failed on main and the earlier branch run but passed on the final run without any Home code/test edits; they remain unresolved intermittent failures, not fixes.

## Diagnosed and corrected

- **3 Swift import fixture failures:** invalid/readback/validation cases still expected the retired Chinese error wording. The actual parser uniformly reports `Unable to import this file.`. Update only that exact wording assertion; retain every invalid-input and readback check.
- **1 workspace policy failure:** the fixture expected two long-lived checkouts after policy changed to exactly one. Preserve signing/data protections and change the policy assertion to the current rule. Runtime helper scripts also remove the retired UI-checkout fallback.
- **1 message surface failure:** the fixture mixed expressly user-visible thinking into a hidden-reasoning diagnostic assertion. Unknown event/content diagnostics already redact correctly. Keep those negative assertions, add deltas/signatures, and separately prove that visible summaries never enter compatibility diagnostics or canonical conversation text while hidden/nested content stays excluded. No normalization/display behavior change.

Additional executable-script checks exposed invalid static contracts: the JS checkpoint cleanup boundary had no TypeScript declaration and the ignored asynchronous idle-opportunity result was typed as void. Correct those contracts without casts or compiler relaxations. The newly checked compact adapter also allowed null provider-session results to be reported as success; it now rejects them with `COMPACT_FAILED`, verified RED → GREEN with synthetic runtimes.

## Remaining failures requiring separate review

The following **26 unresolved cases remain enabled** (24 persistent source/reference failures plus 2 intermittent Home cases). The 24 source/reference contract assertions must be checked against accepted product changes before updating fixtures; a source mismatch alone is not proof of a product bug or permission to reset the reference. The two Home DOM interaction cases use fixed paint sleeps and need deterministic synchronization plus functional investigation; their final single-run pass does not establish stability. This closeout does not redesign UI or silently declare these failures obsolete.

| File | Failing cases | Follow-up |
| --- | ---: | --- |
| `tests/diary-comment-spacing.test.ts` | 2 | Source/reference contract review |
| `tests/global-state-system.test.ts` | 1 | Source/reference contract review |
| `tests/ios-alert-consistency.test.ts` | 1 | Source/reference contract review |
| `tests/ios-chat-orchestration.test.ts` | 1 | Source/reference contract review |
| `tests/ios-composer-callback-equivalence.test.ts` | 2 | Source/reference contract review |
| `tests/ios-elevenlabs-result-surface.test.ts` | 1 | Source/reference contract review |
| `tests/ios-message-rows-equivalence.test.ts` | 2 | Source/reference contract review |
| `tests/ios-message-surface-behavior-equivalence.test.ts` | 1 | Source/reference contract review |
| `tests/ios-native-live-api-contracts.test.ts` | 1 | Source/reference contract review |
| `tests/ios-native-live-message-surface-boundaries.test.ts` | 1 | Source/reference contract review |
| `tests/ios-native-live-murmur.test.ts` | 1 | Source/reference contract review |
| `tests/ios-spotify-result-surface.test.ts` | 2 | Source/reference contract review |
| `tests/ios-todo-row-transforms.test.ts` | 1 | Source/reference contract review |
| `tests/mobile-home-shell.test.ts` | 2 | Intermittent DOM interaction; deterministic synchronization needed |
| `tests/mobile-search-placeholder-polish.test.ts` | 1 | Source/reference contract review |
| `tests/mobile-ui-polish-2026-08-10.test.ts` | 1 | Source/reference contract review |
| `tests/native-date-layout.test.ts` | 1 | Source/reference contract review |
| `tests/retired-product-surfaces.test.ts` | 1 | Source/reference contract review |
| `tests/system-data-activity-contract.test.ts` | 1 | Source/reference contract review |
| `tests/todo-web-search.test.ts` | 1 | Source/reference contract review |
| `tests/universe-monochrome-ui.test.ts` | 1 | Source/reference contract review |

<details>
<summary>Exact remaining case names</summary>

- Diary read content does not reserve an eight-line minimum before comments
- Diary editor keeps its mobile minimum while comments retain one ruled-line gap
- major custom surfaces now participate in the shared state system
- Every non-input direct alert has explicit explanatory text
- page retains state wrappers, lifecycle installation and exact UI/scroll wiring
- Composer extraction preserves action guards and model correction bodies
- Composer keeps attachment IDs and callback routes through presentation boundaries
- ElevenLabs stays in the assistant result surface, not tool history or backend
- Assistant organization conserves activity bindings, refresh owner, indicators and action routes
- Full router and assistant body recompose to the original ordered blocks
- Moved chrome retains exact visual payloads, geometry and transition ownership
- Native Live transport and DTO declarations conserve exact main contracts
- message rows and canonical block rendering are extracted while root composition stays put
- murmur is a separate activity-row bubble that opens a sheet
- ToolActivity is provider-neutral and AssistantTurn owns results between Activity and body
- projection, reconciliation, Spotify schema/card and voice production stay byte-identical to main
- Todo UI, save, focus scheduling, shared Memory editor and models are conserved
- Home opens C's dialog and saves only C's paper
- Home saves an edited L paper, updates only L preview, and restores trigger focus
- Chat Archive is removed from navigation, routing, and placeholder surfaces
- Diary date filter exposes one atomic 全部时间 action
- Diary route date fields share NativeDateInput
- search export and restore contracts expose active modules only
- Data reads active-module counts and exposes active export actions
- Diary and Day Space use one module search primitive
- Universe follows the accepted monochrome mobile UI contract

</details>

Do not suppress these tests, rewrite pixel/source references automatically, or treat this report as a permanent exception. Resolve each by preserving the intended behavior and adding behavior-level evidence where source matching is inadequate.

## Gates and limits

`pnpm typecheck` now checks both `src/**/*.ts` and `scripts/**/*.ts` strictly without executing scripts. The runtime gate includes daemon recovery and message-surface regressions. Agent path mapping covers actual Mac/Relay/Protocol source directories; the Swift parser fixture explicitly selects its executable parser test. Negative compiler and source-only planning tests guard these boundaries.

See the closeout PR for the final full-suite comparison, fresh gate counts and commands. No model invocation, daemon refresh, deployment or production DB operation is part of these local gates. The earlier #1046 isolated PostgreSQL semantic-admission fixture failure is outside this round and was not rerun or reclassified here.
