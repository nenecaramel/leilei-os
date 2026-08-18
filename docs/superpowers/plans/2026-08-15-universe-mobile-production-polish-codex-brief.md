# Codex Brief — Universe Mobile Production Polish

You are implementing the second-pass production-phone polish for LeileiOS Universe.

## Branch lock

Work only on:

`codex/phase-8-3-universe-mobile-polish`

This branch was created from production/UI base:

`codex/phase-6-web-ui-foundation` @ `800b5fcb84c1929d9626f192cfce8564847c9dfa`

Before editing, verify the worktree is on the exact implementation branch and clean except for the already-committed planning docs.

## Required reading before code

Read completely:

1. `docs/superpowers/specs/2026-08-15-universe-mobile-production-polish-design.md`
2. `docs/superpowers/plans/2026-08-15-universe-mobile-production-polish.md`
3. `docs/superpowers/specs/2026-08-15-universe-mobile-ready-state-redesign-design.md`
4. `docs/superpowers/plans/2026-08-15-universe-mobile-ready-state-redesign.md`
5. current `web/src/pages/MemoryPage.tsx`, `DiaryPage.tsx`, `TaskPage.tsx`
6. current `PaperDetailDialog.tsx`, Memory/Diary/Task paper editor components and relevant CSS
7. current Universe page/map/paper files and focused tests

The earlier ready-state spec remains authoritative for map/data/interaction semantics. The new production-polish spec overrides only the visual/interaction details it explicitly changes.

## Hard scope

Mobile Universe **ready state only**.

Do not modify or redesign:

- loading
- error
- uninitialized/importer
- desktop
- backend/API/service contract
- database/schema/migrations
- Auth0
- MCP
- PWA

Do not change the weighted contract. `Node.galaxies` remains exactly `{id:string, weight:number}[]`. Never normalize it to string IDs. Never invent a default membership weight. Current weight validation is finite-number only; do not add `[0,1]` clamping.

Do not change canonical node position semantics or the existing `0..100` write boundary.

Do not auto-layout or move persisted nodes except through the already-accepted explicit long-press move flow.

## Visual intent

The production map was accepted structurally but is still too visually strong. Make it **extremely pale**: planet fills, secondary rings, idle relations and reference marks should be quieter while preserving selected/direct-neighbor hierarchy.

Universe ready state should be edge-to-edge on mobile. `星系` and `查看全部` align on one level and move upward about 20px from the current production position.

`＋`, `···`, and `星系` all become small anchored white popovers with light borders/shadows and outside-click close. No bottom sheet, no dim backdrop, no separate cancel box.

- `···`: `导出`, centered, directly below trigger.
- `＋`: centered placement instruction directly below trigger. Outside tap cancels placement and creates nothing. Remove duplicate page-level placement notice.
- `星系`: anchored menu with `全部` + galaxies, not a half-screen sheet.

## Paper intent

Reuse the accepted Memory/Diary/Task Paper shell and interaction behavior. Universe node papers must locally remove ruled lines and bottom-right `Universe` signature without changing other Paper consumers.

Detail is a reading paper:

- top-left `YYYY.MM.DD HH:mm`
- top-right `编辑 · ···`
- body: title, optional summary, optional content, Connections
- no type/importance/tags/galaxy field inspector
- Connections are light text rows; related-node navigation remains
- no large per-row remove buttons in read mode

Create/edit is content-first:

- same Paper shell; edit happens in place
- top-right `取消 · 保存`
- transparent title/summary/content editors; no visible field labels/boxes
- metadata fixed at bottom, Connections remain in scroll body

Footer metadata language:

`reflection · anchor · #tag`

`星系  意识与自我 1 · 时间与记忆 0.9 · ＋`

Type/importance/galaxy/weight editing uses tiny anchored popovers, not native selects, checkbox matrices or boxed number fields.

When adding a galaxy, create a pending membership with a blank weight editor. Save remains disabled until the weight parses to a finite number. **Never generate a weight.** Zero memberships is valid.

## Engineering approach

Use strict TDD and execute the implementation plan task-by-task. Prefer small focused components over expanding `UniversePage.tsx` / `UniverseNodePaper.tsx` indefinitely. One small shared Universe popover primitive and one node metadata component are expected by the plan unless current code evidence demonstrates a simpler equally-safe boundary.

Do not weaken existing tests. Mounted interaction tests are required for outside-click cancellation, placement cancellation, same-paper editing, weighted membership editing and related-node behavior.

## Verification gate

Before declaring completion, run and report exact results for:

```bash
pnpm exec tsx --test --test-concurrency=1 tests/universe-*.test.ts
pnpm exec tsx --test --test-concurrency=1 tests/**/*.test.ts
pnpm typecheck
pnpm build
pnpm --dir web typecheck
pnpm --dir web build
git diff --check
git status --short
git diff --name-only 800b5fcb84c1929d9626f192cfce8564847c9dfa...HEAD
```

Run the repository DB schema check only if its required environment is already available. Do not request, print or paste `DATABASE_URL` or other secrets. There are no intended DB changes in this branch.

## Stop conditions

Stop and report rather than guessing if any requested UI requires:

- backend/API/schema changes
- a new persistence field
- changing weighted membership semantics
- changing canonical position semantics
- modifying importer/loading/uninitialized behavior
- inventing a membership weight/default

## Handoff

Commit each coherent TDD task. Push the implementation branch when complete. Do **not** create a PR, merge, or deploy. Return the final remote HEAD, commit list, changed-file list, exact verification output summary, and any blocked command. ChatGPT will inspect the actual remote diff before approval.
