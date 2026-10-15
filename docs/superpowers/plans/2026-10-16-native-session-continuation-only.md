# Native Session Continuation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Switch native sessions without importing Desktop display history.

**Architecture:** Keep local JSONL authoritative for provider execution and canonical LeileiOS messages authoritative for its own UI. Add an explicit continuation binding at a canonical handoff anchor; preserve existing full-history import as a separate compatibility path. New native Session IDs create separate empty continuation conversations, while exact current Session matches reuse their conversation.

**Tech Stack:** Node 22, Agent SDK 0.3.296 (unchanged), PostgreSQL/Drizzle, existing authenticated internal router.

**Spec:** User-approved conversation of 2026-10-16: no Desktop history display requirement, preserve native current branch, new Session/new empty entry, same Session/reuse.

## Global Constraints
- No production reads/writes, deployment, daemon restart, live Claude query, session/archive file writes or SDK upgrade.
- No new migration; bindings use existing provider metadata. Do not mutate the canonical checkout's local archive-retention commit.
- Preserve busy, peer release, durable recovery, exact checkpoint, owner and stale-selection fences.
- Daily switching must not invoke full-history projection, asset upload or automatic archival.

## Review Focus
- Empty canonical head must resume the bound provider checkpoint, never create a new provider session.
- Stale attach/release and lost responses must not advance canonical history or authorize the wrong owner.
- Edit/Retry after handoff must use its exact native base; earlier local messages remain immutable.
- Compact ancestry files are display-only and must not be required by execution-only inspection.
- Current fork identity must win over the original imported Session when handing back to Desktop.

### Task 1: Execution-only inspection and selection
**Files:** native-session-inspection.mjs, native-session-switch-preflight.mjs, native-session-picker.mjs and focused bridge tests.
**Interface:** historyMode='continuation' explicitly skips display projection; pinned current native checkpoint and revision remain mandatory.
- [x] Add tests for compact source absent, unfinished turns, stale revision and new Session selection; observe RED.
- [x] Implement root-only ancestry validation and identity-only inspection/picker mode.
- [x] Run focused bridge tests; record GREEN.

### Task 2: Durable continuation ownership and execution
**Files:** new native-session-continuation-repository.ts; native-session-history-repository.ts; prepare.ts; native-live-execution-admission.ts; internal router and app wiring; isolated DB tests.
**Interface:** continuation state/attach/release accept metadata only, use expected canonical head and binding revision CAS, return actual current provider identity; never insert imported messages.
- [x] Add isolated PostgreSQL tests for empty attach, exact first send, retry/edit, idempotent/stale handoff, busy and session isolation; observe RED.
- [x] Implement minimal transaction and execution anchor support without fake canonical rows.
- [x] Run isolated integration and HTTP contract tests; record GREEN.

### Task 3: Fixed switching entry and verification
**Files:** new native-session-continuation.mjs, switching CLI/wrapper/picker, docs and offline tests.
**Interface:** existing daily commands select continuation mode; explicit legacy restore stays supported. Release uses actual head Session and official Desktop launcher without full import.
- [x] Add mock switch tests proving no history/assets/archive/model calls and retained recovery/release checks; observe RED.
- [x] Wire daily commands to continuation mode, preserve public sanitized errors.
- [x] Run full bridge offline suite, production runtime gate, root typecheck/build, isolated DB and diff check.
- [ ] Commit and prepare Draft PR after final gates; no merge/deploy.

## Execution record

- RED: the new compact-root inspection and new-Session selection tests failed before implementation (2 failures); corresponding 48-test selection/preflight group then passed.
- RED: three new PostgreSQL continuation tests failed before the repository existed; subsequent combined suites passed after implementation.
- RED: two new continuation switch tests failed before the client module existed, then passed.
- RED: duplicate native UUID content was accepted before the added guard, then rejected by the focused test.
- Final review: one fresh read-only reviewer identified ownership ABA when the native file remained unchanged. The new lost-response ABA regression failed first, then passed after independent binding generations and previous-transition replay evidence were persisted in existing metadata.
- Ruling: retain the existing legacy full-history importer explicitly rather than deleting it; daily picker/wrapper use continuation only and never fall back to full upload or auto-archive. This preserves compatibility without requiring old display history.
- Ruling: source ancestry is a UUID-only attestation from the same authenticated Mac boundary that previously supplied complete projections. No untrusted user endpoint gains attachment/ownership authority.
- Runtime/acceptance boundary: zero real SDK queries, no user JSONL reads/writes, no daemon restart, no deployment or production access. Real Desktop/iPhone/IME/attachment acceptance remains separate.
