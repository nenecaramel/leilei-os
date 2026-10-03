# Mainline 2C implementation plan

Base: 64524efbce8126fe093fe76957821c02c367e2f3 (fetched main). Execute inline with executing-plans/TDD, one fresh whole-branch reviewer at the end.

- [x] Audit attachment authority and B pipeline; real Swift RED fixture for descriptors, layers/layout, formats, Edit and integrity/cache/file lifecycle.
- [x] Extend B attachment input preserving raw metadata; shared media dispatch/state/layout; verified original-byte cache and separate downsampling cache; lifecycle-managed file previews.
- [x] Wire canonical/send/Edit/user/provider and Composer to shared media primitives; media above text-only bubbles; UIKit paging/zoom gallery and visible failure/retry.
- [x] Focused and existing regressions, isolated DB, root/runtime/bridge/Simulator checks, exact-main full suite sequential comparison; independent review and fixes.
- [x] Prepare verified commit for independent PR; push/open and task-only cleanup follow. Physical-device acceptance remains pending; no merge.

Rulings: Backend download-slot already returns identity, MIME, size and SHA plus method/headers; no backend changes needed. Cache verified original bytes in bounded memory and app Library/Caches (not a second authority), keyed by account/attachment/integrity. ImageIO downsamples bitmap candidates; GIF/WebP use explicit first-frame still preview. SVG is a typed media route with visible preview/open fallback, not bitmap decoding or general WKWebView. UIKit page controllers/zoom scroll views own gestures; dismissal uses Done rather than competing drag recognizers.

Ruling: Add a bounded verified-original disk cache beneath memory LRU so four large previews do not force an original-byte redownload on fullscreen entry. Fresh download-slot authorization still precedes every cache read; disk bytes are reverified and corrupt entries deleted before visible failure/retry. No persisted preview paths or attachment database. Actual Swift RED→GREEN covers memory eviction and disk corruption.

Final review: fixed preview-operation Retry routing and the independent 4+ gallery entry, then received a clean recheck. A subsequent source-context audit found draft/retained source loss across the B projector; actual Swift RED→GREEN now protects it without adding provenance to canonical payloads. Disk cache received its own clean read-only review.

Verification: final focused C/B/tool/coordination 12 passed; Swift voice/question/B/C/tool focused 10 passed; existing storage/retention/migration/2A/current-path 68 passed; isolated Postgres 5 passed, zero skipped; production gate 405 + 101 passed; complete bridge 123 passed; typecheck/generated/build/diff and final unsigned arm64 Simulator build passed.

Exact main: **2086 tests / 1982 passed / 10 failed / 94 skipped**. Final PR: **2089 tests / 1985 passed / 10 failed / 94 skipped**. Both full runs exit 1; three additional C tests pass.

- Added failure names: **[]**
- Removed failure names: **[]**

Unchanged failure names:

- `CI checks after a failed gate still run once their setup succeeds`
- `CI reports all verification surfaces independently for PR and push`
- `CI scopes database access to Postgres gates and preserves every verification command`
- `authenticated Native Live internal JSON can exceed the public 1mb limit`
- `iOS Runtime UI prefers SDK tool display names and surfaces API retry state`
- `real Swift Activity preserves final duration and explicitly presents nested permission`
- `tests/ios-native-live-message-surface-boundaries.test.ts`
- `the app JSON parser accepts a 100k CJK Diary body`
- `the app JSON parser remains bounded above 1mb`
- `unauthenticated Native Live internal JSON does not get the larger parser budget`

The Activity-duration fixture fails at the same existing clock-sensitive precondition on main and PR. The message-surface-boundaries file has an existing invalid regular expression and cannot load on either tree. Neither historical issue was changed.
