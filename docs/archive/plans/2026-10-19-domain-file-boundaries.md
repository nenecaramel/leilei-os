# Domain file boundaries implementation plan

**Goal:** Reduce three mixed-responsibility files without changing observable behavior.

**Architecture:** Keep transaction ownership and page mutation/navigation ownership intact. Extract cohesive lifecycle SQL, pure Diary validation, and abortable Diary list reads. Preserve original public imports and error identity. No new dependencies, schema, UI, or runtime settings.

## Steps
- [x] Record existing service and browser behavior test baselines.
- [x] Move conversation archive/restore/delete as complete functions, retaining their serializable transactions and lock ordering. Re-export the existing in-flight predicate.
- [x] Move pure Diary validation and shared error definition; preserve validation order, normalization, hashes and public error exports.
- [x] Move list read effect and cancellation tracker into a Diary Hook, retaining page-owned navigation/cache/scroll refs and effect ordering.
- [x] Run service/browser regressions, isolated PostgreSQL lifecycle tests, Node 22 typecheck/build/runtime gate, Node 24 Web typecheck/build.
- [x] Review exact moved bodies and public compatibility; report actual results. Do not merge without authorization.

## Review focus
- Archived/busy/tenant-scoped deletion must retain full transaction protection.
- Domain errors must retain instanceof identity and validation precedence.
- Stale list responses must not repaint a new filter or detail view.
- Mobile back navigation must retain cache and scroll behavior.
- Late writes must not overwrite the selected entry or discard drafts.

## Verification results

- Node 22.23.3 / pnpm 11.9.0: typecheck and build passed.
- Services/API/MCP: 82 passed; initial focused main baseline: 47 passed.
- Node 24.19.0: Web typecheck/build passed; rendered-page tests 55 passed on both main and refactor, including the new stale response test. Removing the stale response guards made that test fail; original source restored.
- Isolated PostgreSQL 18 on loopback port 55479, dedicated `leileios_domain_split_test`: target verified with the repository read-only verifier before migration; 10 database tests passed on both main and refactor, zero skips.
- Production runtime gate: 701 + 385 passed, zero failures/cancellations/skips after supplying the unchanged bridge dependencies omitted from initial temporary-worktree setup.
- 18 extracted function bodies match after receiver/whitespace normalization; the list effect is text-identical. Independent review found no blockers.
- No real model, production database, installed Hook, daemon restart, iOS/signing, or deployment actions were performed.
