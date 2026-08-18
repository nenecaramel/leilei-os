# Codex Execution Brief — Universe Mobile Ready-State Redesign

Date: 2026-08-15
Target branch: `codex/phase-8-3-universe-mobile-redesign`
Starting branch head when this brief was created: `a4772875320986769e40a6f5da833438637a7045`
Production baseline: `003bcdc1f764e38914c9cd980ed0ba5fec452132`
Approved design commit: `49cb3f93ca7bceb40174bff5fb959980d87fedae`

This brief is an execution guardrail for Codex. It does not replace the approved design or implementation plan.

## 0. Authority and required reading

Before changing any implementation file, read completely:

1. `docs/superpowers/specs/2026-08-15-universe-mobile-ready-state-redesign-design.md`
2. `docs/superpowers/plans/2026-08-15-universe-mobile-ready-state-redesign.md`
3. this brief
4. current `web/src/pages/UniversePage.tsx`
5. current `web/src/pages/universe-state-polish.css`
6. current Universe frontend types/service/adapter files used by `UniversePage`
7. `web/src/pages/PaperDetailDialog.tsx`
8. the shared paper styles in `web/src/styles.css`
9. all existing Universe UI/importer tests before modifying their assertions

Authority order when statements differ:

`approved design > implementation plan > this execution brief > existing incidental implementation details`

Do not reinterpret an explicit approved design decision. If the repository reveals a real contract conflict that the design/plan did not anticipate, STOP and report the conflict instead of improvising.

## 1. Branch and repository safety

Work only on:

`codex/phase-8-3-universe-mobile-redesign`

Before the first code change:

- verify the current branch is exactly the target branch;
- verify the worktree is clean;
- record the current HEAD;
- do not reset/rebase/force-push another user's work;
- do not merge the branch;
- do not deploy production;
- do not mutate production data.

If the branch already contains implementation commits made after this brief, inspect them and continue from the first incomplete plan task; do not redo completed work blindly.

## 2. Absolute scope boundary

This task is ONLY the mobile Universe READY-STATE frontend redesign.

Allowed product surface:

- mobile ready-state map;
- mobile ready-state controls;
- galaxy focus picker;
- node detail/create/edit paper;
- relation creation/edit paper;
- pan/zoom, selection, long-press movement, map-placement flow;
- local viewport preference;
- frontend tests and CSS required by the approved design.

Must remain unchanged in behavior and visual acceptance:

- loading state;
- uninitialized state;
- 8.3 importer state and importer semantics.

Out of scope, and therefore forbidden unless execution is stopped for explicit approval:

- desktop redesign;
- API changes;
- server/domain/repository changes;
- database/schema/migration changes;
- Railway/Vercel/Auth0 changes;
- global search / Phase 8.4;
- MCP / Phase 8.5;
- Memory/Diary synchronization;
- dependency additions for pan/zoom or gesture handling;
- unrelated refactors, lint cleanup, renames, formatting sweeps, or design-system work.

No migration or backup gate is part of this task because no DB change is allowed.

## 3. Canonical Universe contract must remain exact

Treat current production Universe types/service semantics as authoritative.

Non-negotiable:

- weighted galaxy memberships stay `{ id: string, weight: number }[]`;
- preserve exact finite numeric weights;
- never normalize memberships to string IDs;
- never invent replacement/default weights for an existing membership;
- do not invent a `[0,1]` validation rule unless the current canonical domain already enforces it;
- node `importance` and galaxy membership `weight` remain separate concepts;
- relation `strength` affects only restrained presentation, not canonical semantics;
- existing whole-snapshot / `expectedVersion` optimistic-concurrency behavior remains unchanged;
- do not add direct DB access or a second persistence path;
- do not blind-retry uncertain writes;
- do not change importer `edges -> relations` boundary behavior;
- do not change `schemaVersion` or migration compatibility.

The legacy DB column is not part of this frontend redesign and must not be touched.

## 4. Mobile-only design decisions are frozen

Do not redesign these during implementation:

- white, unframed spatial map;
- extremely subtle sparse world-space reference dots;
- single-finger pan;
- two-finger pinch zoom;
- no permanent zoom `+/-` buttons;
- lightweight `查看全部` fit-to-content action;
- first visit fits all; later visits restore local pan/zoom;
- galaxy filtering never moves/recenters the viewport;
- galaxy focus fades non-members instead of removing them;
- highest-weight valid galaxy membership determines primary planet color;
- secondary memberships use restrained outer rings/halos;
- `importance` controls restrained planet size and label-retention priority;
- `type` has no map-level icon/color/shape encoding;
- planet title is centered below the planet, without a pill/background;
- system never auto-repositions nodes to resolve overlap;
- all relations remain globally present but extremely light;
- relation `strength` changes only restrained line opacity/weight;
- relation type text appears only for selected first-degree relations;
- relation direction marker appears only subtly when emphasized;
- visual priority is `selected > direct neighbor/relation > active galaxy > ordinary > faded`;
- selection always overrides galaxy-focus fading;
- first tap selects a planet;
- second tap on the same selected planet opens detail;
- tapping another planet switches selection;
- tapping empty map clears node selection but preserves galaxy focus;
- long-press then drag moves a planet; release performs one final save;
- failed movement restores the old location and shows a lightweight error;
- node positions are never auto-laid out or auto-moved;
- top right has only `+` and `...` in ready state;
- export is under `...`;
- galaxy focus is a light text entry, not a wrapped pill toolbar;
- `+` enters place-node mode; tapping the map chooses the location BEFORE opening the create paper;
- canceling create before save creates nothing;
- relation creation begins from a node paper, then returns to map to pick target, then opens a relation paper;
- no drag-to-connect gesture;
- no bottom-sheet node detail;
- no fullscreen node editor;
- node detail/create/edit MUST reuse `PaperDetailDialog`;
- relation create/edit must use the same paper visual language;
- closing paper preserves the exact map viewport;
- tapping a related node from a paper closes the paper, navigates map to that node if needed, and selects it; do not auto-open its paper.

## 5. Coordinate rule — do not accidentally change data meaning

Persisted node positions retain their existing canonical domain and meaning.

Implement an internal deterministic transform:

`canonical position <-> logical world <-> viewport <-> screen`

Requirements:

- pan/zoom mutates only viewport state;
- resize/fit/filter does not mutate canonical node positions;
- canonical -> world -> canonical round trip is stable within a small numeric tolerance;
- moved/created locations are converted back into values valid under the existing canonical position contract;
- do not create a server schema or migration for world coordinates.

## 6. Interaction modes must be explicit and mutually exclusive

Model at least:

- browse/normal;
- placing-node;
- picking-relation-target;
- moving-node.

Special modes override normal tap behavior.

Forbidden failure modes:

- a long-press move also pans the canvas;
- a relation-target tap performs ordinary first-tap selection instead of selecting the target;
- a placing-node tap clears selection instead of choosing a position;
- a pan is later interpreted as a tap;
- a completed/cancelled failure leaves the UI stuck in a special mode.

Keep pointer/gesture mechanics separate from persistence callbacks where practical.

## 7. Shared paper system — reuse, do not clone

Use `PaperDetailDialog` directly.

Do NOT copy or recreate its:

- veil/layer shell;
- focus trap;
- body scroll lock;
- Escape handling;
- sizing/centering behavior;
- focus restoration.

Universe paper fields must use the existing paper visual language: transparent/quiet paper inputs, not nested gray form cards.

Only expose canonical fields already supported by Universe. Do not invent new product fields.

Preserve destructive actions only if they already exist in the current ready-state behavior; do not invent a new delete/archive capability.

## 8. Task execution protocol — mandatory

Follow the tasks in `2026-08-15-universe-mobile-ready-state-redesign.md` in order.

For EACH task:

1. Read that task again before touching files.
2. Write the specified failing test / regression assertion first.
3. Run the focused command and confirm the expected RED reason is the missing/new behavior, not an unrelated environment failure.
4. Implement only enough for that task.
5. Run the task's focused tests to GREEN.
6. Run web typecheck when the task changes TypeScript/TSX integration.
7. Run web build at the plan's major integration checkpoints.
8. Run `git diff --check`.
9. Inspect `git status --short`; no unexplained files.
10. Inspect the exact task diff for scope drift.
11. Commit the task separately using the plan's specified commit message unless a narrowly justified adjustment is needed.
12. Only then begin the next task.

Do NOT implement several tasks in one giant commit.

If a test already fails on the untouched task base, verify whether it is pre-existing before treating it as regression. Report pre-existing failures precisely; do not silently skip them or weaken unrelated tests.

## 9. File-change discipline

Prefer only files named by the current implementation-plan task.

If implementation genuinely requires a file outside the current task list:

- first determine whether it is required by the approved design or current canonical contract;
- keep the change minimal;
- state why the file was necessary in the task report;
- if it changes scope, semantics, dependencies, persistence, shared dialog behavior, loading/uninitialized/importer UI, or desktop behavior, STOP rather than modifying it.

Do not modify lockfiles/package manifests unless explicitly approved after stopping. No new gesture/pan-zoom dependency in this implementation pass.

## 10. Existing accepted states are regression gates

Tests protecting loading/uninitialized/importer behavior are not disposable obstacles.

When an old test encodes an intentionally superseded READY-STATE visual rule (for example monochrome ready-state planets), update only that ready-state assertion while preserving its accepted loading/importer protections.

Never loosen a test merely because the implementation does not pass it. Change a test only when the approved design explicitly supersedes that exact assertion.

## 11. Desktop boundary

This redesign is not a desktop redesign.

Do not intentionally alter desktop interaction/visual design. If the implementation introduces a mobile-specific component/switch, preserve the existing desktop ready-state behavior rather than redesigning it incidentally.

If preserving desktop cleanly conflicts with the current page architecture, STOP and report the architectural conflict before broadening scope.

## 12. Visual restraint guardrail

Do not add unapproved decoration:

- no dark/cosmic background;
- no glassmorphism;
- no starfield animation;
- no heavy shadows;
- no glowing neon relation colors;
- no relation-type color coding;
- no node cards/pills on the star map;
- no galaxy pill row;
- no permanent map toolbar;
- no automatic layout animation;
- no realistic planet texture;
- no new custom modal system.

Use CSS variables/helpers where they reduce duplication, but do not perform a broad stylesheet refactor.

## 13. Accessibility and mobile behavior

Preserve/implement:

- comfortable touch targets even when controls look visually light;
- accessible names on icon-only controls;
- no redundant announcement for decorative dots/rings/lines;
- `prefers-reduced-motion` for nonessential interpolation;
- no global body touch disabling;
- map gesture prevention scoped to the map only as needed;
- iOS keyboard/dialog behavior delegated to existing paper dialog mechanics where possible.

Optional haptic feedback must be best-effort only and cannot affect correctness.

## 14. Stop conditions — do not improvise

STOP and report before continuing if any of these occur:

- a server/API/database/schema change appears necessary;
- a new dependency appears necessary;
- canonical weighted-membership semantics are unclear;
- existing position validation conflicts with the planned reversible transform;
- `PaperDetailDialog` cannot support the required paper flow without modifying shared behavior;
- desktop preservation requires a broad redesign;
- an accepted loading/uninitialized/importer state would need to change;
- a task requires weakening unrelated regression coverage;
- production data or credentials would be required;
- merge/deploy would be required;
- current branch/history does not match the expected implementation lineage.

Do not ask for or print secrets (`DATABASE_URL`, tokens, passwords, backup passphrases).

## 15. Completion gate

After the last implementation-plan task, but BEFORE requesting merge:

- run all focused Universe map/paper/UI tests added or modified by the plan;
- run the existing Universe frontend regression tests covering loading/uninitialized/importer;
- run relevant shared `PaperDetailDialog` regression tests;
- run root typecheck/build gates specified by the plan;
- run web typecheck/build;
- run `git diff --check`;
- verify clean worktree;
- compare the final branch to its implementation starting point and inspect every changed filename;
- explicitly confirm there are no server/API/db/schema/migration/dependency changes;
- explicitly confirm loading/uninitialized/importer remain unchanged in behavior;
- explicitly confirm no merge/deploy occurred.

Do not claim visual acceptance from tests alone. Final mobile visual acceptance must still be performed separately after code review.

## 16. Codex reporting format

After EACH committed task, report only:

- task number/name;
- commit SHA;
- files changed;
- RED test command/result;
- GREEN test command/result;
- typecheck/build result if run;
- any pre-existing failure separately labeled;
- whether a stop condition was encountered.

After ALL tasks, report:

- ordered commit list;
- final HEAD;
- changed-file list vs starting implementation head;
- complete verification commands and results;
- any known limitations;
- explicit statements: `MERGED=NO`, `DEPLOYED=NO`, `DB_SCHEMA_CHANGED=NO`, `API_CONTRACT_CHANGED=NO`, `IMPORTER_CHANGED=NO`.

Do not merge. Do not deploy. Wait for independent GitHub diff review and mobile visual acceptance.