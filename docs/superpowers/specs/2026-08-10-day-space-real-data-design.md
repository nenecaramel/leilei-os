# Day Space Real Data Design

Date: 2026-08-10

Design branch: `docs/day-space-real-data-design`

Pre-A/B UI reference baseline: `codex/phase-6-web-ui-foundation` at `0c2e70de174527c650c4974b917072995968e6d6`

Package A design dependency: `L/G Author Foundation` at spec commit `c940b16f483b77f9031ce99c07e261f241e3dc2e`

Package B design dependency: `Todo Foundation` at spec commit `4e60f359ed96f437cdc7867ff1f7b8d2d56f58a1`

## 1. Status and sequencing

This document defines the **Day Space Real Data** package.

The package is design-only until both prerequisite packages are finished and accepted:

1. Package A — L/G Author Foundation must be implemented, reviewed, production-migrated/deployed, and accepted.
2. Package B — Todo Foundation must then be implemented from the accepted A baseline, reviewed, production-migrated/deployed, and accepted.
3. Only after B is accepted may the Day Space implementation plan be written against the actual final B baseline.

The future implementation branch should be created from that final accepted B baseline, not from this documentation branch and not from the pre-A/B UI reference commit above.

Before implementation planning begins, bind the plan to:

- the final accepted Package B commit;
- the actual migration head after A and B;
- the actual shared `ContentAuthor` API landed by A;
- the actual Todo Web API, revision semantics, and Web types landed by B.

This package itself introduces **no database migration**.

## 2. Goal

Replace the current Day Space Todo/Diary prototype data with authenticated server-backed Todo and Diary data while preserving the accepted Day Space paper experience.

The intended user-visible result is:

- Day Space still contains only Todo and Diary papers;
- the selected date controls which real Todo and Diary content appears;
- existing paper layout, previews, date navigation, and edit dialogs remain familiar;
- edits change the same durable records used by Home and Diary rather than local fixture copies;
- partial backend failures are visible without hiding successfully loaded content;
- no fixture, localStorage, or stale-cache fallback can masquerade as complete Day Space truth.

Day Space remains a **composition view**, not a new persistence domain.

## 3. Product invariants

### Included content

Day Space contains exactly:

- Todo;
- Diary.

Memory and Task remain out of scope.

### Date ownership

Todo belongs to the Day Space date identified by Todo `business_date`.

Diary belongs to the Day Space date identified by Diary's own business `date` field.

Diary `created_at` and `updated_at` do not determine Day Space placement. Editing a Diary title, body, or author does not move it to another day. A Diary moves only when its `date` is deliberately changed through a Diary surface that exposes date editing.

All business-date values remain strict `YYYY-MM-DD` local-calendar values. Day Space must not convert them according to UTC timestamps.

### Diary lifecycle

Only active Diary entries appear in Day Space.

Archiving a Diary removes it from its Day Space date. Restoring it makes it eligible to appear again on that date.

Archived Diary entries do not contribute to Diary content-date discovery.

### Todo content presence

A Todo paper appears in Day Space only when it contains at least one durable entry.

A missing Todo paper does not appear.

An existing durable Todo paper with `entries: []` also does not appear and does not make the date contentful.

This preserves Package B's distinction between durable paper existence and visible Todo content.

### Multiple Diary entries

Each durable Diary entry is one Day Space paper.

There is no per-day or per-author Diary collapsing. If one day has five active Diary entries, Day Space shows five independent Diary papers, even if several share the same author.

### Creation scope

Day Space provides no new-content entry point in this package.

An empty date remains an empty date. It does not gain “new Diary”, “new L Todo”, or “new G Todo” controls.

New Diary content continues to originate from Diary creation flows. New Todo content continues to originate from Todo/Home flows. Once that data exists durably for a date, Day Space displays it.

## 4. Architecture choice

### Chosen approach: frontend composition of module-owned APIs

Day Space does not gain a database table, repository, service, or aggregate persistence API.

The ownership model stays:

`Diary UI/API -> DiaryService -> DiaryRepository -> diary_entries`

`Todo UI/API -> TodoService -> TodoRepository -> todo_papers/todo_entries`

Day Space reads those two modules independently in the Web client and composes their successful results into the existing paper layout.

This is preferred because:

- Day Space owns no business data of its own;
- Todo and Diary already have independent lifecycle and write semantics;
- partial-success behavior is straightforward when the two reads remain independent;
- no cross-domain backend service is needed solely to concatenate two response shapes;
- later Calendar work can design its own marker/read contract without coupling it to a Day Space aggregate endpoint.

### Rejected: Day Space aggregate backend

Do not add `DaySpaceService`, `DaySpaceRepository`, a Day Space database table, or a `/day-space/:date` backend aggregate endpoint in this package.

That would create a new domain boundary for data that already belongs to Todo and Diary and would make independent partial-failure handling less natural.

### Rejected: Global Search as a read source

Global Search is not a Day Space data source. Search semantics, ranking, cursors, and module coverage are unrelated to complete exact-date retrieval.

## 5. Narrow Diary read additions

The existing generic Diary list endpoint is intentionally bounded and is not the complete-data contract Day Space needs. Day Space therefore adds two narrow **Diary-owned** reads rather than widening or repurposing the generic list API.

Both routes must be registered before the existing `GET /api/v1/diary/:id` route so literal route segments cannot be swallowed as Diary ids.

### `GET /api/v1/diary/dates`

Return every distinct business date that contains at least one active Diary entry for the authenticated user.

Conceptual response:

```json
{
  "success": true,
  "data": {
    "dates": ["2026-08-10", "2026-08-07"]
  }
}
```

Contract:

- dates are unique;
- dates are strict valid `YYYY-MM-DD` values;
- dates are sorted descending;
- archived-only dates are excluded;
- a legacy Diary with `author = null` still makes its active business date contentful;
- user ownership is always derived from authenticated server context, never request input;
- this endpoint returns date scalars only and does not reuse the generic Diary item limit.

### `GET /api/v1/diary/by-date/:date`

Return **all active Diary entries** for one exact valid business date for the authenticated user.

Conceptual response:

```json
{
  "success": true,
  "data": {
    "date": "2026-08-10",
    "diaries": [
      {
        "id": "...",
        "title": "...",
        "content": "...",
        "date": "2026-08-10",
        "author": "L",
        "tags": [],
        "mood": null,
        "created_at": "...",
        "updated_at": "..."
      }
    ]
  }
}
```

Contract:

- exact real-calendar date validation is required;
- all matching active entries are returned; this route must not silently truncate at the generic 50/100-item list limits;
- archived entries are excluded;
- `author` follows Package A and may be `"L"`, `"G"`, or `null`;
- tags and mood remain present because Day Space editing must preserve fields it does not expose;
- repository queries remain scoped to the authenticated user;
- the endpoint does not expose another user's record existence through error differences.

No new Diary write endpoint is introduced.

## 6. Todo dependency contract

Day Space consumes Package B's real Todo API exactly as landed.

The expected contract from the approved B design is:

- `GET /api/v1/todo/dates` — dates containing at least one durable non-empty Todo entry;
- `GET /api/v1/todo/:date` — the L and G paper state for one business date;
- `PUT /api/v1/todo/:date/:author` — atomic whole-paper replacement using Package B revision semantics.

Day Space must not duplicate Todo persistence logic, reconstruct Todo from localStorage, or add a second Todo write model.

If B's final accepted implementation differs in naming while preserving the approved semantics, the Day Space implementation plan must bind to the actual accepted API rather than invent a parallel route.

## 7. Default date resolution and navigation

### Explicit date

If the URL contains a valid explicit `?date=YYYY-MM-DD`, that date wins immediately.

Day Space does **not** need Todo/Diary date-discovery requests merely to validate or decorate an explicit date. It proceeds directly to that day's Todo and Diary reads.

If the URL contains an invalid `date` value, treat it as having no valid explicit date and run the normal real-data default-date discovery below. Never use prototype dates as the invalid-date fallback.

### No valid explicit date

When no valid explicit date is supplied, fetch Todo content dates and Diary content dates independently and concurrently.

Resolution rules:

1. If both succeed and their union is non-empty, take the latest date from that union.
2. If both succeed and both sets are empty, use today's browser-local business date.
3. If exactly one succeeds and its set is non-empty, use its latest date and mark latest-date discovery as incomplete.
4. If exactly one succeeds and its set is empty, use today's browser-local business date and mark latest-date discovery as incomplete. This is a fallback location only; the UI must not claim there is globally no content.
5. If both date-discovery requests fail, do not silently fall back to today. Show a load-failure/retry state because no trustworthy default date can be established.

A partial discovery result may make the chosen date usable, but it must never be described as definitely the globally latest content date.

### Navigation after selection

Once a date is selected, previous-day, next-day, and date-picker navigation remain unrestricted by content presence.

Users may navigate freely to dates with no content.

The “latest content date” rule is only an initial no-explicit-date landing rule. Day Space must not automatically jump to another date later merely because an edit makes the current date empty or because background data changes.

The current date picker remains a plain date selector. This package adds no content dots, badges, or Calendar-style date markers.

## 8. Selected-date data flow

For the selected business date, start two independent reads in parallel:

- Diary exact-date read;
- Todo day read.

Use separate loading, success, and failure state for the two modules.

The Web client may use `Promise.allSettled`, independent requests, or an equivalent pattern, but one module's rejection must not discard the other module's successful payload.

### Race protection

Changing dates can create overlapping requests. A slow response for an older date must never overwrite the state for a newer selected date.

Use an abort signal, request generation id, or equivalent explicit stale-response guard for both module reads.

When the selected date changes, do not display the previous date's papers under the new date while new requests are pending.

### Composition

After successful reads, derive Day Space paper models from real module data and pass them to the existing deterministic layout.

Use collision-proof stable layout ids:

- Diary: `diary:${diary.id}`;
- Todo: `todo:${businessDate}:${author}`.

The Todo layout id is based on date/author rather than relying on whether the accepted B response exposes an internal database paper id.

Preserve the existing accepted density/preview/layout heuristics unless adaptation to the real Web types requires a narrow mechanical change. This package is not a paper-layout redesign.

## 9. Empty, partial, and failed states

### Complete empty day

Show “这一天还没有内容” only when:

- the selected-date Diary request succeeded and returned zero active Diary entries; and
- the selected-date Todo request succeeded and returned no non-empty L/G paper.

This is the only state that may assert the day is empty.

### Partial selected-date success

If one selected-date module succeeds and the other fails:

- show the successful module's real papers;
- show a small explicit partial-load warning;
- identify that the current Day Space result is incomplete;
- provide retry for the failed source;
- do not replace the failed source with fixtures, localStorage, old cached papers, or inferred emptiness.

If the successful module itself contains no papers, do not show the ordinary complete-empty message because the failed module may still contain content.

### Both selected-date reads fail

Show a Day Space load-failure/retry state for that selected date.

Date navigation may remain usable, but the page must not claim the date is empty.

### Latest-date discovery warning

A failure in one of the two initial date-discovery sources is distinct from a failure in one of the selected-date content reads.

If the selected day's two content reads later succeed, the page may have complete content for that selected date while still being unable to prove that it was the globally latest content date. Keep those states logically distinct even if the UI presents them with one compact warning treatment.

## 10. Diary paper behavior

### View

Each active Diary is an independent paper.

Display its L/G author signature using the shared author-signature primitive from Package A.

A legacy Diary with `author = null` remains visible and displays the faint `—` state. Day Space must never infer L or G from provenance, timestamps, source channel, or neighboring content.

### Edit

Opening a Diary paper continues to use the Day Space Diary paper dialog/editor experience.

Editable fields in Day Space are exactly:

- title;
- content/body;
- author signature (`L` or `G`).

The Diary date is visible/known but not editable from Day Space.

Tags and mood are also not edited from Day Space. When saving, preserve the currently loaded durable `date`, `tags`, and `mood` unchanged rather than omitting them in a way that could reset them through the existing full-content update contract.

An authored Diary begins with its stored L/G author selected and may be deliberately reassigned during the same content edit, matching Package A.

A legacy-null Diary begins at `—`. A content edit cannot save until L or G is explicitly selected. The client blocks the invalid save, and Package A's server-side `AUTHOR_REQUIRED` rule remains authoritative if a client bypasses that UI guard.

No date change is sent from Day Space.

### Diary save behavior

Reuse the existing Diary update endpoint and Package A author semantics. Do not create a Day Space write endpoint.

Preserve existing unsaved-change protection and one in-flight mutation gate for the open editor.

On successful persistence:

- use the committed response as the immediate known result for the edited record;
- refresh/re-read only the selected date's Diary module state;
- do not force a Todo reload solely because a Diary changed.

If that Diary re-read fails after a successful save, do not pretend the whole Diary set is fully refreshed. Preserve the just-committed record as known server truth where practical and mark the Diary module as needing retry rather than discarding the successful save outcome. A just-committed server response is not a stale-cache fallback and must not be relabeled as complete module truth after the follow-up read fails.

## 11. Todo paper behavior

### View

For the selected date, show at most two Todo papers:

- L, when the durable L paper contains at least one entry;
- G, when the durable G paper contains at least one entry.

A missing paper and an existing empty paper are both invisible in Day Space, although they remain distinct in the Todo API for migration/concurrency purposes.

### Edit

Opening a Todo paper continues to use the accepted Todo paper editor interaction, adapted to Package B's real Todo Web types.

Saving uses Package B's complete-paper PUT and the revision that was loaded for that paper.

All Todo validation, normalization, atomicity, and concurrency semantics remain owned by Package B.

### Conflict

On Package B's `409 TODO_PAPER_CONFLICT`:

- keep the Todo paper open;
- preserve unsaved edits exactly;
- show the existing narrow inline conflict/error treatment;
- do not auto-refresh;
- do not auto-merge;
- do not auto-overwrite the durable version.

Day Space adds no second conflict algorithm.

### Todo save success

After successful persistence:

- use the committed paper response as the immediate known result;
- refresh/re-read only the selected date's Todo module state;
- do not force a Diary reload solely because Todo changed.

If a successful edit empties the Todo paper, the paper disappears from Day Space after the committed/refresh state reflects `entries: []`. Day Space remains on the same selected date and does not auto-jump elsewhere.

If the Todo re-read fails after a successful save, apply the same rule as Diary: preserve the just-committed paper as known server truth, mark the Todo module as needing retry, and do not represent the complete module as freshly reconciled.

## 12. Prototype and localStorage removal from Day Space runtime

The real-data path must stop using prototype content as a normal source of truth.

Remove Day Space runtime dependency on:

- `DAY_SPACE_DIARY_PROTOTYPES`;
- `DAY_SPACE_TODO_SEEDS`;
- Home Todo localStorage reads as a Day Space data source;
- any behavior where a missing server value turns into fixture content.

Prototype data may be deleted or retained only for isolated tests/story fixtures that cannot enter production runtime behavior.

Package B may still contain its own one-time Home Todo legacy localStorage migration mechanism. Day Space must not invoke that legacy storage as its own fallback/cache layer.

## 13. Web component boundaries

Keep the work narrow around existing Day Space components rather than rewriting the feature.

Expected responsibilities:

### `DaySpacePage`

Own selected-date orchestration, independent Todo/Diary load states, partial-failure presentation, paper composition, and module-scoped refresh triggers.

If request orchestration makes the page difficult to test or understand, extract a small Day Space Web-only data helper/hook with no backend-domain responsibilities. Do not create an architectural abstraction merely for naming symmetry.

### `DaySpaceDatePicker`

Remain a plain unrestricted calendar-date selector. No content markers in this package.

### `DaySpaceDiaryDialog`

Replace fixture-only save behavior with the real Diary update path, shared author-signature editing, legacy-null author handling, and preservation of non-exposed Diary fields.

### Existing Todo dialog/editor

Reuse the accepted Todo editor as adapted by Package B. Day Space should not fork another Todo editing implementation.

### `day-space-layout`

Keep the current deterministic layout algorithm. Real-data integration supplies stable paper ids and densities; it does not redesign placement.

## 14. Security and data ownership

All Day Space reads and writes remain behind the existing authenticated Web API.

The client never sends or chooses a durable `user_id`.

Diary date discovery and exact-date reads must scope every repository query to the authenticated user.

Todo user isolation remains Package B's responsibility and is reused unchanged.

Author is logical content ownership, not an authorization mechanism. L/G must not alter authenticated-user isolation.

Partial-failure UI must not expose raw database errors, private SQL details, or existence information from other users.

## 15. Testing strategy

Implementation should use TDD and extend existing module/Web tests without replacing unrelated suites.

### Diary backend tests

Cover at least:

- `GET /diary/dates` returns unique active dates only;
- dates are sorted descending;
- archived-only dates are excluded;
- active legacy-null-author Diary contributes its date;
- user isolation is preserved;
- `GET /diary/by-date/:date` returns every active matching Diary;
- exact-date read preserves `author`, `tags`, and `mood`;
- archived entries are excluded;
- exact-date results are not truncated by generic Diary list limits, including a fixture larger than the current generic maximum;
- invalid calendar dates fail safely;
- literal `/dates` and `/by-date/...` routing cannot be swallowed by `/:id`.

### Day Space data-orchestration tests

Prefer pure helpers or narrowly testable Web units for:

- valid explicit date bypasses default-date discovery;
- invalid explicit date enters real-data default discovery rather than prototype fallback;
- both date sources succeed -> latest union date;
- both date sources succeed empty -> today;
- one date source succeeds non-empty / one fails -> latest known date + incomplete discovery state;
- one date source succeeds empty / one fails -> today + incomplete discovery state;
- both date sources fail -> no silent today fallback;
- selected-date Diary/Todo reads remain independent;
- one selected-date source fails -> successful papers remain visible + partial state;
- both selected-date sources succeed empty -> true empty state;
- one source fails while the other is empty -> not a true empty state;
- stale responses from an older selected date cannot overwrite a newer date;
- multiple same-day Diary entries remain separate papers;
- null-author Diary remains visible with `—`;
- empty Todo papers do not become Day Space cards;
- layout ids are stable and collision-safe;
- no fixture/localStorage runtime fallback is used after real-data integration.

### Edit-flow tests

Cover at least:

- Day Space Diary save edits title/content/author but preserves date/tags/mood;
- legacy-null Diary cannot save content changes until author is selected;
- authored Diary may switch L/G;
- Diary save refreshes Diary only;
- Todo save uses the loaded revision;
- Todo 409 keeps unsaved state and does not auto-refresh/overwrite;
- Todo save refreshes Todo only;
- emptying a Todo removes its Day Space card without moving the selected date;
- save/reload failure states do not erase the other module's successful data.

### Final verification

Run the repository's deterministic test command and the existing root/Web typecheck/build gates required by the accepted project workflow.

No production migration exists for this package, but implementation acceptance still requires production-safe API/Web deployment verification after code review.

## 16. Non-goals

This package does not add:

- Memory or Task to Day Space;
- a Day Space database table;
- `DaySpaceService` or `DaySpaceRepository`;
- a Day Space aggregate backend endpoint;
- Todo database/schema changes beyond what Package B already owns;
- author database/schema changes beyond what Package A already owns;
- Day Space create-new-content controls;
- Diary archive/restore controls inside Day Space;
- Diary date editing inside Day Space;
- Diary tags/mood editing inside Day Space;
- Calendar markers in the Day Space date picker;
- Calendar real-data UI;
- Global Search changes;
- MCP changes;
- PWA foundation changes;
- Safari/P0 work;
- a new cross-module cache or data-fetching framework;
- a new Todo concurrency model;
- a new Diary concurrency/revision system;
- unrelated UI restyling.

## 17. Acceptance criteria

The package is accepted when all of the following are true:

1. Day Space production runtime contains no Todo/Diary fixture fallback.
2. A valid explicit date displays exactly that date's active real Diary papers and non-empty real L/G Todo papers.
3. No valid explicit date lands on the latest known real content date according to the approved complete/partial discovery rules.
4. Date navigation remains unrestricted and can display genuinely empty dates.
5. A true empty message appears only after both selected-date module reads succeed empty.
6. Partial Todo/Diary failures preserve successful real data and visibly indicate incompleteness.
7. Multiple same-day Diary entries remain separate papers.
8. Archived Diary entries never appear.
9. Legacy null-author Diary entries appear with `—` and require explicit L/G before a content edit can save.
10. Day Space Diary editing changes only title/content/author and preserves date/tags/mood.
11. Day Space Todo editing uses Package B whole-paper persistence and conflict behavior.
12. Successful edits are visible from the owning module because Day Space edits the same durable records, not copies.
13. Empty Todo papers do not create cards or content-date presence.
14. Slow responses for an older date cannot overwrite a newer selected date.
15. Day Space adds no database migration and no new persistence domain.
16. Existing deterministic layout and accepted paper interaction remain materially unchanged except where real-data/error/author behavior requires narrow additions.
17. Required tests, typechecks, and builds pass on the final implementation baseline.

## 18. Implementation handoff rule

Do not write or execute the Day Space implementation plan from this documentation branch.

After Package A and Package B are both fully accepted, first inspect the actual final B baseline and reconcile this design against the code that truly landed. Then write the implementation plan from that concrete baseline.

If A or B's accepted implementation changes an underlying route/type name without changing the approved product semantics, update the implementation plan to the real API rather than creating compatibility duplication.

If A or B materially changes one of the semantics this design depends on, return to design review before implementation instead of silently resolving the conflict in code.
