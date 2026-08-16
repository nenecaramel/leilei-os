# Universe Importer UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-time, explicit standalone-Universe JSON import flow to the already accepted `/universe` uninitialized state, preserving weighted galaxy memberships and initializing the server atomically with `expected_version=0`.

**Architecture:** Keep the existing `LeileiOSAdapter` and server canonical contract unchanged. Add a browser-safe importer boundary that converts standalone top-level `edges` to LeileiOS canonical `relations`, validates the converted snapshot before any write, and verifies a fresh GET after the one allowed PUT. Add an explicit service initialization method that performs exactly one PUT with version `0` and exactly one GET to determine the resulting server state; never silently retries writes.

**Tech Stack:** React, TypeScript, existing WebApiClient/LeileiOSAdapter, Node test runner, JSDOM for isolated importer UI interaction tests.

## Global Constraints

- Base production SHA: `380e1457340d5e9416b7c9bc32bba30f893f9b7c`.
- Implement only Phase 8.3G explicit old-data import. Do not implement Global Search, MCP, standalone uploads, cross-origin IndexedDB reads, automatic sync, or unrelated refactors.
- Standalone source contract is schemaVersion `2` with top-level `edges`; importer boundary converts only `edges` → canonical `relations`.
- Canonical Node and Revision `galaxies` remain `{ id: string, weight: number }[]`; preserve exact finite weights. Do not normalize to string IDs, clamp weights, or invent missing weights.
- Preserve existing Node / Relation / Revision IDs, timestamps, relation endpoints, `importance`, and `migration` metadata.
- Do not import standalone `backups` or legacy localStorage arrays. A top-level `backups` field is invalid for this flow.
- Import is available only after authenticated GET resolves `UNIVERSE_NOT_INITIALIZED`; never show importer in ready state and never merge/overwrite an existing Universe.
- Commit uses the existing atomic whole-snapshot `PUT /api/v1/universe` with `expected_version=0`.
- After the single PUT attempt, determine the result with a fresh GET. If write status is uncertain, do not blindly retry the PUT.
- Ready-state spatial canvas, node/relation editors, filters, export, APIs, migrations, and persistence schema are not redesigned here.
- Accepted loading state stays visually unchanged: pure white, existing `Universe` title, centered gray `正在读取 Universe…`, no visible frame/dots/spinner/animation.
- Uninitialized UI is extended minimally: pure white, existing title, `Universe 还没有内容`, then plain text-style import actions/preview. No decorative card, frame, shadow, toolbar, cosmic animation, or unrelated controls.
- No new runtime dependencies.

---

### Task 1: Add a browser-safe standalone import boundary

**Files:**
- Create: `web/src/pages/universe/universe-import.ts`
- Create: `tests/universe-import-validation.test.ts`
- Read: `src/domains/universe/universe-validation.ts`
- Read: `web/src/pages/universe/universe-types.ts`

**Interfaces:**
- Produces `UniverseImportValidationError` with code `INVALID_UNIVERSE_IMPORT`.
- Produces `parseStandaloneUniverseJson(text: string): UniverseImportPreview`.
- Produces `verifyUniverseImportReadback(expected: UniverseSnapshot, actual: UniverseSnapshot): void`.
- `UniverseImportPreview` contains `{ snapshot, counts }`, where counts are `{ galaxies, nodes, relations, revisions }`.

- [ ] **Step 1: Write failing validation tests**

Create fixtures inside `tests/universe-import-validation.test.ts` using a valid standalone export:

```ts
const standalone = {
  schemaVersion: 2,
  meta: {
    name: "Universe",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    exportedAt: "2026-08-15T00:00:00.000Z",
  },
  galaxies: [
    { id: "g-a", title: "A", description: "", color: "#fff", order: 0 },
    { id: "g-b", title: "B", description: "", color: "#ddd", order: 1 },
  ],
  nodes: [{
    id: "n-a",
    title: "Node",
    summary: "summary",
    content: "content",
    type: "concept",
    tags: ["tag"],
    galaxies: [{ id: "g-a", weight: 1 }, { id: "g-b", weight: 0.2718281828459 }],
    position: { x: 12.5, y: 44.25 },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    importance: "anchor",
    migration: { source: "mind-universe", migratedAt: "2026-08-02T00:00:00.000Z" },
  }],
  edges: [{
    id: "e-a",
    source: "n-a",
    target: "n-a",
    relationType: "related_to",
    strength: 0.625,
    createdAt: "2026-08-02T00:00:00.000Z",
  }],
  revisions: [{
    id: "r-a",
    nodeId: "n-a",
    createdAt: "2026-08-02T01:00:00.000Z",
    reason: "test",
    snapshot: {
      title: "Old",
      summary: "summary",
      content: "content",
      type: "concept",
      tags: ["tag"],
      galaxies: [{ id: "g-a", weight: 0.123456789 }],
    },
  }],
};
```

Tests must assert:

```ts
const preview = parseStandaloneUniverseJson(JSON.stringify(standalone));
assert.equal(preview.snapshot.schemaVersion, 2);
assert.ok(!("edges" in preview.snapshot));
assert.deepEqual(preview.snapshot.relations, standalone.edges);
assert.deepEqual(preview.snapshot.nodes[0]?.galaxies, standalone.nodes[0]?.galaxies);
assert.deepEqual(preview.snapshot.revisions[0]?.snapshot.galaxies, standalone.revisions[0]?.snapshot.galaxies);
assert.deepEqual(preview.counts, { galaxies: 2, nodes: 1, relations: 1, revisions: 1 });
```

Also assert rejection for: invalid JSON; schemaVersion other than `2`; missing/non-array `edges`; top-level `backups`; legacy node/revision `galaxies: string[]`; non-finite weights; duplicate membership IDs; duplicate galaxy/node/edge/revision IDs; unknown node galaxy references; unknown relation endpoints; invalid relation type; duplicate directional relation key; malformed timestamps; malformed migration metadata.

Add readback tests proving top-level array order does not matter but all canonical content does:

```ts
const expected = parseStandaloneUniverseJson(JSON.stringify(standalone)).snapshot;
const reordered = {
  ...expected,
  galaxies: [...expected.galaxies].reverse(),
  nodes: [...expected.nodes].reverse(),
  relations: [...expected.relations].reverse(),
  revisions: [...expected.revisions].reverse(),
};
assert.doesNotThrow(() => verifyUniverseImportReadback(expected, reordered));
assert.throws(() => verifyUniverseImportReadback(expected, {
  ...reordered,
  nodes: reordered.nodes.map((node) => node.id === "n-a"
    ? { ...node, galaxies: [{ id: "g-a", weight: 0.5 }, { id: "g-b", weight: 0.2718281828459 }] }
    : node),
}));
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm exec tsx --test tests/universe-import-validation.test.ts
```

Expected: FAIL because the importer module does not exist.

- [ ] **Step 3: Implement `universe-import.ts`**

Implement browser-only helpers; do not import server code or Node-only modules.

Use these exact public types:

```ts
import type {
  UniverseGalaxy,
  UniverseGalaxyMembership,
  UniverseNode,
  UniverseRelation,
  UniverseRelationType,
  UniverseRevision,
  UniverseSnapshot,
} from "./universe-types";

export class UniverseImportValidationError extends Error {
  readonly code = "INVALID_UNIVERSE_IMPORT" as const;
}

export type UniverseImportPreview = {
  snapshot: UniverseSnapshot;
  counts: {
    galaxies: number;
    nodes: number;
    relations: number;
    revisions: number;
  };
};

export function parseStandaloneUniverseJson(text: string): UniverseImportPreview;
export function verifyUniverseImportReadback(expected: UniverseSnapshot, actual: UniverseSnapshot): void;
```

Mirror the current server canonical rules from `src/domains/universe/universe-validation.ts`: object/array checks, schemaVersion 2, finite numbers, ISO timestamps, nonblank IDs, weighted membership objects, unique IDs, known galaxy references, known relation endpoints, allowed relation types (`related_to`, `supports`, `contradicts`, `extends`, `part_of`, `raises`), and duplicate directional relation rejection. Preserve optional `importance` as a string and `migration` only for sources `mind-universe-static` / `mind-universe`.

The raw standalone root must be reconstructed explicitly so client-only fields do not leak into the canonical PUT:

```ts
const canonicalCandidate = {
  schemaVersion: raw.schemaVersion,
  meta: {
    name: meta.name,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  },
  galaxies: raw.galaxies,
  nodes: raw.nodes,
  relations: raw.edges,
  revisions: raw.revisions,
};
```

If `backups` exists at the raw top level, reject. `meta.exportedAt` may exist in the standalone export but is intentionally not copied into canonical meta.

For readback comparison, normalize only top-level entity ordering by ID. Do not normalize or reorder nested `tags`, node `galaxies`, or revision snapshot `galaxies`; exact IDs, weights, timestamps, positions, relation endpoints/strength/type, importance and migration metadata must match.

- [ ] **Step 4: Re-run focused validation test**

Run:

```bash
pnpm exec tsx --test tests/universe-import-validation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/universe/universe-import.ts tests/universe-import-validation.test.ts
git commit -m "feat: validate standalone Universe imports"
```

---

### Task 2: Add an explicit one-write initialization service path

**Files:**
- Modify: `web/src/pages/universe/universe-service.ts`
- Create: `tests/universe-import-service.test.ts`
- Read: `web/src/pages/universe/universe-adapter.ts`

**Interfaces:**
- Produces `UniverseInitializationError` with codes `UNIVERSE_IMPORT_NOT_WRITTEN` and `UNIVERSE_IMPORT_UNCERTAIN`.
- Produces `initializeUniverse(snapshot: UniverseSnapshot): Promise<{ state: UniverseReadResult; writeFailed: boolean }>` on `LeileiOSUniverseService`.
- Uses existing `adapter.saveUniverse(snapshot, 0)` and `adapter.loadUniverse()` only; no new server/API route.

- [ ] **Step 1: Write failing service tests**

Use a fake adapter that records calls. Cover these exact cases:

1. Normal success: `saveUniverse(snapshot, 0)` called once, then `loadUniverse()` called once; returned state is the GET state.
2. PUT throws but GET returns a ready Universe: no second PUT; return `{ state: fresh, writeFailed: true }` so the caller can compare the fresh canonical state.
3. PUT throws and GET returns `UNIVERSE_NOT_INITIALIZED`: reject with `UniverseInitializationError.code === "UNIVERSE_IMPORT_NOT_WRITTEN"`; still exactly one PUT and one GET.
4. PUT succeeds or fails, but follow-up GET fails with an indeterminate network/server error: reject with `UNIVERSE_IMPORT_UNCERTAIN`; never issue a second PUT.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm exec tsx --test tests/universe-import-service.test.ts
```

Expected: FAIL because `initializeUniverse` and its error type do not exist.

- [ ] **Step 3: Implement the minimal service method**

Add:

```ts
export class UniverseInitializationError extends Error {
  constructor(
    readonly code: "UNIVERSE_IMPORT_NOT_WRITTEN" | "UNIVERSE_IMPORT_UNCERTAIN",
  ) {
    super(code);
    this.name = "UniverseInitializationError";
  }
}
```

Inside `createLeileiOSUniverseService`, add:

```ts
async initializeUniverse(snapshot: UniverseSnapshot) {
  let writeFailed = false;
  try {
    await adapter.saveUniverse(snapshot, 0);
  } catch {
    writeFailed = true;
  }

  try {
    const fresh = set(await adapter.loadUniverse());
    return { state: fresh, writeFailed };
  } catch (readError) {
    if (writeFailed && isUniverseNotInitialized(readError)) {
      throw new UniverseInitializationError("UNIVERSE_IMPORT_NOT_WRITTEN");
    }
    throw new UniverseInitializationError("UNIVERSE_IMPORT_UNCERTAIN");
  }
},
```

Do not call existing `saveUniverse(snapshot)` because it requires an already-loaded version. Do not modify the adapter contract or server route.

- [ ] **Step 4: Run service tests**

```bash
pnpm exec tsx --test tests/universe-import-service.test.ts tests/universe-web-adapter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/universe/universe-service.ts tests/universe-import-service.test.ts
git commit -m "feat: initialize Universe from version zero"
```

---

### Task 3: Build the isolated minimal importer interaction

**Files:**
- Create: `web/src/pages/universe/UniverseImportFlow.tsx`
- Create: `tests/universe-import-ui.test.ts`
- Modify later in Task 4: `web/src/pages/universe-state-polish.css`

**Interfaces:**
- Consumes `UniverseService` from `universe-service.ts`.
- Consumes `parseStandaloneUniverseJson` and `verifyUniverseImportReadback`.
- Produces `UniverseImportFlow({ service, onReady, onRecheck })`.
- `onReady(state, notice)` transitions the parent page into the authoritative ready state.
- `onRecheck()` performs only the page's existing GET reload; it never retries the import PUT.

- [ ] **Step 1: Write failing JSDOM interaction tests**

Import `UniverseImportFlow` directly so this test does not import `UniversePage.tsx` or its CSS.

Cover:

1. Initial render contains `Universe 还没有内容` and one action `选择旧 Universe JSON`; it does not contain `确认迁移` before a file is selected.
2. Valid file selection shows file name and exact counts, then `确认迁移`.
3. Invalid JSON shows `文件无法用于迁移` and never enables confirm.
4. Confirm calls `service.initializeUniverse(snapshot)` once.
5. Fresh state matching `verifyUniverseImportReadback` calls `onReady(fresh, "Universe 迁移完成。")`.
6. Fresh state differs from selected snapshot: do not write again; call `onReady(fresh, "Universe 已存在或状态已变化，未覆盖现有内容。")`.
7. `UNIVERSE_IMPORT_NOT_WRITTEN` leaves the importer available and shows `迁移未写入，可以重新确认。`.
8. `UNIVERSE_IMPORT_UNCERTAIN` disables the confirm path and shows `迁移状态暂时无法确认，请先重新读取；不要再次提交。` plus a GET-only `重新读取` action wired to `onRecheck`.

Use a real `File` object with MIME `application/json`. Do not assert on hidden implementation state; assert user-visible text, button disabled state, and service/callback call counts.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm exec tsx --test tests/universe-import-ui.test.ts
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement `UniverseImportFlow.tsx`**

Use a hidden `<input type="file" accept="application/json,.json">` triggered by a real text-style button. Read exactly one selected file with `await file.text()`.

Render a centered plain stack only; no wrapper card. States:

- initial: `Universe 还没有内容` + `选择旧 Universe JSON`.
- valid preview: same empty copy + filename + `N 星系 · N 星球 · N 连接 · N 历史版本` + `确认迁移` + `重新选择`.
- invalid: same empty copy + `文件无法用于迁移` + `重新选择`.
- committing: disable file/confirm actions and show `正在迁移…`.
- not-written: show `迁移未写入，可以重新确认。` and allow the same explicit confirm again.
- uncertain: disable confirm and show `迁移状态暂时无法确认，请先重新读取；不要再次提交。` + `重新读取` only.

On confirm:

```ts
const outcome = await service.initializeUniverse(preview.snapshot);
try {
  verifyUniverseImportReadback(preview.snapshot, outcome.state.snapshot);
  onReady(outcome.state, "Universe 迁移完成。");
} catch {
  onReady(outcome.state, "Universe 已存在或状态已变化，未覆盖现有内容。");
}
```

Catch `UniverseInitializationError` by code. Do not display raw server errors, file contents, IDs, or stack traces.

- [ ] **Step 4: Run isolated UI tests**

```bash
pnpm exec tsx --test tests/universe-import-ui.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/universe/UniverseImportFlow.tsx tests/universe-import-ui.test.ts
git commit -m "feat: add Universe import confirmation flow"
```

---

### Task 4: Integrate importer only into the accepted uninitialized state

**Files:**
- Modify: `web/src/pages/UniversePage.tsx`
- Modify: `web/src/pages/universe-state-polish.css`
- Modify: `tests/universe-minimal-state-ui.test.ts`
- Create: `tests/universe-import-integration-ui.test.ts`

**Interfaces:**
- Consumes `UniverseImportFlow`.
- Existing loading and ready-state behavior remains unchanged.
- Uninitialized state passes the current `service` plus callbacks into the importer.

- [ ] **Step 1: Extend regression tests before implementation**

Update `tests/universe-minimal-state-ui.test.ts` so it still proves:

- exact loading copy `正在读取 Universe…`;
- visible loading dots remain suppressed by the accepted CSS override;
- loading frame remains visually removed/centered;
- no importer symbol/action appears in `UniverseLoadingState`.

Create `tests/universe-import-integration-ui.test.ts` as source-level integration assertions proving:

```ts
assert.match(pageSource, /status === "not-initialized"[\s\S]*UniverseImportFlow/);
assert.doesNotMatch(readyStateSource, /UniverseImportFlow/);
```

Also assert ready-state header still exposes only existing `导出` and `新增`, not import.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm exec tsx --test tests/universe-minimal-state-ui.test.ts tests/universe-import-integration-ui.test.ts
```

Expected: integration test FAIL because importer is not wired into the page.

- [ ] **Step 3: Wire the uninitialized state**

Replace only the current `not-initialized` branch:

```tsx
if (state.status === "not-initialized") {
  return (
    <UniverseFrame>
      <UniverseImportFlow
        service={service}
        onReady={(result, message) => {
          setNotice(message);
          setState({ status: "ready", ...result });
        }}
        onRecheck={() => setReload((value) => value + 1)}
      />
    </UniverseFrame>
  );
}
```

Keep the loading branch untouched. Remove/retire the old static `UniverseEmptyState` only if it is no longer referenced.

- [ ] **Step 4: Add minimal importer CSS without changing the accepted page language**

In `universe-state-polish.css`, add only state-local classes such as:

```css
.universe-import-flow {
  display: grid;
  justify-items: center;
  gap: 10px;
  max-width: min(420px, calc(100vw - 48px));
  text-align: center;
}

.universe-import-copy,
.universe-import-preview,
.universe-import-error {
  margin: 0;
  color: #8d8d8d;
  font-size: 13px;
  font-weight: 400;
  line-height: 1.55;
}

.universe-import-action {
  all: unset;
  color: #555555;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.55;
  cursor: pointer;
}

.universe-import-action:hover,
.universe-import-action:active {
  color: #171717;
}

.universe-import-action:focus-visible {
  outline: 1px solid #bdbdbd;
  outline-offset: 3px;
}

.universe-import-action:disabled {
  color: #aaaaaa;
  cursor: default;
}
```

Do not add a border, background panel, shadow, icon, spinner, progress animation, or extra toolbar. Do not change `.universe-node`, ready canvas, editor, filter or header action CSS.

- [ ] **Step 5: Run focused UI tests**

```bash
pnpm exec tsx --test \
  tests/universe-minimal-state-ui.test.ts \
  tests/universe-import-validation.test.ts \
  tests/universe-import-service.test.ts \
  tests/universe-import-ui.test.ts \
  tests/universe-import-integration-ui.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add \
  web/src/pages/UniversePage.tsx \
  web/src/pages/universe-state-polish.css \
  tests/universe-minimal-state-ui.test.ts \
  tests/universe-import-integration-ui.test.ts
git commit -m "feat: expose Universe importer when empty"
```

---

### Task 5: Verify importer contract through the existing adapter/API boundary

**Files:**
- Modify: `tests/universe-web-adapter.test.ts`
- Modify only if evidence requires it: `tests/universe-api.test.ts`
- No production API changes expected.

**Interfaces:**
- Existing adapter `saveUniverse(snapshot, expectedVersion)` must serialize `expected_version: 0` without alteration.
- Existing server PUT must remain the single canonical write boundary.

- [ ] **Step 1: Add the focused adapter assertion**

Add a test using a weighted canonical snapshot and call:

```ts
await adapter.saveUniverse(snapshot, 0);
```

Assert the captured request is `PUT /universe` with body exactly:

```ts
{ snapshot, expected_version: 0 }
```

and exact weighted memberships remain present in the JSON body.

If existing API tests already prove `expected_version` and whole-snapshot forwarding, do not duplicate them. Modify `tests/universe-api.test.ts` only if the exact version-zero path is otherwise unproven.

- [ ] **Step 2: Run adapter/API tests**

```bash
pnpm exec tsx --test tests/universe-web-adapter.test.ts tests/universe-api.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/universe-web-adapter.test.ts tests/universe-api.test.ts
git commit -m "test: lock Universe version-zero import transport"
```

---

### Task 6: Full verification and Draft PR

**Files:**
- No feature expansion.
- Update PR description with actual results only.

- [ ] **Step 1: Run focused Universe suite serially**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/universe-*.test.ts
```

Expected: all importer/Universe tests pass except any already-documented baseline skip; no new failure.

- [ ] **Step 2: Run deterministic full suite**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/**/*.test.ts
```

The known pre-existing `tests/universe-web-page.test.ts` CSS-loader failure may still occur under the same Node/tsx environment. If it occurs, compare against production base `380e1457340d5e9416b7c9bc32bba30f893f9b7c`; do not fix that unrelated loader in this PR.

- [ ] **Step 3: Run build/type gates**

```bash
pnpm typecheck
pnpm build
pnpm --dir web typecheck
pnpm --dir web build
pnpm db:check
git diff --check
git status --short
```

Expected: all pass; worktree clean after commits.

- [ ] **Step 4: Self-review scope**

Confirm the final diff contains only importer validation/service/UI/test/docs changes. It must not contain DB migrations, schema changes, Global Search, MCP, Auth0, standalone repository changes, unrelated UI redesign, or new dependencies.

- [ ] **Step 5: Push and create Draft PR**

Push `codex/phase-8-3-universe-importer-ui` and create a Draft PR to `codex/phase-6-web-ui-foundation`.

PR body must state:

- base SHA `380e1457340d5e9416b7c9bc32bba30f893f9b7c`;
- source `edges` → canonical `relations` is importer-only;
- weighted memberships preserved exactly;
- importer shown only for `UNIVERSE_NOT_INITIALIZED`;
- one PUT with `expected_version=0`, followed by fresh GET;
- no blind write retry on uncertain status;
- no server migration/schema change;
- loading UI unchanged and ready canvas not redesigned;
- exact test/build results and any pre-existing CSS-loader comparison.

Do not merge or deploy. Production acceptance requires later visual review plus a real standalone export import/readback on the production user.
