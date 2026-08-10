# L/G Author Foundation Design

Date: 2026-08-10
Base: `codex/phase-6-web-ui-foundation` at `0c2e70de174527c650c4974b917072995968e6d6`
Implementation branch: `codex/lg-author-foundation`

## 1. Goal

Add a first-class logical content author to Memory, Diary, and Task without inventing authors for legacy data.

The only valid logical authors are `L` and `G`. Authorship means content ownership inside Leilei OS. It is not the authenticated account, OAuth identity, authorization subject, creator channel, MCP/Web provenance, or audit actor.

This package establishes the author invariant across database schema, domain/repository boundaries, Web API, Web paper UI, and the three existing persistent MCP write tools. Todo is intentionally excluded and will be implemented as a separate package after this foundation is production-accepted.

## 2. Product invariants

1. `L` and `G` are the only authored values.
2. Existing Memory, Diary, and Task rows remain `NULL` after migration unless a user explicitly assigns an author later.
3. No migration, service, API, MCP tool, UI path, seed path, or provenance field may infer or backfill author from `source`, `tool_calls`, Web/MCP channel, audit actor, timestamps, or any other indirect signal.
4. Every new durable Memory, Diary, or Task created after the feature is active must receive an explicit `L` or `G` before persistence.
5. A legacy-null record can still be read, archived, restored, or have Task business status changed without assigning an author.
6. A content edit of a legacy-null record requires explicit author selection before the edit can persist.
7. Lifecycle-only changes and Task status-only changes preserve the stored author exactly, including `NULL`.
8. Authorship is not a permission mechanism. Existing server-owned authenticated-user isolation remains authoritative.
9. There is no remembered/default author setting. Create flows begin unselected and may not silently reuse the previous choice.

## 3. Alternatives considered

### Recommended: shared PostgreSQL enum plus nullable columns

Create one database enum such as `content_author` with exactly `L` and `G`, then add nullable `author` columns to `core_memories`, `diary_entries`, and `tasks`.

Advantages:
- one database-level vocabulary shared by all three domains;
- invalid values are impossible to persist through ordinary SQL;
- nullable columns preserve legacy uncertainty without a destructive backfill;
- a later `NOT NULL` tightening can be considered only after legacy nulls are explicitly resolved.

Trade-off: adding a third author in the future would require a migration. That is desirable while the product contract intentionally allows only L/G.

### Alternative: varchar columns with repeated CHECK constraints

This avoids a PostgreSQL enum but duplicates the same constraint on three tables and is easier for the schemas to drift. It provides no meaningful product benefit today.

### Rejected: infer/backfill author from provenance

Mapping `web`, `mcp`, `chatgpt_mcp`, audit actor, or source metadata to L/G would collapse technical provenance into content ownership and would mislabel historical records. This is explicitly prohibited.

## 4. Database and typed model

Add a shared TypeScript author type equivalent to:

```ts
type ContentAuthor = "L" | "G";
```

Read models for Memory, Diary, and Task expose:

```ts
author: ContentAuthor | null;
```

The next Drizzle migration after `0014_early_ozymandias.sql` must:
- create the shared author enum with only `L` and `G`;
- add nullable `author` to `core_memories`;
- add nullable `author` to `diary_entries`;
- add nullable `author` to `tasks`;
- perform no UPDATE/backfill of existing business rows;
- add no author indexes until an actual author-filtered query requires them.

Repository insert contracts for normal post-feature creates must require non-null `ContentAuthor`, even though the physical columns remain nullable for legacy compatibility.

Repository reads must preserve `NULL` exactly.

Content-update repository contracts may accept an explicit author change, but lifecycle/status repositories must not accept an author argument and must not write the column.

## 5. Domain write semantics

### Create

`MemoryService`, `DiaryService`, and `TaskService` must require explicit `L`/`G` for all new durable content. Validation belongs at the service boundary as well as the transport boundary so internal callers cannot bypass the invariant.

Any non-test internal create path that remains capable of creating one of these records, including the historical Phase 2 Memory seed path, must either require an explicit operator-supplied author or stop creating new rows. It must never choose L/G from source metadata.

### Content edit

For existing authored records:
- if the edit request omits author, preserve the existing author;
- if the edit request explicitly supplies `L` or `G`, allow the user to correct/reassign the content owner in the same content edit.

For legacy-null records:
- an edit request without author fails safely with domain error code `AUTHOR_REQUIRED`;
- an explicit `L` or `G` allows the content edit and sets author atomically with that edit.

The Web UI will always send its visible author selection during an edit, but the domain rule above preserves compatibility for existing authored clients.

### Lifecycle and Task status

Memory/Diary/Task archive and restore preserve author.

Task start/complete/cancel/reopen preserve author.

These operations must continue to work on legacy-null rows. They are not content-edit operations and must not be used as a hidden backfill mechanism.

## 6. Web API contract

Existing authenticated user isolation, 403/404 behavior, lifecycle predicates, mutation gates, and safe errors remain unchanged.

### Reads

Existing Memory, Diary, and Task list/detail/archived payloads add `author: "L" | "G" | null`.

No new author filter is added in this package.

Global Search query semantics and cursor contracts remain unchanged.

### Creates

Memory, Diary, and Task create request bodies require `author` with exactly `L` or `G`.

Missing or invalid author is a safe client error and must create no business row, audit row, or idempotency record.

### Content updates

Content-edit endpoints accept optional `author: "L" | "G"`.

If the target record currently has `author = NULL` and author is omitted, return safe error code `AUTHOR_REQUIRED` and make no mutation.

If author is provided, the content fields and author change commit together through the existing write boundary.

Lifecycle/status endpoints do not accept author.

## 7. Web paper UX

Author is shown only where the paper itself is viewed/edited in this package. Existing list-card layouts do not gain another metadata row.

Use one small shared author-signature UI primitive across Memory, Diary, and Task paper surfaces rather than three independent implementations.

### View mode

The lower-right paper signature displays:
- `L` for L-authored content;
- `G` for G-authored content;
- a faint `—` for legacy-null content.

Archived detail is read-only and follows the same display rule.

### Create mode

The lower-right signature begins as faint `—` on every create, including Home quick-create navigation.

Tapping it offers exactly `L` and `G`.

There is no default, no last-used persistence, and no inference from the logged-in account or route.

Submission cannot succeed until L/G has been selected. The existing inline-error pattern should be used rather than introducing a new toast system.

### Edit mode

An authored record starts with its current L/G selected. The user may deliberately switch it before saving.

A legacy-null record starts at `—`; saving is blocked until L/G is chosen.

Canceling an edit discards an unsaved author selection along with the other unsaved form state.

Existing unsaved-changes protection and per-page synchronous mutation gates remain active.

## 8. MCP contract

The registered MCP tool count remains exactly 16. No Todo, edit, archive, restore, delete, or new author-management tool is introduced.

### Persistent writes

The existing `write_memory`, `write_diary`, and `create_task` input schemas require explicit `author: "L" | "G"`.

The author participates in normalized write input and durable MCP idempotency fingerprints. Therefore:
- replaying the same key with the same normalized content and same author replays normally;
- reusing the same key with a different author is an idempotency conflict and creates no second business row;
- legacy idempotency compatibility must never replay a historical null-author row as if it satisfied a new explicitly authored request.

Existing approval annotations, authenticated server-owned identity, safe errors, and no-automatic-retry behavior remain unchanged.

### Reads

All seven existing module-specific Memory, Diary, and Task read tools add `author: "L" | "G" | null` additively to each returned record where that tool returns a Memory/Diary/Task record:
- Memory: `read_memory`, `search_memory`, `get_memory`;
- Diary: `search_diary`, `get_diary`;
- Task: `list_tasks`, `get_task`.

`global_search` is not changed in this package; adding author filtering, author result fields, or author-aware ranking there is a separate product decision.

Toy tools are untouched.

## 9. Audit and provenance separation

Do not rewrite `source`, `tool_calls`, `resource_lifecycle_events`, actor/channel values, or existing audit semantics to represent author.

Author is business content metadata. Provenance and audit remain technical history.

No new audit payload should copy private Memory/Diary/Task content merely to record an author selection.

## 10. Error handling and atomicity

All invalid/missing author failures occur before persistence when possible.

For legacy-null edits, the server still enforces `AUTHOR_REQUIRED` even if the Web client normally prevents submission.

Where a repository transaction already exists, author must participate in the same transaction as the business content write. A failed author/content update must not partially persist either side.

Cross-user behavior remains indistinguishable from existing not-found rules; adding author must not become an existence oracle.

## 11. Testing strategy

Implementation uses TDD and extends existing module tests rather than replacing them.

Required coverage includes:

### Migration/schema
- migration chain from the current `0014` state to the new migration;
- existing Memory/Diary/Task rows remain present and have `author = NULL` after migration;
- the database author type allows only `L`/`G` while each of the three legacy-compatible columns remains nullable;
- Drizzle schema matches the migration;
- no Todo table is introduced by Package A.

### Domain/repository
For Memory, Diary, and Task:
- create requires explicit L/G;
- create persists and reads the exact author;
- legacy-null read remains null;
- legacy-null content edit without author fails with no mutation;
- legacy-null content edit with L/G succeeds atomically;
- authored content edit preserves author when omitted;
- explicit edit can switch L↔G;
- archive/restore preserves L/G and NULL;
- Task status transitions/reopen preserve L/G and NULL;
- ownership isolation remains intact.

### Web API/UI
- create requests reject missing/invalid author;
- list/detail/archived responses expose nullable author;
- paper view renders L/G/`—` correctly;
- create begins unselected and requires a signature;
- edit preselects authored values;
- legacy-null edit requires selection;
- cancel restores original author/form state;
- Home quick-create does not preselect author;
- existing mutation gate and unsaved-changes behavior still pass.

### MCP
- all three persistent content write tools require author;
- strict schemas continue rejecting client-supplied user identity;
- same idempotency key + same author replays;
- same idempotency key + different author conflicts;
- all seven module-specific read tools expose nullable author on returned records;
- tool count stays 16 and write-tool count stays 5;
- Toy behavior is unchanged.

### Final gates
- deterministic serial full suite: `pnpm exec tsx --test --test-concurrency=1 tests/**/*.test.ts`;
- root typecheck and production build;
- Web typecheck and production build;
- `pnpm db:check` / current Drizzle validation;
- applicable real PostgreSQL migration/integration tests in an isolated disposable database;
- `git diff --check`;
- final changed-file and sensitive-information scan.

## 12. Deployment and rollback

This change has a database migration, so production rollout follows the existing database safety runbook.

Order:
1. fresh-verify the production application SHA and intended migration head;
2. confirm a current encrypted external backup and recovery readiness;
3. apply the additive nullable-author migration before deploying code that selects the new columns;
4. verify all legacy business-row counts and confirm old rows were not backfilled;
5. deploy the application;
6. smoke-test old null-author reads, Web creates/edits, lifecycle/status preservation, and the three MCP writes;
7. production iPhone acceptance of the L/G/`—` paper signatures;
8. only after production acceptance, sync the accepted main baseline into the isolated PWA 7.6A branch and rerun its full gates/standalone smoke.

Rollback is forward-safe: if the application deployment must be rolled back after the migration, leave the additive nullable columns/enum in place and roll back only the application. Do not run a destructive down-migration against production data.

## 13. Explicit non-goals

Package A does not:
- create `todo_entries` or move Todo off localStorage;
- change Todo L/G paper identity rules;
- connect Day Space to real data;
- define Calendar markers;
- add author filtering to Global Search;
- add new MCP tools;
- add MCP edit/archive/restore/delete operations;
- infer or bulk-backfill legacy author;
- tighten Memory/Diary/Task author to `NOT NULL`;
- change PWA caching, service worker, Auth0, or offline behavior;
- reopen the abandoned Safari-specific PaperDetailDialog P0.

## 14. Completion boundary

Package A is complete only when:
- the migration and all code gates pass;
- production migration/deployment is verified;
- old null-author records remain intact and readable;
- new Web and MCP creates require and persist explicit L/G;
- legacy-null content edits require explicit assignment;
- lifecycle/status-only actions preserve author exactly;
- iPhone production paper-signature behavior is accepted;
- the accepted baseline can then become the starting point for Package B: Todo Foundation.
