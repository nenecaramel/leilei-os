# L/G Author Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit logical content authorship (`L` / `G`) to Memory, Diary, and Task across PostgreSQL, domain/repository code, authenticated Web API, Web paper UI, and the existing persistent MCP write/read tools, while leaving all legacy rows nullable and never inferring authorship from provenance.

**Architecture:** Introduce one shared `ContentAuthor` vocabulary and one shared PostgreSQL enum, then thread nullable author reads and explicit authored creates through each existing module without changing authentication or lifecycle ownership semantics. Content edits may assign/reassign author; lifecycle and Task status-only mutations never write author. The Web reuses one shared paper-signature control, and the MCP surface keeps the same 16 tools while making author part of persistent write schemas and idempotency fingerprints.

**Tech Stack:** TypeScript, Node.js, Express, Drizzle ORM, PostgreSQL, React, Vite, Auth0, MCP SDK, `node:test` via `tsx`.

## Global Constraints

- Base implementation work on `codex/phase-6-web-ui-foundation` at `0c2e70de174527c650c4974b917072995968e6d6`; the design/plan branch is `codex/lg-author-foundation`.
- The only valid logical authors are exactly `L` and `G`.
- `author` means business content ownership, not login identity, OAuth subject, MCP/Web channel, source, audit actor, or provenance.
- Existing `core_memories`, `diary_entries`, and `tasks` rows must remain `author = NULL` after migration unless explicitly edited later.
- No code path may infer or bulk-backfill author from provenance or source metadata.
- New durable Memory, Diary, and Task creates must require explicit `L` or `G`.
- A content edit of a legacy-null record requires explicit author selection; lifecycle-only and Task status-only mutations preserve author exactly, including `NULL`.
- There is no default or remembered author in Web create flows.
- Existing authenticated user isolation and cross-user not-found behavior remain unchanged.
- MCP tool count stays exactly 16 and write-tool count stays exactly 5.
- No Todo table/API/MCP work, no Day Space real-data work, no Global Search author filtering, no PWA caching/service-worker changes, and no Safari-specific PaperDetailDialog P0 work.
- Use TDD for every behavioral task. Run the named focused test before and after implementation.
- Do not run destructive production down-migrations. The production DB change is additive and nullable.

---

## File Structure Map

**Create**
- `src/domains/content-author.ts` — shared `ContentAuthor` type, constants, and runtime predicate.
- `drizzle/0015_lg_author_foundation.sql` — additive enum/column migration after `0014_early_ozymandias.sql`.
- `tests/author-schema-migration.test.ts` — migration/schema contract coverage.
- `web/src/pages/PaperAuthorSignature.tsx` — shared paper author signature control.
- `tests/paper-author-signature.test.ts` — shared UI primitive contract.
- `docs/operations/lg-author-foundation-rollout.md` — production rollout/rollback checklist.

**Modify**
- `src/database/schema.ts`
- `src/domains/memory/memory-repository.ts`
- `src/domains/memory/memory-service.ts`
- `src/domains/diary/diary-repository.ts`
- `src/domains/diary/diary-service.ts`
- `src/domains/task/task-repository.ts`
- `src/domains/task/task-service.ts`
- `src/web-api/memory-router.ts`
- `src/web-api/diary-router.ts`
- `src/web-api/task-router.ts`
- `src/mcp/tools/write-memory/register.ts`
- `src/mcp/tools/write-diary/register.ts`
- `src/mcp/tools/create-task/register.ts`
- `src/mcp/tools/get-memory/register.ts`
- `src/mcp/tools/read-memory/register.ts`
- `src/mcp/tools/search-memory/register.ts`
- `src/mcp/tools/get-diary/register.ts`
- `src/mcp/tools/search-diary/register.ts`
- `src/mcp/tools/get-task/register.ts`
- `src/mcp/tools/list-tasks/register.ts`
- `web/src/pages/MemoryPage.tsx`
- `web/src/pages/MemoryPaperEditor.tsx`
- `web/src/pages/DiaryPage.tsx`
- `web/src/pages/DiaryPaperEditor.tsx`
- `web/src/pages/TaskPage.tsx`
- `web/src/pages/TaskPaperEditor.tsx`
- relevant existing tests named in each task.

The implementation follows the repository’s current structure; this package does not refactor large existing files merely for style.

---

### Task 1: Shared Author Vocabulary and Additive Database Migration

**Files:**
- Create: `src/domains/content-author.ts`
- Modify: `src/database/schema.ts`
- Generate/normalize: `drizzle/0015_lg_author_foundation.sql`
- Modify generated Drizzle metadata under `drizzle/meta/`
- Create: `tests/author-schema-migration.test.ts`
- Extend: `tests/memory-lifecycle-repository.integration.test.ts`
- Extend: `tests/diary-repository.integration.test.ts`
- Extend: `tests/task-lifecycle-repository.integration.test.ts`

**Interfaces:**
```ts
export const CONTENT_AUTHORS = ["L", "G"] as const;
export type ContentAuthor = (typeof CONTENT_AUTHORS)[number];
export function isContentAuthor(value: unknown): value is ContentAuthor;
```

Database enum: PostgreSQL `content_author` with values exactly `L`, `G`.

Read shape:
```ts
author: ContentAuthor | null;
```

- [ ] **Step 1: Write failing migration/schema tests**

Create `tests/author-schema-migration.test.ts` that reads `drizzle/0015_lg_author_foundation.sql` and asserts:
```ts
assert.match(migration, /content_author/);
assert.match(migration, /core_memories/);
assert.match(migration, /diary_entries/);
assert.match(migration, /tasks/);
assert.doesNotMatch(migration, /\bUPDATE\b/i);
assert.doesNotMatch(migration, /author[^;]*NOT NULL/i);
assert.doesNotMatch(migration, /todo_entries/i);
```

Extend repository integration tests with explicit rows for `author = NULL`, `L`, and `G`.

- [ ] **Step 2: Run RED**
```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/author-schema-migration.test.ts \
  tests/memory-lifecycle-repository.integration.test.ts \
  tests/diary-repository.integration.test.ts \
  tests/task-lifecycle-repository.integration.test.ts
```

- [ ] **Step 3: Create shared author vocabulary**
```ts
export const CONTENT_AUTHORS = ["L", "G"] as const;
export type ContentAuthor = (typeof CONTENT_AUTHORS)[number];

export function isContentAuthor(value: unknown): value is ContentAuthor {
  return value === "L" || value === "G";
}
```

No provenance conversion helper is allowed.

- [ ] **Step 4: Add Drizzle enum and nullable columns**

Use:
```ts
export const contentAuthorEnum = pgEnum("content_author", ["L", "G"]);
```

Add:
```ts
author: contentAuthorEnum("author"),
```
to `coreMemories`, `diaryEntries`, and `tasks`. No `.notNull()`. No author indexes.

- [ ] **Step 5: Generate migration**
```bash
pnpm exec drizzle-kit generate --name lg_author_foundation
```

Normalize the new migration filename to `drizzle/0015_lg_author_foundation.sql`. If Drizzle emits a nickname, rename that new SQL file and change only the newly appended `drizzle/meta/_journal.json` tag to `0015_lg_author_foundation`.

Reject unrelated schema churn, any business-row `UPDATE`, Todo table work, or author `NOT NULL`.

- [ ] **Step 6: Run GREEN + DB schema check**
```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/author-schema-migration.test.ts \
  tests/memory-lifecycle-repository.integration.test.ts \
  tests/diary-repository.integration.test.ts \
  tests/task-lifecycle-repository.integration.test.ts
pnpm db:check
git diff --check
```

Use only an isolated/disposable database during implementation.

- [ ] **Step 7: Commit**
```bash
git add src/domains/content-author.ts src/database/schema.ts drizzle \
  tests/author-schema-migration.test.ts \
  tests/memory-lifecycle-repository.integration.test.ts \
  tests/diary-repository.integration.test.ts \
  tests/task-lifecycle-repository.integration.test.ts
git commit -m "feat: add nullable L G author schema"
```

---

### Task 2: Memory Domain, Repository, and Web API

**Files:**
- Modify: `src/domains/memory/memory-repository.ts`
- Modify: `src/domains/memory/memory-service.ts`
- Modify: `src/web-api/memory-router.ts`
- Modify: `tests/memory-detail-service.test.ts`
- Modify: `tests/memory-repository-update-contract.test.ts`
- Modify: `tests/memory-lifecycle-repository.integration.test.ts`
- Modify: `tests/web-memory-api.test.ts`

**Required behavior:**
- every Memory read DTO includes `author: ContentAuthor | null`;
- create requires non-null `ContentAuthor`;
- content update accepts optional `author?: ContentAuthor`;
- if existing author is null and update omits author, fail `AUTHOR_REQUIRED` with no mutation;
- authored update with omitted author preserves existing author;
- explicit L↔G correction is allowed atomically;
- archive/restore accepts no author and preserves exact stored author, including null.

- [ ] **Step 1: Add RED tests** for create L/G, null read, null edit rejection/no mutation, null edit + author success, preserve-on-omit, L↔G switch, archive/restore preservation.
- [ ] **Step 2: Run RED**
```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/memory-detail-service.test.ts \
  tests/memory-repository-update-contract.test.ts \
  tests/memory-lifecycle-repository.integration.test.ts \
  tests/web-memory-api.test.ts
```
- [ ] **Step 3: Thread nullable author through repository reads and non-null author through create persistence.**
- [ ] **Step 4: Enforce service edit resolution**
```ts
const nextAuthor = input.author ?? existing.author;
if (nextAuthor === null) {
  throw existingDomainErrorHelper("AUTHOR_REQUIRED");
}
```
Use the repository’s existing domain-error mechanism rather than creating a parallel error framework.
- [ ] **Step 5: Extend Web API**
  - create body: required `author: "L" | "G"`;
  - content update: optional `author: "L" | "G"`;
  - list/detail/archived response: nullable author;
  - lifecycle request bodies: no author.
- [ ] **Step 6: Run GREEN**
```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/memory-detail-service.test.ts \
  tests/memory-repository-update-contract.test.ts \
  tests/memory-lifecycle-repository.integration.test.ts \
  tests/web-memory-api.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
git diff --check
```
- [ ] **Step 7: Commit**
```bash
git add src/domains/memory src/web-api/memory-router.ts \
  tests/memory-detail-service.test.ts \
  tests/memory-repository-update-contract.test.ts \
  tests/memory-lifecycle-repository.integration.test.ts \
  tests/web-memory-api.test.ts
git commit -m "feat: enforce memory authorship"
```

---

### Task 3: Diary Domain, Repository, and Web API

**Files:**
- Modify: `src/domains/diary/diary-repository.ts`
- Modify: `src/domains/diary/diary-service.ts`
- Modify: `src/web-api/diary-router.ts`
- Modify: `tests/diary-service.test.ts`
- Modify: `tests/diary-repository.integration.test.ts`
- Modify: `tests/diary-api.test.ts`
- Modify: `tests/diary-lifecycle.test.ts`

- [ ] **Step 1: Add the same semantic RED matrix as Memory**, using real Diary content fields.
- [ ] **Step 2: Run RED**
```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/diary-service.test.ts \
  tests/diary-repository.integration.test.ts \
  tests/diary-api.test.ts \
  tests/diary-lifecycle.test.ts
```
- [ ] **Step 3: Thread author through Diary reads/create/content edits.**
- [ ] **Step 4: Enforce `AUTHOR_REQUIRED` for legacy-null content edits and preserve exact author for archive/restore.**
- [ ] **Step 5: Extend Web API** with required create author, optional content-edit author, nullable read author, and no author filter.
- [ ] **Step 6: Run GREEN**
```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/diary-service.test.ts \
  tests/diary-repository.integration.test.ts \
  tests/diary-api.test.ts \
  tests/diary-lifecycle.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
git diff --check
```
- [ ] **Step 7: Commit**
```bash
git add src/domains/diary src/web-api/diary-router.ts \
  tests/diary-service.test.ts tests/diary-repository.integration.test.ts \
  tests/diary-api.test.ts tests/diary-lifecycle.test.ts
git commit -m "feat: enforce diary authorship"
```

---

### Task 4: Task Domain, Repository, Web API, and Status Preservation

**Files:**
- Modify: `src/domains/task/task-repository.ts`
- Modify: `src/domains/task/task-service.ts`
- Modify: `src/web-api/task-router.ts`
- Modify: `tests/task-service.test.ts`
- Modify: `tests/task-api.test.ts`
- Modify: `tests/task-lifecycle-repository.integration.test.ts`
- Modify: `tests/task-status-reopen.integration.test.ts`

- [ ] **Step 1: Add RED tests** for create/read/edit semantics plus every existing Task start/complete/cancel/reopen path preserving L/G/null after a repository re-read.
- [ ] **Step 2: Run RED**
```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/task-service.test.ts tests/task-api.test.ts \
  tests/task-lifecycle-repository.integration.test.ts \
  tests/task-status-reopen.integration.test.ts
```
- [ ] **Step 3: Thread author through Task reads/create/content edits.**
- [ ] **Step 4: Audit every Task status SQL `.set(...)` payload and keep `author` absent.**
- [ ] **Step 5: Extend Task Web API** with required create author, optional content-edit author, nullable read author; status endpoints do not accept/use author.
- [ ] **Step 6: Run GREEN**
```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/task-service.test.ts tests/task-api.test.ts \
  tests/task-lifecycle-repository.integration.test.ts \
  tests/task-status-reopen.integration.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
git diff --check
```
- [ ] **Step 7: Commit**
```bash
git add src/domains/task src/web-api/task-router.ts \
  tests/task-service.test.ts tests/task-api.test.ts \
  tests/task-lifecycle-repository.integration.test.ts \
  tests/task-status-reopen.integration.test.ts
git commit -m "feat: enforce task authorship"
```

---

### Task 5: MCP Persistent Writes and Idempotency

**Files:**
- Modify: `src/mcp/tools/write-memory/register.ts`
- Modify: `src/mcp/tools/write-diary/register.ts`
- Modify: `src/mcp/tools/create-task/register.ts`
- Modify: `tests/write-memory-tool.test.ts`
- Modify: `tests/write-diary-tool.test.ts`
- Modify: `tests/create-task-tool.test.ts`
- Modify: `tests/mcp-write-contract.test.ts`
- Modify: `tests/mcp-write-idempotency.test.ts`
- Modify: `tests/mcp-write-idempotency.integration.test.ts`
- Modify: `tests/memory-mcp-write.test.ts`

**Contract:**
```ts
author: z.enum(["L", "G"])
```
or exact equivalent in the existing schema style.

- [ ] **Step 1: RED schema tests**: missing/invalid author rejected; L/G accepted; client-supplied user identity still rejected.
- [ ] **Step 2: RED idempotency tests**:
  - same key + same normalized content + same author => replay;
  - same key + same content + different author => conflict/no second row;
  - legacy null-author idempotency/business row cannot satisfy a new L/G request.
- [ ] **Step 3: Run RED**
```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/write-memory-tool.test.ts tests/write-diary-tool.test.ts \
  tests/create-task-tool.test.ts tests/mcp-write-contract.test.ts \
  tests/mcp-write-idempotency.test.ts \
  tests/mcp-write-idempotency.integration.test.ts \
  tests/memory-mcp-write.test.ts
```
- [ ] **Step 4: Require author in all three tool schemas and pass it into domain create calls.**
- [ ] **Step 5: Add author to canonical normalized idempotency input**
```ts
{
  ...existingNormalizedFields,
  author,
}
```
Never derive it from MCP caller/tool/source.
- [ ] **Step 6: Run GREEN**
```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/write-memory-tool.test.ts tests/write-diary-tool.test.ts \
  tests/create-task-tool.test.ts tests/mcp-write-contract.test.ts \
  tests/mcp-write-idempotency.test.ts \
  tests/mcp-write-idempotency.integration.test.ts \
  tests/memory-mcp-write.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
git diff --check
```
- [ ] **Step 7: Commit**
```bash
git add src/mcp/tools/write-memory/register.ts \
  src/mcp/tools/write-diary/register.ts \
  src/mcp/tools/create-task/register.ts \
  tests/write-memory-tool.test.ts tests/write-diary-tool.test.ts \
  tests/create-task-tool.test.ts tests/mcp-write-contract.test.ts \
  tests/mcp-write-idempotency.test.ts \
  tests/mcp-write-idempotency.integration.test.ts \
  tests/memory-mcp-write.test.ts
git commit -m "feat: require author on MCP content writes"
```

---

### Task 6: MCP Read Outputs Expose Nullable Author

**Files:**
- Modify seven tools:
  - `src/mcp/tools/get-memory/register.ts`
  - `src/mcp/tools/read-memory/register.ts`
  - `src/mcp/tools/search-memory/register.ts`
  - `src/mcp/tools/get-diary/register.ts`
  - `src/mcp/tools/search-diary/register.ts`
  - `src/mcp/tools/get-task/register.ts`
  - `src/mcp/tools/list-tasks/register.ts`
- Modify: `tests/memory-read-tools.test.ts`
- Modify: `tests/diary-read-tools.test.ts`
- Modify: `tests/task-read-tools.test.ts`
- Modify: `tests/mcp-read-contract.test.ts`

- [ ] **Step 1: RED tests** for L/G/null exact output and registry counts `16` total / `5` writes.
- [ ] **Step 2: Run RED**
```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/memory-read-tools.test.ts tests/diary-read-tools.test.ts \
  tests/task-read-tools.test.ts tests/mcp-read-contract.test.ts
```
- [ ] **Step 3: Add exact serializer field**
```ts
author: record.author,
```
Do not omit null or convert it to another string. Do not modify Global Search or Toy.
- [ ] **Step 4: Run GREEN + typecheck + diff check.**
- [ ] **Step 5: Commit only the seven read tools and named tests**
```bash
git add \
  src/mcp/tools/get-memory/register.ts \
  src/mcp/tools/read-memory/register.ts \
  src/mcp/tools/search-memory/register.ts \
  src/mcp/tools/get-diary/register.ts \
  src/mcp/tools/search-diary/register.ts \
  src/mcp/tools/get-task/register.ts \
  src/mcp/tools/list-tasks/register.ts \
  tests/memory-read-tools.test.ts tests/diary-read-tools.test.ts \
  tests/task-read-tools.test.ts tests/mcp-read-contract.test.ts
git commit -m "feat: expose author in MCP content reads"
```

---

### Task 7: Shared Paper Author Signature Primitive

**Files:**
- Create: `web/src/pages/PaperAuthorSignature.tsx`
- Modify: `web/src/styles.css`
- Create: `tests/paper-author-signature.test.ts`

**Interface:**
```ts
export type PaperAuthorValue = "L" | "G" | null;

export interface PaperAuthorSignatureProps {
  value: PaperAuthorValue;
  editable: boolean;
  disabled?: boolean;
  onChange?: (author: "L" | "G") => void;
  error?: string | null;
}
```

- [ ] **Step 1: RED tests**: L/G/— display, exactly two editable choices, no local/session storage/default-author/provenance logic.
- [ ] **Step 2: Run RED**
```bash
pnpm exec tsx --test --test-concurrency=1 tests/paper-author-signature.test.ts
```
- [ ] **Step 3: Implement minimal shared component.**
  - read-only renders L/G/—;
  - editable button opens exactly L/G;
  - selecting calls `onChange` and closes;
  - disabled blocks mutation;
  - error uses existing inline paper error language.
- [ ] **Step 4: Add narrowly scoped shared CSS** for lower-right placement and faint unknown `—`; do not restyle dialogs/papers.
- [ ] **Step 5: GREEN + Web build**
```bash
pnpm exec tsx --test --test-concurrency=1 tests/paper-author-signature.test.ts
cd web && npm run build
cd ..
git diff --check
```
- [ ] **Step 6: Commit**
```bash
git add web/src/pages/PaperAuthorSignature.tsx web/src/styles.css \
  tests/paper-author-signature.test.ts
git commit -m "feat: add shared paper author signature"
```

---

### Task 8: Memory Web Paper Author UX

**Files:**
- Modify: `web/src/pages/MemoryPage.tsx`
- Modify: `web/src/pages/MemoryPaperEditor.tsx`
- Modify: `tests/memory-page.test.ts`
- Modify: `tests/memory-paper-editor.test.ts`
- Modify: `tests/paper-detail-memory-slots.test.ts`
- Modify: `tests/quick-create.test.ts`
- Modify: `tests/web-unsaved-changes.test.ts`

- [ ] **Step 1: RED UI matrix**:
  - view L/G/—;
  - archived view read-only;
  - create always starts `author: null`;
  - Home quick-create does not preselect;
  - create blocked until L/G;
  - authored edit preselects current;
  - legacy-null edit blocked until selection;
  - author change marks dirty;
  - cancel resets author with form.
- [ ] **Step 2: Run RED**
```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/memory-page.test.ts tests/memory-paper-editor.test.ts \
  tests/paper-detail-memory-slots.test.ts tests/quick-create.test.ts \
  tests/web-unsaved-changes.test.ts
```
- [ ] **Step 3: Add client state**
```ts
author: "L" | "G" | null
```
Create initializes `null`; edit initializes from `record.author`.
- [ ] **Step 4: Render `PaperAuthorSignature`** in view/create/edit lower-right paper slot.
- [ ] **Step 5: Before content submit**
```ts
if (draft.author === null) {
  setInlineError("请选择作者");
  return;
}
```
Then send `author: draft.author`. Archive/restore remain author-independent.
- [ ] **Step 6: Run GREEN + Web build + diff check.**
- [ ] **Step 7: Commit**
```bash
git add web/src/pages/MemoryPage.tsx web/src/pages/MemoryPaperEditor.tsx \
  tests/memory-page.test.ts tests/memory-paper-editor.test.ts \
  tests/paper-detail-memory-slots.test.ts tests/quick-create.test.ts \
  tests/web-unsaved-changes.test.ts
git commit -m "feat: add memory author signature flow"
```

---

### Task 9: Diary Web Paper Author UX

**Files:**
- Modify: `web/src/pages/DiaryPage.tsx`
- Modify: `web/src/pages/DiaryPaperEditor.tsx`
- Modify: `tests/diary-page.test.ts`
- Modify: `tests/diary-paper-editor.test.ts`
- Modify: `tests/quick-create.test.ts`
- Modify: `tests/web-unsaved-changes.test.ts`

- [ ] **Step 1: RED UI matrix** identical in semantics to Memory using Diary fields.
- [ ] **Step 2: Run RED**
```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/diary-page.test.ts tests/diary-paper-editor.test.ts \
  tests/quick-create.test.ts tests/web-unsaved-changes.test.ts
```
- [ ] **Step 3: Integrate `PaperAuthorSignature` and `author: "L" | "G" | null` state.**
- [ ] **Step 4: Create starts null; edit copies record author; content save requires/sends non-null author; archive/restore untouched.**
- [ ] **Step 5: Run GREEN + Web build + diff check.**
- [ ] **Step 6: Commit**
```bash
git add web/src/pages/DiaryPage.tsx web/src/pages/DiaryPaperEditor.tsx \
  tests/diary-page.test.ts tests/diary-paper-editor.test.ts \
  tests/quick-create.test.ts tests/web-unsaved-changes.test.ts
git commit -m "feat: add diary author signature flow"
```

---

### Task 10: Task Web Paper Author UX and Status Separation

**Files:**
- Modify: `web/src/pages/TaskPage.tsx`
- Modify: `web/src/pages/TaskPaperEditor.tsx`
- Modify: `tests/task-detail-view.test.ts`
- Modify: `tests/task-web-actions.test.ts`
- Modify: `tests/task-submission-gate.test.ts`
- Modify: `tests/quick-create.test.ts`
- Modify: `tests/web-unsaved-changes.test.ts`

- [ ] **Step 1: RED UI tests** for detail L/G/—, create null, quick-create null, legacy-null edit rule, authored preselection/switch, dirty/cancel, and status request payloads containing no author.
- [ ] **Step 2: Run RED**
```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/task-detail-view.test.ts tests/task-web-actions.test.ts \
  tests/task-submission-gate.test.ts tests/quick-create.test.ts \
  tests/web-unsaved-changes.test.ts
```
- [ ] **Step 3: Integrate shared author signature into Task content create/edit only.**
- [ ] **Step 4: Audit start/complete/cancel/reopen payload builders; do not serialize author and do not require author to run status actions on legacy-null tasks.**
- [ ] **Step 5: Run GREEN + Web build + diff check.**
- [ ] **Step 6: Commit**
```bash
git add web/src/pages/TaskPage.tsx web/src/pages/TaskPaperEditor.tsx \
  tests/task-detail-view.test.ts tests/task-web-actions.test.ts \
  tests/task-submission-gate.test.ts tests/quick-create.test.ts \
  tests/web-unsaved-changes.test.ts
git commit -m "feat: add task author signature flow"
```

---

### Task 11: Full Regression, Database, Scope, and Sensitive-Information Gates

No new product feature files in this task.

- [ ] **Step 1: Confirm automated coverage** for:
  - L/G only;
  - legacy null preservation;
  - Web + MCP create author requirement;
  - null content-edit rule;
  - lifecycle/status null preservation;
  - seven MCP read tools include nullable author;
  - tool counts 16/5;
  - Global Search unchanged;
  - no Todo table;
  - no PWA/runtime changes;
  - no provenance-to-author mapping.

- [ ] **Step 2: Full deterministic suite**
```bash
pnpm exec tsx --test --test-concurrency=1 tests/**/*.test.ts
```

- [ ] **Step 3: Root + Web gates**
```bash
pnpm exec tsc -p tsconfig.json --noEmit
pnpm exec tsc -p tsconfig.json
cd web
npm run build
cd ..
```

- [ ] **Step 4: Disposable PostgreSQL migration verification**
```bash
pnpm db:check
```
Apply the complete migration chain through `0015_lg_author_foundation.sql` to a disposable DB. Record before/after row counts and confirm legacy rows remain `author IS NULL`; confirm Package A introduced no `todo_entries`.

- [ ] **Step 5: Scope/sensitive scan**
```bash
git diff --check
git status --short
git diff --name-only 0c2e70de174527c650c4974b917072995968e6d6...HEAD
```
Reject unrelated Todo foundation, Day Space real-data, Global Search author filters, PWA service-worker/runtime, Safari P0, and secret/token changes.

- [ ] **Step 6: Commit only if a final test correction was actually required**
```bash
git add tests
git commit -m "test: lock L G author contracts"
```
Do not create an empty commit.

---

### Task 12: Production Rollout Runbook

**Files:**
- Create: `docs/operations/lg-author-foundation-rollout.md`

- [ ] **Step 1: Write this exact rollout order**
```text
1. Fresh-verify intended app SHA and migration head.
2. Confirm current encrypted external PostgreSQL backup and restore readiness.
3. Record pre-migration counts for core_memories, diary_entries, tasks.
4. Apply only the additive nullable-author migration.
5. Recheck counts and prove existing rows remain null unless explicitly authored after rollout began.
6. Deploy application code.
7. Smoke-test Memory/Diary/Task old-null reads.
8. Smoke-test Web creates/edits with L and G.
9. Smoke-test archive/restore and Task status actions preserve author.
10. Smoke-test write_memory/write_diary/create_task with explicit author and idempotency behavior.
11. Perform iPhone production paper-signature acceptance.
12. Only after production acceptance, sync accepted main into isolated PWA 7.6A and rerun full gates/standalone smoke.
```

Rollback:
```text
Application rollback is allowed.
Leave the additive nullable author columns and content_author enum in place.
Do not run a destructive production down-migration.
```

- [ ] **Step 2: Self-review against the design spec.**
- [ ] **Step 3: Commit**
```bash
git add docs/operations/lg-author-foundation-rollout.md
git commit -m "docs: add L G author rollout runbook"
```

---

## Final Handoff Report Required From Codex

```text
BASE_SHA=0c2e70de174527c650c4974b917072995968e6d6
MIGRATION_HEAD=0015_lg_author_foundation.sql
FULL_TEST_SUITE=PASS
ROOT_TYPECHECK=PASS
ROOT_BUILD=PASS
WEB_BUILD=PASS
DB_CHECK=PASS
DISPOSABLE_POSTGRES_MIGRATION=PASS
LEGACY_NULL_PRESERVATION=PASS
MCP_TOOL_COUNT=16
MCP_WRITE_TOOL_COUNT=5
TODO_SCOPE_CHANGED=NO
PWA_RUNTIME_CHANGED=NO
GLOBAL_SEARCH_AUTHOR_FILTER_CHANGED=NO
SECRETS_FOUND=NO
GIT_DIFF_CHECK=PASS
```

Codex must also report:
- final commit SHA;
- `git diff --name-only BASE_SHA...HEAD`;
- migration SQL summary;
- exact focused/full test commands run;
- skipped tests with reason;
- confirmation that no production DB/deployment was touched.

Do not start Package B until Package A passes production migration/deployment verification and iPhone acceptance.
