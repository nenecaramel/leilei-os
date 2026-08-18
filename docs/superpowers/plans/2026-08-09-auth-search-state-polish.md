# Auth and Search State Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the production auth vertical position, neutralize the auth loading spinner, and give filtered/search empty-result states a 96px mobile safety gap.

**Architecture:** Keep the patch CSS-first and shared. Consolidate the duplicated auth transform into one authoritative rule, reuse the existing auth loading orb, and use the shared Memory/Diary/Task empty-state structure rather than page-specific offsets. Global Search receives its own shared state-line mobile spacing; Quick Search is untouched.

**Tech Stack:** React, TypeScript, Vite, CSS, Node test runner via `tsx --test`.

## Global Constraints

- Base branch: `codex/phase-6-web-ui-foundation`.
- Expected base SHA: `87297c238254721f1dc3d978bf0084ed273a6ca2`.
- Feature branch: `leilei/auth-search-ui-polish-2026-08-09`.
- Final login transform: `translateY(100px)`.
- Auth spinner accent: `#8a8a8a`.
- Filtered/search state mobile top gap: `96px`.
- Ordinary module empty states do not move.
- Quick Search does not move.
- No backend changes.
- No Day Space changes.
- `web/preview.html` and `web/src/preview-main.tsx` must remain absent/untracked.
- Never force push.

---

### Task 1: Lock the auth regression contracts

**Files:**
- Modify: `tests/auth-accepted-position-regression.test.ts`
- Create: `tests/auth-loading-neutral-regression.test.ts`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: existing `.auth-minimal`, `.loading-orb`, and auth action styles.
- Produces: one authoritative `.auth-minimal` transform at `100px`; neutral spinner accent.

- [ ] **Step 1: Write the failing auth-position regression**

Update `tests/auth-accepted-position-regression.test.ts` so it:
- expects `translateY(100px)`;
- collects every `.auth-minimal { ... }` block;
- rejects any block containing `translateY(-26px)`;
- asserts there is only one transform declaration governing `.auth-minimal`.

- [ ] **Step 2: Write the failing spinner regression**

Create `tests/auth-loading-neutral-regression.test.ts` that reads `web/src/styles.css` and asserts the `.loading-orb` block contains:

```css
border-top-color: #8a8a8a;
```

and does not contain:

```css
border-top-color: var(--green);
```

- [ ] **Step 3: Run the auth tests and confirm RED**

```bash
pnpm exec tsx --test \
  tests/auth-accepted-position-regression.test.ts \
  tests/auth-loading-neutral-regression.test.ts
```

Expected: FAIL because production CSS still contains the stale auth transform and green loading accent.

- [ ] **Step 4: Consolidate the auth CSS**

In `web/src/styles.css`:
- remove the stale later `.auth-minimal { transform: translateY(-26px); }` override;
- set the authoritative `.auth-minimal` transform to `translateY(100px)`;
- change `.loading-orb` `border-top-color` from `var(--green)` to `#8a8a8a`;
- leave title size, button default style, dimensions, border width, and animation unchanged.

- [ ] **Step 5: Run the auth tests and confirm GREEN**

Run the same two-test command and require PASS.

---

### Task 2: Move only filtered module empty states

**Files:**
- Modify: `web/src/styles.css`
- Create: `tests/filtered-empty-mobile-spacing.test.ts`

**Interfaces:**
- Consumes: shared `.memory-empty-state` and `.memory-empty-clear`.
- Produces: filtered Memory / Diary / Task empty-state spacing without changing ordinary empty states.

- [ ] **Step 1: Write the failing filtered-empty spacing test**

Create `tests/filtered-empty-mobile-spacing.test.ts` that asserts the mobile stylesheet has:

```css
.memory-empty-state:has(> .memory-empty-clear) {
  margin-top: 96px;
}
```

The test must also prove the base `.memory-empty-state` rule itself does not gain `margin-top: 96px`.

- [ ] **Step 2: Run the new test and confirm RED**

```bash
pnpm exec tsx --test tests/filtered-empty-mobile-spacing.test.ts
```

Expected: FAIL because no filtered-only 96px rule exists yet.

- [ ] **Step 3: Add the shared mobile spacing rule**

Inside the existing mobile empty-state styling in `web/src/styles.css`, add:

```css
.memory-empty-state:has(> .memory-empty-clear) {
  margin-top: 96px;
}
```

Do not change base `.memory-empty-state` padding, font, gap, or ordinary-empty positioning.

- [ ] **Step 4: Run the test and confirm GREEN**

Run the same test and require PASS.

---

### Task 3: Move Global Search result-state messaging

**Files:**
- Modify: `web/src/pages/GlobalSearchPage.tsx`
- Modify: `web/src/styles.css`
- Create: `tests/global-search-state-spacing.test.ts`

**Interfaces:**
- Consumes: existing mobile `.global-search-state-line`.
- Produces: a dedicated 96px mobile offset for Global Search empty/error result states only; idle/loading and Quick Search remain unchanged.

- [ ] **Step 1: Write the failing Global Search spacing test**

Create `tests/global-search-state-spacing.test.ts` that proves:

- the `empty` state receives `global-search-state-line-offset`;
- the `error` state receives `global-search-state-line-offset`;
- the `loading` state does not receive that class;
- the mobile offset class uses `margin-top: 96px`;
- `.quick-search-state` is not changed to 96px.

- [ ] **Step 2: Run the test and confirm RED**

```bash
pnpm exec tsx --test tests/global-search-state-spacing.test.ts
```

Expected: FAIL because the dedicated empty/error offset class does not exist yet.

- [ ] **Step 3: Change only Global Search empty/error spacing**

In `web/src/pages/GlobalSearchPage.tsx`, add
`global-search-state-line-offset` only to the visible `empty` and `error`
state elements.

Inside the mobile stylesheet add:

```css
.global-search-state-line-offset {
  margin-top: 96px;
}
```

Do not change the base `.global-search-state-line` rule and do not edit
`.quick-search-state`.

- [ ] **Step 4: Run the test and confirm GREEN**

Run the same test and require PASS.

---

### Task 4: Final verification and integration

**Files:**
- Verify only the intended test files and `web/src/styles.css` are changed.
- No preview files.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: one verified hotfix commit suitable for fast-forwarding the final UI branch.

- [ ] **Step 1: Run focused regressions**

```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/auth-accepted-position-regression.test.ts \
  tests/auth-surface-redesign.test.ts \
  tests/auth-safari-white-hotfix.test.ts \
  tests/auth-loading-neutral-regression.test.ts \
  tests/filtered-empty-mobile-spacing.test.ts \
  tests/mobile-empty-clear-parity.test.ts \
  tests/global-search-state-spacing.test.ts \
  tests/global-search-mobile-redesign.test.ts \
  tests/quick-search.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Run the deterministic full serial suite**

```bash
TESTS=()
while IFS= read -r test_file; do
  TESTS+=("$test_file")
done < <(find tests -type f -name '*.test.ts' | sort)

pnpm exec tsx --test --test-concurrency=1 "${TESTS[@]}"
```

Expected: all PASS.

- [ ] **Step 3: Run build gates**

```bash
pnpm typecheck
pnpm build
(cd web && pnpm typecheck)
(cd web && pnpm build)
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 4: Check exact scope**

Require:
- no `src/**` backend changes;
- no Day Space files;
- no `web/preview.html`;
- no `web/src/preview-main.tsx`;
- only `web/src/styles.css` plus this hotfix's tests/spec/plan are durable changes.

- [ ] **Step 5: Commit implementation**

```bash
git commit -m "fix: polish auth and search empty states"
```

- [ ] **Step 6: Push without force**

Fresh-fetch `origin/codex/phase-6-web-ui-foundation`, verify it still points to the expected pre-hotfix base, then:
- push the feature branch;
- fast-forward `codex/phase-6-web-ui-foundation` to the verified hotfix commit;
- fetch both refs and verify both equal the hotfix SHA.

Never force push.
