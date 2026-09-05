# C Author Parity Design

## Status

Approved in chat on 2026-09-05.

Base commit: `090eeb2871c37fb3f9f6ca31fc482fcd9aaf5e76`.

This design extends LeileiOS logical content authorship from `L | G` to `L | G | C`. It does not infer authorship from the calling model, MCP host, OAuth client, source channel, provenance, or login identity.

## Goal

Make `C` a full third logical content author with the same durable capabilities as `L` and `G` across Memory, Diary, Task, Todo, authenticated Web APIs, MCP read/write tools, Home, Day Space, Global Search serialization, and data import/export.

The intended author labels are:

- `L`: Leilei;
- `G`: ChatGPT;
- `C`: Claude.

ChatGPT and Claude may both write content for any of the three authors when the requested author is explicit. The active connector never selects the author automatically.

## Non-goals

This package does not:

- infer `C` because a request came from Claude;
- convert existing `G`, `L`, or null records to `C`;
- add a new identity, authorization role, OAuth client class, or provenance value;
- add a separate Claude database table or author subsystem;
- add a standalone Todo route or redesign Home;
- redesign Day Space, Calendar, paper dialogs, or author signatures;
- add author-specific Calendar markers or a new Global Search filter;
- change Auth0, OAuth, Railway, Bridge, Sentinel, or production configuration;
- merge or depend on PR #278.

## Shared author vocabulary

The single shared vocabulary remains the source of truth:

```ts
export const CONTENT_AUTHORS = ["L", "G", "C"] as const;
export type ContentAuthor = (typeof CONTENT_AUTHORS)[number];

export function isContentAuthor(value: unknown): value is ContentAuthor {
  return value === "L" || value === "G" || value === "C";
}
```

All backend and Web types, runtime validators, serializers, menus, iteration lists, test fixtures, and exact object shapes that currently encode only `L` and `G` must be reconciled with this vocabulary. Local duplicate types may remain only where the existing architecture requires them, and their accepted values must match the shared contract.

## Database migration

Add one forward-only migration after the actual migration head found at implementation time. On the approved base, the current head is `0031_sentinel_hardening.sql`, so the expected next filename is `0032_content_author_c.sql`.

The migration adds `C` to the existing PostgreSQL `content_author` enum. It must not update business rows, rebuild tables, change nullability, or alter existing uniqueness rules.

The existing Todo uniqueness constraint on `(user_id, business_date, author)` already supports a third author and remains unchanged.

All legacy rows retain their exact current authorship:

- `L` remains `L`;
- `G` remains `G`;
- null remains null;
- existing Todo papers remain attached to their stored author.

No provenance-to-author migration or backfill is permitted.

Application startup must apply the migration before code can accept or emit `C`. No production C record may be created until the deployed build has passed read-path acceptance.

## Memory, Diary, and Task behavior

Memory, Diary, and Task keep their existing authorship semantics while adding `C` everywhere `L` and `G` are valid:

- reads expose `L | G | C | null`;
- creates require an explicit non-null author;
- content edits may preserve or explicitly change the author among L, G, and C;
- a legacy-null record cannot save a content edit until an author is selected;
- archive, restore, permanent delete, and Task status-only operations do not select or mutate author;
- Task start, complete, cancel, and reopen remain valid for legacy-null records.

Existing error codes and domain error mechanisms remain authoritative. Invalid authors are rejected without mutation.

## Todo data contract

Each business date contains three independent author slots:

```ts
type TodoDayPapers = {
  L: TodoPaper | null;
  G: TodoPaper | null;
  C: TodoPaper | null;
};
```

A missing C paper is returned as `C: null`; it is not materialized as a durable empty row merely because a day was read.

L, G, and C papers have independent revisions and ordered entries. Saving one author paper never changes another author paper. Todo continues using whole-paper replacement, optimistic revision checks, normalization, atomic persistence, and the current conflict contract.

Todo does not support changing an existing paper's author inside its editor. Content intended for C is edited on the C paper. This avoids cross-author moves, revision merging, and ambiguous deletion semantics.

MCP idempotency hashes continue to include `author`. The same idempotency key and identical normalized content for the same author replays. Reusing the key with another author conflicts and creates no second write.

## MCP contract

Every MCP input or output schema that currently hard-codes the L/G author set must accept or emit C as appropriate. This includes Memory, Diary, Task, and Todo reads and writes.

Todo reads return a fixed `papers: { L, G, C }` object. Tool descriptions that say “L and G” or “L or G” must be updated to “L, G, and C” without changing tool names, annotations, destructive/idempotent flags, authentication, or user ownership.

Both ChatGPT and Claude can explicitly submit any of L, G, or C. The server never derives author from the MCP session, connector, OAuth metadata, client ID, or tool caller.

The MCP registry shape and tool counts must not change as a side effect of author parity.

## Home behavior

The existing Home Todo area adds a third `TodayPanel` for C in fixed order `L → G → C`.

C uses the same panel, paper dialog, editor, persistence, revision-conflict handling, unsaved-change protection, date rollover, and calendar refresh behavior as L and G.

An absent C paper appears as an empty editable Home paper entry. The durable C paper is created only on save through the existing Todo persistence path.

No standalone `/todo` route is introduced. Responsive CSS changes are limited to fitting the third panel while preserving the accepted Home visual language on desktop and mobile.

## Shared author UI

The shared paper author signature supports read-only and editable values `L | G | C | null`.

The menu order is L, G, C. A null legacy author continues to display the faint `—`. Create flows start with no author selected. Content saves remain blocked until the user explicitly chooses L, G, or C.

Memory, Diary, and Task view/create/edit flows, quick-create flows, archived/restored detail views, dirty-state detection, cancel/reset behavior, and inline validation must treat C exactly like L and G.

## Day Space behavior

Day Space composes up to three non-empty Todo papers for a selected date. Stable Todo layout IDs remain `todo:<businessDate>:<author>`, including `todo:<businessDate>:C`.

C Todo papers use the existing Todo dialog and revision-conflict behavior. Empty or missing C papers are not displayed as Day Space cards.

Diary papers with author C display a C signature. The Day Space Diary editor can preserve or explicitly change the author among L, G, and C while keeping existing date, tags, and mood preservation rules.

Module-scoped refresh and failed-refresh recovery must update the C Todo slot correctly. No fallback object may reconstruct only L and G.

A day is considered truly empty only after Todo and Diary both load successfully and there are no active Diary papers and no non-empty L, G, or C Todo papers.

Calendar continues to show one content marker per date, with no author encoding.

## Import, export, and Global Search

Export must serialize C unchanged. Import schemas, canonicalization, planning, persistence, and previews must accept a valid C value and reject invalid values without coercion.

Global Search read models and serializers must preserve and display C wherever author is already returned. This package does not add a new author filter.

No path may convert C to G, null, an unknown placeholder, or an omitted property.

## Error handling and logging

Invalid author input follows the existing module-specific domain/API/MCP error contracts and produces no mutation.

Todo revision conflicts, idempotency conflicts, partial Day Space failures, and legacy-null content edit errors retain their current behavior.

Logs may record safe tool names, error classes, status codes, and author validation failures. They must not add Memory, Diary, Task, or Todo body content to logs.

## Implementation isolation

Create and work only in an isolated worktree for `feat/content-author-c`, based on `main@090eeb2871c37fb3f9f6ca31fc482fcd9aaf5e76`.

PR #278 remains an independent frontend-label change. This branch must not copy or cherry-pick #278. If main advances before this branch becomes Ready, rebase on the latest main and rerun the complete validation matrix.

Development may create commits and a Draft PR. It must not merge, deploy, modify Railway/Auth0/OAuth, apply a production migration, or create production C data without later explicit authorization.

## Testing strategy

Use TDD for every behavioral slice.

### Static contract audit

Search the entire repository for hard-coded author assumptions, including:

- `["L", "G"]`;
- `"L" | "G"`;
- `{ L, G }` paper objects;
- iteration lists containing only L and G;
- Zod schemas that accept only L and G;
- user-facing copy that promises only L/G;
- import/export and search serializers with a closed L/G union.

Each occurrence must either support C or be documented as intentionally unrelated.

### Database

Verify:

- the migration adds exactly C;
- no business-row update or backfill exists;
- legacy rows retain L/G/null;
- C persists for Memory, Diary, Task, and Todo;
- the existing Todo user/date/author uniqueness constraint applies to C;
- the complete migration chain applies to a disposable PostgreSQL database.

### Domain, API, and MCP

Cover C create/read/edit/reassign behavior for Memory, Diary, and Task; lifecycle/status author preservation; Todo C read/write/revision/idempotency behavior; MCP schema acceptance and exact C output; fixed three-slot Todo responses; unchanged authentication and registry counts.

### Web

Cover the shared C author signature; Memory/Diary/Task view/create/edit/quick-create; Home third panel, empty paper, save, date rollover, and unsaved-change handling; Day Space C Todo and C Diary behavior; partial failure and post-save recovery; import/export previews; and Global Search display.

### Final gates

Run:

- focused RED/GREEN suites for each slice;
- the deterministic full test suite;
- Root typecheck and build;
- Web typecheck and production build;
- `drizzle-kit check`;
- `git diff --check`;
- clean-worktree verification;
- disposable PostgreSQL full-chain migration verification;
- the repository's formal Security Scan.

Record exact commands, pass/fail/skip totals, final commit SHA, base SHA, migration head, changed-file list, and any unavailable verification with the precise reason.

## Deployment and rollback

Before production:

1. verify the intended final SHA and migration head;
2. confirm a current encrypted PostgreSQL backup and restore readiness;
3. record author counts for Memory, Diary, Task, and Todo;
4. deploy the migration and C-aware application;
5. verify health and old L/G/null reads before authorizing C writes;
6. verify ChatGPT and Claude can both read the three-author contracts;
7. obtain explicit authorization before the first production C write;
8. smoke-test one approved C path at a time and inspect safe logs.

If failure occurs before any C write, application rollback is allowed while leaving the additive enum value in place. Do not run a destructive down migration.

After any C record exists, do not roll back to an application that only understands L/G. Fix forward with a C-aware build.

## Acceptance criteria

The feature is accepted when:

1. C is a valid logical author everywhere L and G are valid across Memory, Diary, Task, and Todo.
2. ChatGPT and Claude can each explicitly write any of L, G, or C through the same authenticated MCP surface.
3. No connector, OAuth client, model, source, or provenance automatically chooses author.
4. Existing L/G/null business data is unchanged.
5. Todo returns and maintains independent L, G, and C papers.
6. Home exposes a third C Todo paper with existing interaction semantics.
7. Day Space displays and edits C Todo and Diary content without layout or failure-state regressions.
8. Import, export, and Global Search preserve C exactly.
9. Invalid author values fail closed without mutation.
10. All required tests, builds, migration checks, and Security Scan pass on the final commit.
11. The branch remains independent of #278 and production remains untouched until separately authorized.
